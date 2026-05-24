// Pose → humanoid skeleton retargeting (direct bone-pointing).
//
// Approach: every driven bone is rotated locally so that its rest
// direction (auto-detected from its first child at bind time) points
// toward the next MediaPipe landmark in world space, expressed in the
// bone's parent-local frame.
//
// Key correctness pieces:
//
//   • The MediaPipe Y axis is empirically auto-detected at runtime.
//     MediaPipe's `worldLandmarks` sometimes report Y *down* (image
//     convention inherited from 2D landmarks) and sometimes Y *up* — it
//     differs by model version. We sample knee-vs-hip Y once we have a
//     visible standing pose and pick the sign that puts knees below
//     hips. This eliminates the single biggest source of "the avatar
//     is upside-down / static" bugs.
//
//   • Landmarks are pre-smoothed with a per-axis One-Euro filter so
//     the bone rotations don't shake at 25 Hz.
//
//   • The spine is driven in multiple segments (Spine → Chest) so the
//     torso bends naturally instead of moving as a single rigid block.
//
//   • The head is pointed using the nose / ears triangle so it tracks
//     gaze direction.
//
//   • Smoothing is set very low (slerp factor 0.04) so the avatar
//     responds almost instantly. The MediaPipe pipeline already does
//     temporal smoothing internally; further slerp introduces lag.

import * as THREE from 'three';
import { LM } from '@kinesis/pose';

export type Landmark = { x: number; y: number; z: number; visibility?: number };
export type Landmarks = readonly Landmark[];

// ─────────────────────────────────────────────────────────────────────
//  Drive table — proximal → distal so parents update first.
//
//  Bones are matched against the GLB rig in two passes:
//
//   1. EXACT match: any name in `candidates` (case-insensitive,
//      `mixamorig:` prefix stripped) that equals the bone's
//      normalised name.
//   2. KEYWORD match: a `keywords` array of substrings — if a bone
//      contains ALL of the listed substrings (and none of the
//      `excludes`), it's a match. This catches rigs that name their
//      bones `Bot_Hips`, `armature:UpperArm.L`, `DEF-thigh_R`, etc.
//
//  Side handling: keywords for left/right bones include an explicit
//  side token (`l` / `r` / `left` / `right`) so we don't accidentally
//  match `LeftArm` when looking for `RightArm`.
// ─────────────────────────────────────────────────────────────────────

type DriveSpec = {
  /** Candidate bone names — exact matches (first wins). */
  candidates: string[];
  /** Fallback keyword matcher. Picks the first bone where every
   *  substring (case-insensitive) appears in the normalised bone
   *  name and none of `excludes` does. */
  keywords?: string[];
  /** Substrings that disqualify a bone from this keyword match.
   *  E.g. matching "thigh" but excluding "twist" so a `thigh_twist`
   *  helper bone isn't chosen as the primary. */
  excludes?: string[];
  /** Landmark at the bone's origin. */
  fromLm: number;
  /** Landmark at the bone's tail (the direction we point at). */
  toLm: number;
  /** Optional minimum confidence floor — some bones (like the spine)
   *  should always update even when the legs are off-screen. */
  minConf?: number;
  /** Optional anatomical clamp — maximum angle the bone may rotate away
   *  from its rest direction in parent-local space, in radians. Prevents
   *  hyperextension when landmark noise produces an impossible target. */
  maxFlexion?: number;
};

/**
 * Normalise a bone name for matching: strip Mixamo prefix, lowercase,
 * collapse all non-alphanumerics so `LeftArm`, `left_arm`, `L-Arm.001`,
 * `leftArm.L` and so on all hit the same string.
 */
function normalise(name: string): string {
  return name.replace(/^mixamorig:?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Walk the keywords list and return the first matching bone from the
 * map (norm → Bone) whose normalised name contains every keyword and
 * none of the excludes.
 */
function keywordMatch(
  byNorm: Map<string, THREE.Bone>,
  keywords: string[],
  excludes: string[] | undefined,
): THREE.Bone | null {
  // Score candidates by number of keywords matched and the bone's
  // shortest length (shorter names tend to be the primary bone, not
  // a helper twist bone). Pick the highest score.
  let best: { bone: THREE.Bone; score: number; len: number } | null = null;
  for (const [norm, bone] of byNorm) {
    let matched = 0;
    for (const k of keywords) {
      if (norm.includes(k)) matched++;
      else { matched = -1; break; }
    }
    if (matched < 0) continue;
    if (excludes) {
      let dq = false;
      for (const e of excludes) if (norm.includes(e)) { dq = true; break; }
      if (dq) continue;
    }
    const score = matched;
    if (!best || score > best.score || (score === best.score && norm.length < best.len)) {
      best = { bone, score, len: norm.length };
    }
  }
  return best?.bone ?? null;
}

type Drive = DriveSpec & {
  bone?: THREE.Bone;
  restAxis?: THREE.Vector3;
  bindParentInv?: THREE.Quaternion;
  /** Max angle the bone can rotate away from its rest direction in
   *  parent-local space. Anatomical clamp — prevents hyperextension and
   *  obviously-wrong tracking from making the avatar bend in impossible
   *  ways. Expressed in radians. */
  maxFlexion?: number;
};

// Encoded "midpoint" sentinel — values >= 1000 mean "average of two
// raw indices a and b" encoded as 1000 + a*100 + b.
function midpoint(a: number, b: number): number {
  return 1000 + a * 100 + b;
}

const DRIVES: DriveSpec[] = [
  // ── Spine column. Multi-segment so the torso bends realistically.
  {
    candidates: ['Spine', 'spine', 'Spine.001'],
    keywords: ['spine'],
    excludes: ['twist', 'bend', '1', '2', '3', 'chest'],
    fromLm: midpoint(LM.LEFT_HIP, LM.RIGHT_HIP),
    toLm:   midpoint(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    minConf: 0.5,
  },
  {
    candidates: ['Spine1', 'spine1', 'Spine.002', 'Chest', 'chest'],
    keywords: ['chest'],
    excludes: ['upper', 'twist'],
    fromLm: midpoint(LM.LEFT_HIP, LM.RIGHT_HIP),
    toLm:   midpoint(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    minConf: 0.5,
  },
  {
    candidates: ['Spine2', 'spine2', 'Spine.003', 'UpperChest', 'upperChest'],
    keywords: ['upperchest'],
    fromLm: midpoint(LM.LEFT_HIP, LM.RIGHT_HIP),
    toLm:   midpoint(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    minConf: 0.5,
  },
  {
    candidates: ['Neck', 'neck'],
    keywords: ['neck'],
    excludes: ['twist'],
    fromLm: midpoint(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    toLm:   LM.NOSE,
  },
  {
    candidates: ['Head', 'head'],
    keywords: ['head'],
    excludes: ['top', 'end', 'eye', 'ear', 'jaw', 'tongue'],
    fromLm: midpoint(LM.LEFT_EAR, LM.RIGHT_EAR),
    toLm:   LM.NOSE,
  },
  // ── Left arm
  {
    candidates: ['LeftArm', 'leftArm', 'L_UpperArm', 'upper_arm.L', 'arm.L'],
    keywords: ['left', 'arm'],
    excludes: ['fore', 'low', 'hand', 'finger', 'thumb', 'twist', 'shoulder', 'right'],
    fromLm: LM.LEFT_SHOULDER, toLm: LM.LEFT_ELBOW,
  },
  {
    candidates: ['LeftForeArm', 'leftForeArm', 'L_LowerArm', 'forearm.L', 'ForeArm.L'],
    keywords: ['left', 'forearm'],
    excludes: ['hand', 'twist', 'right'],
    fromLm: LM.LEFT_ELBOW, toLm: LM.LEFT_WRIST, maxFlexion: Math.PI * 0.92,
  },
  {
    candidates: ['LeftHand', 'leftHand', 'hand.L', 'Hand.L'],
    keywords: ['left', 'hand'],
    excludes: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'right'],
    fromLm: LM.LEFT_WRIST, toLm: LM.LEFT_INDEX,
  },
  // ── Right arm
  {
    candidates: ['RightArm', 'rightArm', 'R_UpperArm', 'upper_arm.R', 'arm.R'],
    keywords: ['right', 'arm'],
    excludes: ['fore', 'low', 'hand', 'finger', 'thumb', 'twist', 'shoulder', 'left'],
    fromLm: LM.RIGHT_SHOULDER, toLm: LM.RIGHT_ELBOW,
  },
  {
    candidates: ['RightForeArm', 'rightForeArm', 'R_LowerArm', 'forearm.R', 'ForeArm.R'],
    keywords: ['right', 'forearm'],
    excludes: ['hand', 'twist', 'left'],
    fromLm: LM.RIGHT_ELBOW, toLm: LM.RIGHT_WRIST, maxFlexion: Math.PI * 0.92,
  },
  {
    candidates: ['RightHand', 'rightHand', 'hand.R', 'Hand.R'],
    keywords: ['right', 'hand'],
    excludes: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'left'],
    fromLm: LM.RIGHT_WRIST, toLm: LM.RIGHT_INDEX,
  },
  // ── Left leg
  {
    candidates: ['LeftUpLeg', 'leftUpLeg', 'L_UpperLeg', 'thigh.L', 'UpperLeg.L'],
    keywords: ['left', 'upleg'],
    excludes: ['twist', 'right'],
    fromLm: LM.LEFT_HIP, toLm: LM.LEFT_KNEE,
  },
  {
    candidates: ['LeftLeg', 'leftLeg', 'L_LowerLeg', 'shin.L', 'LowerLeg.L'],
    keywords: ['left', 'leg'],
    excludes: ['up', 'foot', 'toe', 'twist', 'right'],
    fromLm: LM.LEFT_KNEE, toLm: LM.LEFT_ANKLE, maxFlexion: Math.PI * 0.92,
  },
  {
    candidates: ['LeftFoot', 'leftFoot', 'foot.L', 'Foot.L'],
    keywords: ['left', 'foot'],
    excludes: ['toe', 'ball', 'right'],
    fromLm: LM.LEFT_ANKLE, toLm: LM.LEFT_FOOT_INDEX,
  },
  // ── Right leg
  {
    candidates: ['RightUpLeg', 'rightUpLeg', 'R_UpperLeg', 'thigh.R', 'UpperLeg.R'],
    keywords: ['right', 'upleg'],
    excludes: ['twist', 'left'],
    fromLm: LM.RIGHT_HIP, toLm: LM.RIGHT_KNEE,
  },
  {
    candidates: ['RightLeg', 'rightLeg', 'R_LowerLeg', 'shin.R', 'LowerLeg.R'],
    keywords: ['right', 'leg'],
    excludes: ['up', 'foot', 'toe', 'twist', 'left'],
    fromLm: LM.RIGHT_KNEE, toLm: LM.RIGHT_ANKLE, maxFlexion: Math.PI * 0.92,
  },
  {
    candidates: ['RightFoot', 'rightFoot', 'foot.R', 'Foot.R'],
    keywords: ['right', 'foot'],
    excludes: ['toe', 'ball', 'left'],
    fromLm: LM.RIGHT_ANKLE, toLm: LM.RIGHT_FOOT_INDEX,
  },
];

function resolveLandmark(idx: number, lms: Landmarks): Landmark | null {
  if (idx < 1000) return lms[idx] ?? null;
  const code = idx - 1000;
  const a = Math.floor(code / 100);
  const b = code % 100;
  const la = lms[a]; const lb = lms[b];
  if (!la || !lb) return null;
  return {
    x: (la.x + lb.x) / 2,
    y: (la.y + lb.y) / 2,
    z: (la.z + lb.z) / 2,
    visibility: Math.min(la.visibility ?? 1, lb.visibility ?? 1),
  };
}

// ─────────────────────────────────────────────────────────────────────
//  One-Euro filter on a 3D landmark stream.
// ─────────────────────────────────────────────────────────────────────

class OneEuroVec {
  private prev: THREE.Vector3 | null = null;
  private prevDeriv = new THREE.Vector3();
  private prevT: number | null = null;
  constructor(private minCutoff = 1.5, private beta = 0.04, private dCutoff = 1.0) {}
  filter(v: THREE.Vector3, tMs: number): THREE.Vector3 {
    if (this.prev === null || this.prevT === null) {
      this.prev = v.clone();
      this.prevT = tMs;
      return v.clone();
    }
    const dt = Math.max(1, tMs - this.prevT) / 1000;
    const dx = v.clone().sub(this.prev).divideScalar(dt);
    const aD = this.alpha(dt, this.dCutoff);
    const edx = this.prevDeriv.clone().multiplyScalar(1 - aD).add(dx.clone().multiplyScalar(aD));
    const cutoff = this.minCutoff + this.beta * edx.length();
    const a = this.alpha(dt, cutoff);
    const out = this.prev.clone().multiplyScalar(1 - a).add(v.clone().multiplyScalar(a));
    this.prev = out;
    this.prevDeriv = edx;
    this.prevT = tMs;
    return out;
  }
  private alpha(dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() {
    this.prev = null;
    this.prevDeriv.set(0, 0, 0);
    this.prevT = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Retargeter
// ─────────────────────────────────────────────────────────────────────

const _vTarget = new THREE.Vector3();
const _vLocal = new THREE.Vector3();
const _qParentWorld = new THREE.Quaternion();
const _qParentWorldInv = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

export class PoseRetargeter {
  private drives: Drive[] = [];
  private hipsBone: THREE.Bone | null = null;

  /** Slerp toward target each frame. Lower = snappier, higher = smoother.
   *  0.04 means we move ~96% of the way to the target on each frame —
   *  basically instant given MediaPipe's own temporal smoothing. */
  private smoothing = 0.04;

  /** Auto-detected MediaPipe Y axis sign:
   *    +1 — landmarks Y is "down" (image convention) → we flip to up.
   *    -1 — landmarks Y is already "up" (world convention) → no flip.
   *  Decided on the first frame where hips and knees are both visible.
   */
  private ySign: 1 | -1 = 1;
  private ySignLocked = false;

  /** Per-landmark One-Euro filters for the 33 keypoints. */
  private filters = new Map<number, OneEuroVec>();
  private filterReportedAt = 0;

  /** Bound to a specific skeleton root. */
  bind(root: THREE.Object3D): void {
    this.drives = [];
    this.hipsBone = null;
    this.filters.clear();
    this.ySignLocked = false;

    // Two maps for matching: exact (normalised) and keyword-search.
    const byNorm = new Map<string, THREE.Bone>();
    root.traverse((obj) => {
      const asBone = obj as THREE.Bone;
      if (asBone.isBone) {
        const norm = normalise(obj.name);
        if (!byNorm.has(norm)) byNorm.set(norm, asBone);
      }
    });

    // Hips — try exact candidates first, then keyword fallback.
    for (const n of ['Hips', 'hips', 'Pelvis', 'pelvis', 'Root', 'root']) {
      const b = byNorm.get(normalise(n));
      if (b) { this.hipsBone = b; break; }
    }
    if (!this.hipsBone) {
      this.hipsBone = keywordMatch(byNorm, ['hip'], ['twist']) ?? keywordMatch(byNorm, ['pelvis'], []) ?? null;
    }

    const resolvedSummary: Record<string, string | null> = {};
    for (const d of DRIVES) {
      let bone: THREE.Bone | undefined;
      let matched = '';
      // Pass 1 — exact (normalised) candidate names.
      for (const cand of d.candidates) {
        const found = byNorm.get(normalise(cand));
        if (found) { bone = found; matched = found.name; break; }
      }
      // Pass 2 — keyword search.
      if (!bone && d.keywords) {
        const found = keywordMatch(byNorm, d.keywords, d.excludes);
        if (found) { bone = found; matched = found.name; }
      }
      if (!bone) {
        this.drives.push({ ...d });
        resolvedSummary[d.candidates[0]!] = null;
        continue;
      }
      // Rest direction = first-child position in local space, normalised.
      const child = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
      const restAxis = child
        ? child.position.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      // Bind-pose parent world quaternion inverse — used for the bind
      // rotation passthrough so the bone's bind orientation is
      // preserved when the target direction matches the rest direction.
      bone.parent?.updateMatrixWorld(true);
      const bindParentInv = new THREE.Quaternion();
      if (bone.parent) {
        bindParentInv.setFromRotationMatrix(_mat.copy(bone.parent.matrixWorld).invert());
      }
      this.drives.push({ ...d, bone, restAxis, bindParentInv });
      resolvedSummary[d.candidates[0]!] = matched;
    }

    const allBones: string[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) allBones.push(o.name); });
    // eslint-disable-next-line no-console
    console.info('[Retarget] rig has', allBones.length, 'bones:', allBones);
    // eslint-disable-next-line no-console
    console.info('[Retarget] resolved drives:', resolvedSummary);
    // eslint-disable-next-line no-console
    console.info('[Retarget] hips bone:', this.hipsBone?.name ?? 'NOT FOUND');

    // Flag any unmatched drives loudly so they're obvious in the
    // console — these are the bones that won't animate until we add
    // the right candidate name.
    const unmatched = Object.entries(resolvedSummary)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    if (unmatched.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Retarget] %d drive(s) did NOT resolve to a bone:',
        unmatched.length,
        unmatched,
        '— share the rig-bones list above so we can map them.',
      );
    }
  }

  /**
   * Public accessors for the in-viewport diagnostic overlay.
   */
  resolvedHipsName(): string | null {
    return this.hipsBone?.name ?? null;
  }

  resolvedDrivesMap(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const d of this.drives) {
      out[d.candidates[0]!] = d.bone?.name ?? null;
    }
    return out;
  }

  /** The auto-detected Y axis sign, or null if not locked yet. */
  ySignDetected(): number | null {
    return this.ySignLocked ? this.ySign : null;
  }

  /**
   * Snapshot the current local rotations of every driven bone as a
   * compact debug string. Useful for the per-second "is anything
   * actually moving" heartbeat in the parent component.
   */
  debugRotations(): string {
    const parts: string[] = [];
    if (this.hipsBone) {
      parts.push(`Hips=${qShort(this.hipsBone.quaternion)}`);
    }
    for (const d of this.drives) {
      if (!d.bone) continue;
      parts.push(`${d.candidates[0]}=${qShort(d.bone.quaternion)}`);
    }
    return parts.join(' | ');
  }

  setSmoothing(s: number) {
    this.smoothing = Math.max(0, Math.min(0.95, s));
  }

  /**
   * Drive the avatar from a fresh MediaPipe world-landmark frame.
   * Coordinates are passed through:
   *   1. Y-axis auto-detect (one-time, on first standing frame)
   *   2. One-Euro temporal smoothing per landmark
   *   3. Direct bone-pointing
   */
  apply(landmarks: Landmarks, tMs: number = performance.now()): void {
    if (!landmarks || landmarks.length < 33) return;

    // ── Step 1: lock the Y-axis sign once we have a clear standing
    //    posture. Hips at vertical "middle", knees clearly below the
    //    hips along the world Y axis. We pick the sign that makes
    //    knees come out *below* hips in world space (positive Y up).
    if (!this.ySignLocked) {
      const lh = landmarks[LM.LEFT_HIP];
      const rh = landmarks[LM.RIGHT_HIP];
      const lk = landmarks[LM.LEFT_KNEE];
      const rk = landmarks[LM.RIGHT_KNEE];
      if (lh && rh && lk && rk && allVisible(0.5, lh, rh, lk, rk)) {
        const hipY = (lh.y + rh.y) / 2;
        const kneeY = (lk.y + rk.y) / 2;
        // If knees Y > hips Y, Y points DOWN in landmark space — we
        // need to flip it. If knees Y < hips Y, Y already points UP.
        this.ySign = kneeY > hipY ? 1 : -1;
        this.ySignLocked = true;
        // eslint-disable-next-line no-console
        console.info('[Retarget] Y axis sign locked:', this.ySign === 1 ? 'flip (image space)' : 'no flip (world space)');
      }
    }

    // ── Step 2: filter every landmark through One-Euro.
    const smoothed: Landmark[] = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      const raw = landmarks[i]!;
      let f = this.filters.get(i);
      if (!f) {
        f = new OneEuroVec(1.5, 0.04, 1.0);
        this.filters.set(i, f);
      }
      const v = f.filter(new THREE.Vector3(raw.x, raw.y, raw.z), tMs);
      smoothed[i] = { x: v.x, y: v.y, z: v.z, visibility: raw.visibility };
    }
    if (tMs - this.filterReportedAt > 5000) {
      this.filterReportedAt = tMs;
    }

    // ── Step 3: hips orientation from torso landmarks.
    if (this.hipsBone) {
      this.driveHips(smoothed);
    }

    // ── Step 4: every other bone, head-to-tail.
    for (const d of this.drives) {
      if (!d.bone || !d.restAxis) continue;
      const a = resolveLandmark(d.fromLm, smoothed);
      const b = resolveLandmark(d.toLm, smoothed);
      if (!a || !b) continue;
      const conf = Math.min(a.visibility ?? 1, b.visibility ?? 1);
      if (conf < (d.minConf ?? 0.35)) continue;

      // World-space target direction. Apply Y flip per the auto-detect.
      _vTarget.set(
         (b.x - a.x),
        -(b.y - a.y) * this.ySign,
         (b.z - a.z),
      );
      const len = _vTarget.length();
      if (len < 1e-5) continue;
      _vTarget.divideScalar(len);

      // Convert world dir → parent-local dir.
      const parent = d.bone.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        _qParentWorld.setFromRotationMatrix(parent.matrixWorld);
        _qParentWorldInv.copy(_qParentWorld).invert();
        _vLocal.copy(_vTarget).applyQuaternion(_qParentWorldInv);
      } else {
        _vLocal.copy(_vTarget);
      }

      _qTarget.setFromUnitVectors(d.restAxis, _vLocal);

      // Anatomical clamp — if the proposed rotation exceeds the bone's
      // maximum-flexion angle from the rest direction, scale it back
      // toward identity. Knees and elbows can't bend further than ~175°.
      if (d.maxFlexion !== undefined) {
        // |w| = cos(angle/2); larger w = smaller rotation. Clamp the
        // implicit rotation angle to ≤ maxFlexion by lifting w.
        const minW = Math.cos(d.maxFlexion / 2);
        const w = Math.abs(_qTarget.w);
        if (w < minW) {
          // Slerp back toward identity (no rotation) by the right amount.
          const denom = Math.sqrt(1 - w * w);
          if (denom > 1e-6) {
            const scale = Math.sqrt(1 - minW * minW) / denom;
            _qTarget.set(
              _qTarget.x * scale,
              _qTarget.y * scale,
              _qTarget.z * scale,
              _qTarget.w >= 0 ? minW : -minW,
            );
            _qTarget.normalize();
          }
        }
      }

      d.bone.quaternion.slerp(_qTarget, 1 - this.smoothing);
    }
  }

  /**
   * Hips orientation — build an orthonormal frame from the user's
   * pelvis (left → right) and torso (hip → shoulder) midline.
   */
  private driveHips(landmarks: Landmark[]): void {
    if (!this.hipsBone) return;
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    if (!lh || !rh || !ls || !rs) return;
    if (!allVisible(0.5, lh, rh, ls, rs)) return;

    // X is the pelvis (left → right hip). Flip so it points along the
    // avatar's right when the user is facing the camera.
    const right = new THREE.Vector3(
       -(rh.x - lh.x),
      -(-(rh.y - lh.y) * this.ySign),
        (rh.z - lh.z),
    ).normalize();
    const up = new THREE.Vector3(
       -(((ls.x + rs.x) / 2) - ((lh.x + rh.x) / 2)),
      -(-(((ls.y + rs.y) / 2) - ((lh.y + rh.y) / 2)) * this.ySign),
        (((ls.z + rs.z) / 2) - ((lh.z + rh.z) / 2)),
    ).normalize();
    const forward = new THREE.Vector3().crossVectors(right, up).normalize();
    const upFixed = new THREE.Vector3().crossVectors(forward, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, upFixed, forward);
    _qTarget.setFromRotationMatrix(m);
    this.hipsBone.quaternion.slerp(_qTarget, 1 - this.smoothing);
  }

  snapshot(): Record<string, [number, number, number, number]> {
    const out: Record<string, [number, number, number, number]> = {};
    if (this.hipsBone) {
      const q = this.hipsBone.quaternion;
      out[this.hipsBone.name] = [q.x, q.y, q.z, q.w];
    }
    for (const d of this.drives) {
      if (!d.bone) continue;
      const q = d.bone.quaternion;
      out[d.bone.name] = [q.x, q.y, q.z, q.w];
    }
    return out;
  }
}

function allVisible(threshold: number, ...lms: Landmark[]): boolean {
  for (const l of lms) {
    if ((l.visibility ?? 1) < threshold) return false;
  }
  return true;
}

function qShort(q: THREE.Quaternion): string {
  return `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)},${q.w.toFixed(2)}`;
}
