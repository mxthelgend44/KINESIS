'use client';

import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { LM } from '@kinesis/pose';

/**
 * Anatomically-faithful skeleton renderer driven by MediaPipe pose
 * landmarks.
 *
 * MediaPipe only gives us 33 skin-surface landmarks. The real human
 * skeleton has joints they don't observe — pelvis centre, lumbar /
 * thoracic spine, sternum, atlanto-occipital pivot, head crown, finger
 * centroid, toe centroid. We synthesise those from the landmarks we do
 * have so the figure looks like a person and not a stick man.
 *
 * Two additional layers stabilise the result:
 *
 *   1. One-Euro filter per landmark, kills jitter without lag.
 *   2. A bone-length calibrator that learns the patient's actual limb
 *      lengths from the first ~3 s of high-visibility frames, then
 *      pins those lengths via parent → child IK on every subsequent
 *      frame. This eats MediaPipe's depth wobble — the femur stops
 *      "breathing" between 0.42 m and 0.51 m and just sits at the
 *      measured 0.46 m, the way a real femur does.
 *
 * Coordinate frame: MediaPipe worldLandmarks come in metres with Y
 * pointing DOWN (image convention) and X mirrored (subject's left is
 * positive). We flip both so the figure stands up in Three.js' Y-up
 * world and the avatar's left side is on screen-left.
 */

export type Landmark = { x: number; y: number; z: number; visibility?: number };
export type Landmarks = readonly Landmark[];

export type SkeletonMeshHandle = {
  pushFrame: (landmarks: Landmark[], tMs: number) => void;
  startRecording: () => void;
  stopRecording: () => SkeletonMocapBuffer;
  isRecording: () => boolean;
  frameCount: () => number;
};

export type SkeletonMocapBuffer = {
  startMs: number;
  durationMs: number;
  /** One frame = world-space xyz of every landmark (33 MediaPipe +
   *  11 derived = 44 points, 132 numbers). Compact + trivially
   *  serialisable to Firestore. */
  frames: Array<{ tMs: number; xyz: number[] }>;
};

type Props = {
  height?: number;
  background?: string;
  paused?: boolean;
  /** Callback invoked once on mount with the imperative handle. Used
   *  in preference to React refs because `next/dynamic` does not
   *  forward refs through to the wrapped component. */
  onReady?: (handle: SkeletonMeshHandle) => void;
};

// ─────────────────────────────────────────────────────────────────────
//  Anatomy — derived landmark indices, bone hierarchy, proportions
// ─────────────────────────────────────────────────────────────────────

/**
 * Synthetic landmark indices for joints MediaPipe doesn't observe
 * directly. Stored in the same flat positions array as the raw
 * landmarks, starting at index 33.
 */
const A = {
  PELVIS:     33, // sacrum / hip midpoint — root of the skeleton
  SPINE_L:    34, // lumbar (~L3) — 1/3 of the way up the spine
  SPINE_T:    35, // thoracic (~T6) — 2/3 of the way up
  STERNUM:    36, // manubrium / shoulder midpoint
  NECK:       37, // C7 / base of neck
  HEAD_BASE:  38, // atlanto-occipital pivot (≈ ear-to-ear midpoint)
  HEAD_TOP:   39, // crown of head
  L_HAND:     40, // centroid of left pinky/index/thumb
  R_HAND:     41,
  L_FOOT:     42, // mid-foot (between heel and toe)
  R_FOOT:     43,
} as const;

const POSITION_COUNT = 44;

/**
 * Bone hierarchy: [child, parent]. Order matters — parents must
 * appear before their descendants so the IK pass can resolve top-down.
 */
const SKELETON: Array<[number, number]> = [
  // Pelvis → hips (zero-length offset; hips inherit pelvis)
  [LM.LEFT_HIP,  A.PELVIS],
  [LM.RIGHT_HIP, A.PELVIS],
  // Spine chain (pelvis → lumbar → thoracic → sternum → neck → head)
  [A.SPINE_L,    A.PELVIS],
  [A.SPINE_T,    A.SPINE_L],
  [A.STERNUM,    A.SPINE_T],
  [A.NECK,       A.STERNUM],
  [A.HEAD_BASE,  A.NECK],
  [A.HEAD_TOP,   A.HEAD_BASE],
  // Arms (clavicle anchored to sternum, not shoulder)
  [LM.LEFT_SHOULDER,  A.STERNUM],
  [LM.RIGHT_SHOULDER, A.STERNUM],
  [LM.LEFT_ELBOW,  LM.LEFT_SHOULDER],
  [LM.RIGHT_ELBOW, LM.RIGHT_SHOULDER],
  [LM.LEFT_WRIST,  LM.LEFT_ELBOW],
  [LM.RIGHT_WRIST, LM.RIGHT_ELBOW],
  [A.L_HAND, LM.LEFT_WRIST],
  [A.R_HAND, LM.RIGHT_WRIST],
  // Legs
  [LM.LEFT_KNEE,  LM.LEFT_HIP],
  [LM.RIGHT_KNEE, LM.RIGHT_HIP],
  [LM.LEFT_ANKLE,  LM.LEFT_KNEE],
  [LM.RIGHT_ANKLE, LM.RIGHT_KNEE],
  [A.L_FOOT, LM.LEFT_ANKLE],
  [A.R_FOOT, LM.RIGHT_ANKLE],
];

/**
 * Joints we render as visible spheres. Major joints + derived
 * anatomical pivots. Skips redundant face/finger landmarks.
 */
const JOINT_INDICES = [
  A.HEAD_TOP, A.HEAD_BASE,
  LM.LEFT_EAR, LM.RIGHT_EAR,
  A.NECK,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  A.STERNUM,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  A.SPINE_T, A.SPINE_L,
  A.L_HAND, A.R_HAND,
  A.PELVIS,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  A.L_FOOT, A.R_FOOT,
];

/** Per-joint sphere radius in metres. Tuned to roughly match the
 *  anatomical size of each articulation (knees + shoulders prominent;
 *  spine vertebrae small; ear/foot landmarks minimal). */
const JOINT_RADIUS: Partial<Record<number, number>> = {
  [A.HEAD_TOP]: 0.0,    // hidden — head ellipsoid covers it
  [A.HEAD_BASE]: 0.022,
  [LM.LEFT_EAR]: 0.0, [LM.RIGHT_EAR]: 0.0, // hidden — inside head mesh
  [A.NECK]: 0.026,
  [LM.LEFT_SHOULDER]: 0.048, [LM.RIGHT_SHOULDER]: 0.048,
  [A.STERNUM]: 0.030,
  [LM.LEFT_ELBOW]: 0.034, [LM.RIGHT_ELBOW]: 0.034,
  [LM.LEFT_WRIST]: 0.026, [LM.RIGHT_WRIST]: 0.026,
  [A.SPINE_T]: 0.026, [A.SPINE_L]: 0.030,
  [A.L_HAND]: 0.0, [A.R_HAND]: 0.0,         // hidden — palm mesh covers it
  [A.PELVIS]: 0.040,
  [LM.LEFT_HIP]: 0.050, [LM.RIGHT_HIP]: 0.050,
  [LM.LEFT_KNEE]: 0.045, [LM.RIGHT_KNEE]: 0.045,
  [LM.LEFT_ANKLE]: 0.030, [LM.RIGHT_ANKLE]: 0.030,
  [A.L_FOOT]: 0.0, [A.R_FOOT]: 0.0,         // hidden — foot mesh covers it
};

/**
 * Per-bone radii. `[proximal, distal]` lets us taper limbs naturally
 * — femurs are thicker at the hip than the knee, humeri wider at the
 *  shoulder than the elbow, etc. Anatomical and looks much less
 *  "tube-of-pasta" than uniform cylinders.
 */
type BoneShape = { r0: number; r1: number };
function boneShape(a: number, b: number): BoneShape {
  // Spine — slight taper, fattest at lumbar
  if (a === A.PELVIS && b === A.SPINE_L) return { r0: 0.044, r1: 0.040 };
  if (a === A.SPINE_L && b === A.SPINE_T) return { r0: 0.040, r1: 0.034 };
  if (a === A.SPINE_T && b === A.STERNUM) return { r0: 0.034, r1: 0.038 }; // widens at chest
  if (a === A.STERNUM && b === A.NECK) return { r0: 0.030, r1: 0.024 };
  if (a === A.NECK && b === A.HEAD_BASE) return { r0: 0.024, r1: 0.026 };
  // Hips
  if (a === A.PELVIS && b === LM.LEFT_HIP) return { r0: 0.044, r1: 0.040 };
  if (a === A.PELVIS && b === LM.RIGHT_HIP) return { r0: 0.044, r1: 0.040 };
  // Clavicle
  if (a === A.STERNUM && b === LM.LEFT_SHOULDER) return { r0: 0.026, r1: 0.030 };
  if (a === A.STERNUM && b === LM.RIGHT_SHOULDER) return { r0: 0.026, r1: 0.030 };
  // Arm
  if ((a === LM.LEFT_SHOULDER && b === LM.LEFT_ELBOW) ||
      (a === LM.RIGHT_SHOULDER && b === LM.RIGHT_ELBOW)) return { r0: 0.032, r1: 0.026 }; // humerus
  if ((a === LM.LEFT_ELBOW && b === LM.LEFT_WRIST) ||
      (a === LM.RIGHT_ELBOW && b === LM.RIGHT_WRIST)) return { r0: 0.026, r1: 0.020 }; // forearm
  if ((a === LM.LEFT_WRIST && b === A.L_HAND) ||
      (a === LM.RIGHT_WRIST && b === A.R_HAND)) return { r0: 0.020, r1: 0.024 }; // palm
  // Leg
  if ((a === LM.LEFT_HIP && b === LM.LEFT_KNEE) ||
      (a === LM.RIGHT_HIP && b === LM.RIGHT_KNEE)) return { r0: 0.046, r1: 0.036 }; // femur — thickest
  if ((a === LM.LEFT_KNEE && b === LM.LEFT_ANKLE) ||
      (a === LM.RIGHT_KNEE && b === LM.RIGHT_ANKLE)) return { r0: 0.035, r1: 0.024 }; // tibia
  if ((a === LM.LEFT_ANKLE && b === A.L_FOOT) ||
      (a === LM.RIGHT_ANKLE && b === A.R_FOOT)) return { r0: 0.024, r1: 0.022 };
  return { r0: 0.022, r1: 0.022 };
}

/**
 * Vitruvian proportions, normalised to body height = 1.0. We only use
 * these for derived joints (spine, neck, head, hand, foot) — the limb
 * lengths themselves are measured directly from MediaPipe.
 */
const PROP = {
  /** Fraction of pelvis→sternum at which the lumbar pivot sits. */
  spineLumbarFrac: 0.36,
  /** Fraction of pelvis→sternum at which the thoracic pivot sits. */
  spineThoracicFrac: 0.72,
  /** Sternum → neck length as fraction of body height. */
  neckOffsetFrac: 0.045,
  /** Head height (base → top) as fraction of body height. */
  headHeightFrac: 0.135,
  /** Wrist → fingertip length as fraction of body height. */
  handLengthFrac: 0.095,
  /** Ankle → toe length as fraction of body height. */
  footLengthFrac: 0.108,
} as const;

// ─────────────────────────────────────────────────────────────────────
//  One-Euro filter on a 3D vector — kills jitter without lag.
// ─────────────────────────────────────────────────────────────────────

class OneEuroVec3 {
  private prev: THREE.Vector3 | null = null;
  private prevDeriv = new THREE.Vector3();
  private prevT: number | null = null;
  constructor(private minCutoff = 1.5, private beta = 0.03, private dCutoff = 1.0) {}
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
  private alpha(dt: number, cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Bone-length calibrator
//
//  For each [child, parent] in the skeleton, we collect observed
//  distances from frames where both endpoints have high visibility.
//  After we've seen ~30 good frames per bone we lock in a rest length
//  (median of observations — robust to outliers). The render pass then
//  uses these rest lengths to constrain limb proportions, so the
//  figure stops "breathing" with MediaPipe's depth jitter.
// ─────────────────────────────────────────────────────────────────────

class BoneLengths {
  private samples = new Map<string, number[]>();
  private locked = new Map<string, number>();
  private readonly samplesNeeded = 25;
  private readonly maxSamples = 80;
  private readonly minVisibility = 0.7;

  /** Body-height estimate — distance from head top to mid-foot during
   *  calibration. Used to compute proportions for derived bones we
   *  can't sample directly (head height, neck offset, hand, foot). */
  private heightSamples: number[] = [];
  private bodyHeight = 1.7; // sensible default in metres

  private key(a: number, b: number) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  /** Push an observed distance for a bone if both endpoints are
   *  visible enough. Once we have N samples we never accept more —
   *  the rest length is locked. */
  observe(a: number, b: number, dist: number, visA: number, visB: number) {
    if (visA < this.minVisibility || visB < this.minVisibility) return;
    if (dist <= 0 || !isFinite(dist)) return;
    const k = this.key(a, b);
    if (this.locked.has(k)) return;
    const arr = this.samples.get(k) ?? [];
    arr.push(dist);
    if (arr.length > this.maxSamples) arr.shift();
    this.samples.set(k, arr);
    if (arr.length >= this.samplesNeeded) {
      const sorted = [...arr].sort((x, y) => x - y);
      this.locked.set(k, sorted[Math.floor(sorted.length / 2)]!);
    }
  }

  observeHeight(h: number) {
    if (h <= 0 || !isFinite(h)) return;
    this.heightSamples.push(h);
    if (this.heightSamples.length > 60) this.heightSamples.shift();
    if (this.heightSamples.length >= 20) {
      const sorted = [...this.heightSamples].sort((x, y) => x - y);
      // 75th percentile — biased toward fully-extended frames
      this.bodyHeight = sorted[Math.floor(sorted.length * 0.75)]!;
    }
  }

  /** Returns rest length for bone (a,b) if calibrated, else null. */
  get(a: number, b: number): number | null {
    const k = this.key(a, b);
    return this.locked.get(k) ?? null;
  }

  /** Returns the current best estimate (locked or running median). */
  getOrDefault(a: number, b: number, fallback: number): number {
    const k = this.key(a, b);
    const locked = this.locked.get(k);
    if (locked !== undefined) return locked;
    const arr = this.samples.get(k);
    if (arr && arr.length >= 6) {
      const sorted = [...arr].sort((x, y) => x - y);
      return sorted[Math.floor(sorted.length / 2)]!;
    }
    return fallback;
  }

  height(): number {
    return this.bodyHeight;
  }

  calibrationProgress(): number {
    const total = SKELETON.length;
    let locked = 0;
    for (const [c, p] of SKELETON) if (this.locked.has(this.key(c, p))) locked++;
    return locked / total;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Derived landmark computation
//
//  Fills indices 33..43 of the position array from the 33 raw
//  MediaPipe landmarks. Spine points are interpolated along the
//  pelvis → sternum line; head top is offset along the body's vertical
//  axis; hand/foot centres are landmark centroids.
// ─────────────────────────────────────────────────────────────────────

function computeDerived(
  positions: THREE.Vector3[],
  visibility: number[],
  bones: BoneLengths,
) {
  // Pelvis — hip midpoint
  const lh = positions[LM.LEFT_HIP]!;
  const rh = positions[LM.RIGHT_HIP]!;
  positions[A.PELVIS]!.set(
    (lh.x + rh.x) / 2,
    (lh.y + rh.y) / 2,
    (lh.z + rh.z) / 2,
  );
  visibility[A.PELVIS] = Math.min(visibility[LM.LEFT_HIP] ?? 1, visibility[LM.RIGHT_HIP] ?? 1);

  // Sternum — shoulder midpoint
  const ls = positions[LM.LEFT_SHOULDER]!;
  const rs = positions[LM.RIGHT_SHOULDER]!;
  positions[A.STERNUM]!.set(
    (ls.x + rs.x) / 2,
    (ls.y + rs.y) / 2,
    (ls.z + rs.z) / 2,
  );
  visibility[A.STERNUM] = Math.min(visibility[LM.LEFT_SHOULDER] ?? 1, visibility[LM.RIGHT_SHOULDER] ?? 1);

  // Spine — lumbar (~L3) and thoracic (~T6) along the pelvis→sternum line,
  // with a small forward bulge so the back has a natural curve rather
  // than a straight ramrod look. Forward direction is derived from the
  // shoulder/hip plane.
  const pelvis = positions[A.PELVIS]!;
  const stern = positions[A.STERNUM]!;
  const spineUp = new THREE.Vector3().subVectors(stern, pelvis);
  const spineLen = spineUp.length() || 1;
  // Forward = perpendicular to spine, in the shoulder-shoulder plane,
  // pointing out from the chest. Approximated as cross(spine, hip-to-hip).
  const hipAxis = new THREE.Vector3().subVectors(rh, lh).normalize();
  const forward = new THREE.Vector3().crossVectors(spineUp, hipAxis).normalize();

  const lumbarFwd = spineLen * 0.04; // lordosis bulge
  const thoracicFwd = -spineLen * 0.02; // kyphosis (slight)

  positions[A.SPINE_L]!.copy(pelvis)
    .addScaledVector(spineUp, PROP.spineLumbarFrac)
    .addScaledVector(forward, lumbarFwd);
  positions[A.SPINE_T]!.copy(pelvis)
    .addScaledVector(spineUp, PROP.spineThoracicFrac)
    .addScaledVector(forward, thoracicFwd);
  visibility[A.SPINE_L] = Math.min(visibility[A.PELVIS]!, visibility[A.STERNUM]!);
  visibility[A.SPINE_T] = visibility[A.SPINE_L];

  // Neck — slightly above sternum, anatomical C7 sits posterior to
  // the manubrium so we step back a fraction along the body axis.
  const bodyUp = spineUp.clone().normalize();
  positions[A.NECK]!.copy(stern).addScaledVector(bodyUp, bones.height() * PROP.neckOffsetFrac);
  visibility[A.NECK] = visibility[A.STERNUM]!;

  // Head base — midpoint of ears is anatomically the atlanto-occipital
  // pivot. Fall back to nose if ears are occluded.
  const le = positions[LM.LEFT_EAR]!;
  const re = positions[LM.RIGHT_EAR]!;
  const earsVis = Math.min(visibility[LM.LEFT_EAR] ?? 0, visibility[LM.RIGHT_EAR] ?? 0);
  if (earsVis > 0.4) {
    positions[A.HEAD_BASE]!.set(
      (le.x + re.x) / 2,
      (le.y + re.y) / 2,
      (le.z + re.z) / 2,
    );
    visibility[A.HEAD_BASE] = earsVis;
  } else {
    // Fall back to nose for the pivot; the head won't rotate as
    // accurately but it stays roughly placed.
    const nose = positions[LM.NOSE]!;
    positions[A.HEAD_BASE]!.copy(nose);
    visibility[A.HEAD_BASE] = visibility[LM.NOSE] ?? 0;
  }

  // Head top — base + headHeight along body-up.
  positions[A.HEAD_TOP]!.copy(positions[A.HEAD_BASE]!)
    .addScaledVector(bodyUp, bones.height() * PROP.headHeightFrac);
  visibility[A.HEAD_TOP] = visibility[A.HEAD_BASE]!;

  // Hand centres — centroid of pinky / index / thumb. If those are
  // occluded fall back to the wrist position so the palm mesh stays
  // attached.
  computeHand(positions, visibility, A.L_HAND, LM.LEFT_WRIST, LM.LEFT_PINKY, LM.LEFT_INDEX, LM.LEFT_THUMB);
  computeHand(positions, visibility, A.R_HAND, LM.RIGHT_WRIST, LM.RIGHT_PINKY, LM.RIGHT_INDEX, LM.RIGHT_THUMB);

  // Foot centres — midpoint of heel and toe.
  computeFoot(positions, visibility, A.L_FOOT, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX);
  computeFoot(positions, visibility, A.R_FOOT, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX);
}

function computeHand(
  pos: THREE.Vector3[], vis: number[],
  hand: number, wrist: number, pinky: number, index: number, thumb: number,
) {
  const visMin = Math.min(vis[pinky] ?? 0, vis[index] ?? 0, vis[thumb] ?? 0);
  if (visMin > 0.4) {
    pos[hand]!.set(
      (pos[pinky]!.x + pos[index]!.x + pos[thumb]!.x) / 3,
      (pos[pinky]!.y + pos[index]!.y + pos[thumb]!.y) / 3,
      (pos[pinky]!.z + pos[index]!.z + pos[thumb]!.z) / 3,
    );
    vis[hand] = visMin;
  } else {
    // Lazy hand — sit at the wrist
    pos[hand]!.copy(pos[wrist]!);
    vis[hand] = vis[wrist] ?? 0;
  }
}

function computeFoot(
  pos: THREE.Vector3[], vis: number[],
  foot: number, ankle: number, heel: number, toe: number,
) {
  const visMin = Math.min(vis[heel] ?? 0, vis[toe] ?? 0);
  if (visMin > 0.3) {
    pos[foot]!.set(
      (pos[heel]!.x + pos[toe]!.x) / 2,
      (pos[heel]!.y + pos[toe]!.y) / 2,
      (pos[heel]!.z + pos[toe]!.z) / 2,
    );
    vis[foot] = visMin;
  } else {
    pos[foot]!.copy(pos[ankle]!);
    vis[foot] = vis[ankle] ?? 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Anatomical IK pass
//
//  Walk the skeleton hierarchy in topological order. For each bone,
//  preserve the *direction* from parent to observed child but pin the
//  *length* to the calibrated rest length. This eats MediaPipe depth
//  jitter while preserving real motion. Hips are fixed offsets from
//  pelvis (no IK), so the figure pivots around its hip line cleanly.
// ─────────────────────────────────────────────────────────────────────

function applyIK(positions: THREE.Vector3[], bones: BoneLengths) {
  const tmpDir = new THREE.Vector3();
  const observed = positions.map((v) => v.clone()); // raw, pre-IK
  for (const [child, parent] of SKELETON) {
    const restLen = bones.get(parent, child);
    if (restLen === null) continue; // not calibrated yet — let the raw position pass through
    tmpDir.subVectors(observed[child]!, observed[parent]!);
    const observedLen = tmpDir.length();
    if (observedLen < 1e-5) continue;
    tmpDir.divideScalar(observedLen);
    positions[child]!.copy(positions[parent]!).addScaledVector(tmpDir, restLen);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  SkeletonMesh — main exported component
// ─────────────────────────────────────────────────────────────────────

export function SkeletonMesh({
  height = 360,
  background = '#0E1822',
  paused = false,
  onReady,
}: Props) {
  // Shared between the imperative API and the SkeletonScene component.
  // Positions stored in a flat ref so we update them in-place without
  // re-rendering React on every frame. 44 slots = 33 MediaPipe + 11 derived.
  const positionsRef = useRef<THREE.Vector3[]>(
    Array.from({ length: POSITION_COUNT }, () => new THREE.Vector3(0, 0, 0)),
  );
  const visibilityRef = useRef<number[]>(new Array(POSITION_COUNT).fill(0));
  const haveDataRef = useRef(false);
  const filtersRef = useRef<OneEuroVec3[]>(
    Array.from({ length: 33 }, () => new OneEuroVec3()),
  );
  const bonesRef = useRef(new BoneLengths());

  const recordingRef = useRef(false);
  const bufferRef = useRef<SkeletonMocapBuffer | null>(null);
  const frameCountRef = useRef(0);

  // Diagnostic counters for the overlay
  const [frameTick, setFrameTick] = useState(0);
  const [calibProgress, setCalibProgress] = useState(0);
  const lastDiagPushRef = useRef(0);

  // Keep latest paused in a ref so the handle closure stays correct
  // without rebuilding the handle (and re-firing onReady).
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    const handle: SkeletonMeshHandle = {
      pushFrame(landmarks, tMs) {
        if (pausedRef.current) return;
        if (!landmarks || landmarks.length < 33) return;
        frameCountRef.current++;
        haveDataRef.current = true;

        // 1. Smooth each raw MediaPipe landmark. Flip X+Y so the
        //    figure stands up and the left side is on screen-left.
        const positions = positionsRef.current;
        const visibility = visibilityRef.current;
        for (let i = 0; i < 33; i++) {
          const p = landmarks[i]!;
          const raw = new THREE.Vector3(-p.x, -p.y, p.z);
          const smooth = filtersRef.current[i]!.filter(raw, tMs);
          positions[i]!.copy(smooth);
          visibility[i] = p.visibility ?? 1;
        }

        // 2. Derive anatomical landmarks (spine, neck, head, hands, feet).
        computeDerived(positions, visibility, bonesRef.current);

        // 3. Observe bone lengths during calibration.
        for (const [c, p] of SKELETON) {
          const d = positions[c]!.distanceTo(positions[p]!);
          bonesRef.current.observe(c, p, d, visibility[c] ?? 0, visibility[p] ?? 0);
        }
        // Track body height (head top → mid-foot midpoint) so we can
        // proportion the derived neck / head / hand / foot bones.
        const lf = positions[A.L_FOOT]!;
        const rf = positions[A.R_FOOT]!;
        const midFoot = new THREE.Vector3(
          (lf.x + rf.x) / 2,
          (lf.y + rf.y) / 2,
          (lf.z + rf.z) / 2,
        );
        const headTop = positions[A.HEAD_TOP]!;
        const totalH = headTop.distanceTo(midFoot);
        const vMin = Math.min(
          visibility[A.HEAD_TOP] ?? 0,
          visibility[A.L_FOOT] ?? 0,
          visibility[A.R_FOOT] ?? 0,
        );
        if (vMin > 0.5) bonesRef.current.observeHeight(totalH);

        // 4. Run the anatomical IK pass — pin each bone's length to
        //    its calibrated rest length, preserving direction.
        applyIK(positions, bonesRef.current);

        // 5. Record motion-capture frame if requested.
        if (recordingRef.current) {
          const buf = bufferRef.current;
          if (buf) {
            const xyz: number[] = [];
            for (const v of positions) xyz.push(v.x, v.y, v.z);
            buf.frames.push({ tMs, xyz });
            buf.durationMs = Math.max(buf.durationMs, tMs - buf.startMs);
          }
        }

        // 6. Diag heartbeat once a second.
        if (tMs - lastDiagPushRef.current > 1000) {
          lastDiagPushRef.current = tMs;
          setFrameTick((n) => n + 1);
          setCalibProgress(bonesRef.current.calibrationProgress());
        }
      },
      startRecording() {
        recordingRef.current = true;
        bufferRef.current = { startMs: Date.now(), durationMs: 0, frames: [] };
      },
      stopRecording() {
        recordingRef.current = false;
        const buf = bufferRef.current ?? { startMs: Date.now(), durationMs: 0, frames: [] };
        bufferRef.current = null;
        return buf;
      },
      isRecording() {
        return recordingRef.current;
      },
      frameCount() {
        return bufferRef.current?.frames.length ?? 0;
      },
    };
    onReadyRef.current?.(handle);
  }, []);

  const calibPct = Math.round(calibProgress * 100);
  const calibrated = calibPct >= 99;

  return (
    <div style={{ position: 'relative' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 0.1, 2.2], fov: 32 }}
        style={{ height, background, borderRadius: 14, display: 'block' }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[2.5, 4, 3]}
          intensity={1.25}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#5BD6A0" />
        <directionalLight position={[0, -2, 2]} intensity={0.2} color="#FFC97D" />
        <SkeletonScene
          positionsRef={positionsRef}
          visibilityRef={visibilityRef}
          haveDataRef={haveDataRef}
          bonesRef={bonesRef}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]} receiveShadow>
          <circleGeometry args={[2, 32]} />
          <shadowMaterial opacity={0.4} />
        </mesh>
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={1.2}
          maxDistance={5}
          target={[0, 0, 0]}
          maxPolarAngle={Math.PI * 0.85}
        />
      </Canvas>
      {/* Status pill — calibration + live frame rate */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '4px 8px',
          borderRadius: 999,
          background: 'rgba(10, 17, 24, 0.85)',
          color: haveDataRef.current
            ? (calibrated ? '#5BD6A0' : '#FFC97D')
            : '#FFC97D',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          border: '1px solid rgba(255,255,255,0.1)',
          letterSpacing: '0.06em',
        }}
      >
        {!haveDataRef.current
          ? 'WAITING…'
          : !calibrated
          ? `CALIB ${calibPct}%`
          : `LIVE · ${frameTick}Hz`}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  SkeletonScene — renders bones (tapered cylinders), joints (spheres),
//  head (ellipsoid), and hands/feet (capsules). Mutates mesh transforms
//  in useFrame rather than React state so we stay at 60 fps.
// ─────────────────────────────────────────────────────────────────────

function SkeletonScene({
  positionsRef,
  visibilityRef,
  haveDataRef,
  bonesRef,
}: {
  positionsRef: React.MutableRefObject<THREE.Vector3[]>;
  visibilityRef: React.MutableRefObject<number[]>;
  haveDataRef: React.MutableRefObject<boolean>;
  bonesRef: React.MutableRefObject<BoneLengths>;
}) {
  const jointRefs = useRef<(THREE.Mesh | null)[]>([]);
  const boneRefs = useRef<(THREE.Mesh | null)[]>([]);
  const headRef = useRef<THREE.Mesh>(null);
  const lHandRef = useRef<THREE.Mesh>(null);
  const rHandRef = useRef<THREE.Mesh>(null);
  const lFootRef = useRef<THREE.Mesh>(null);
  const rFootRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Reusable vectors so we don't allocate per frame.
  const _mid = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  useFrame(() => {
    if (!haveDataRef.current) return;
    const positions = positionsRef.current;
    const visibility = visibilityRef.current;

    // Centre on the pelvis so the figure stays in frame.
    const pelvis = positions[A.PELVIS]!;
    if (groupRef.current) groupRef.current.position.set(-pelvis.x, -pelvis.y, -pelvis.z);

    // ── Joints (spheres) ──
    for (let i = 0; i < JOINT_INDICES.length; i++) {
      const lmIdx = JOINT_INDICES[i]!;
      const mesh = jointRefs.current[i];
      if (!mesh) continue;
      // Placeholder slot (hidden ears / hands / feet — those are
      // covered by the head ellipsoid or extremity capsules). Skip
      // material updates; the default material has no `emissive`.
      if ((JOINT_RADIUS[lmIdx] ?? 0.025) <= 0) {
        mesh.visible = false;
        continue;
      }
      const p = positions[lmIdx]!;
      const v = visibility[lmIdx] ?? 1;
      mesh.position.set(p.x, p.y, p.z);
      mesh.visible = v >= 0.4;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const c = visibilityColour(v);
      mat.color.copy(c);
      mat.emissive.copy(c).multiplyScalar(0.18);
    }

    // ── Bones (tapered cylinders along the SKELETON hierarchy) ──
    for (let i = 0; i < SKELETON.length; i++) {
      const [c, p] = SKELETON[i]!;
      const mesh = boneRefs.current[i];
      if (!mesh) continue;
      const pa = positions[p]!;
      const pb = positions[c]!;
      const va = visibility[p] ?? 1;
      const vb = visibility[c] ?? 1;
      if (va < 0.4 || vb < 0.4) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;

      _dir.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      const len = _dir.length();
      if (len < 1e-4) {
        mesh.visible = false;
        continue;
      }
      _mid.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
      mesh.position.copy(_mid);
      _dir.divideScalar(len);
      mesh.quaternion.setFromUnitVectors(_up, _dir);
      // CylinderGeometry default has length 1 — scale Y to bone length.
      mesh.scale.set(1, len, 1);

      const v = (va + vb) / 2;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const col = visibilityColour(v);
      mat.color.copy(col);
      mat.emissive.copy(col).multiplyScalar(0.12);
    }

    // ── Head (ellipsoid between HEAD_BASE and HEAD_TOP) ──
    if (headRef.current) {
      const base = positions[A.HEAD_BASE]!;
      const top = positions[A.HEAD_TOP]!;
      _dir.set(top.x - base.x, top.y - base.y, top.z - base.z);
      const hLen = _dir.length();
      if (hLen > 1e-4) {
        // Place the centre between base and top — but biased upward
        // since the head's anatomical centre of mass sits above the
        // atlanto-occipital pivot.
        _mid.copy(base).addScaledVector(_dir, 0.5);
        headRef.current.position.copy(_mid);
        _dir.divideScalar(hLen);
        headRef.current.quaternion.setFromUnitVectors(_up, _dir);
        // The base sphere geometry is unit-radius; scale to head shape.
        const skull = bonesRef.current.height() * 0.085;
        headRef.current.scale.set(skull * 0.95, hLen * 0.55, skull);
        headRef.current.visible = (visibility[A.HEAD_BASE] ?? 0) > 0.3;
      }
    }

    // ── Hands + feet (capsules) ──
    updateExtremity(lHandRef.current, positions[LM.LEFT_WRIST]!, positions[A.L_HAND]!,
      visibility[LM.LEFT_WRIST] ?? 0, visibility[A.L_HAND] ?? 0, 0.028, 0.018);
    updateExtremity(rHandRef.current, positions[LM.RIGHT_WRIST]!, positions[A.R_HAND]!,
      visibility[LM.RIGHT_WRIST] ?? 0, visibility[A.R_HAND] ?? 0, 0.028, 0.018);
    updateExtremity(lFootRef.current, positions[LM.LEFT_ANKLE]!, positions[A.L_FOOT]!,
      visibility[LM.LEFT_ANKLE] ?? 0, visibility[A.L_FOOT] ?? 0, 0.034, 0.026);
    updateExtremity(rFootRef.current, positions[LM.RIGHT_ANKLE]!, positions[A.R_FOOT]!,
      visibility[LM.RIGHT_ANKLE] ?? 0, visibility[A.R_FOOT] ?? 0, 0.034, 0.026);
  });

  return (
    <group ref={groupRef}>
      {/* Joints */}
      {JOINT_INDICES.map((lmIdx, i) => {
        const r = JOINT_RADIUS[lmIdx] ?? 0.025;
        if (r <= 0) {
          // Render an empty placeholder so the ref index stays aligned,
          // but it's invisible. (Keeps the JOINT_INDICES → jointRefs
          // mapping simple.)
          return <mesh key={`j${i}`} ref={(m) => { jointRefs.current[i] = m; }} visible={false} />;
        }
        return (
          <mesh
            key={`j${i}`}
            ref={(m) => { jointRefs.current[i] = m; }}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[r, 24, 24]} />
            <meshStandardMaterial
              color="#5BD6A0"
              emissive="#5BD6A0"
              emissiveIntensity={0.2}
              roughness={0.35}
              metalness={0.08}
            />
          </mesh>
        );
      })}

      {/* Bones — tapered cylinders. CylinderGeometry(r0, r1, …) gives
          us the proximal/distal taper for free. */}
      {SKELETON.map(([c, p], i) => {
        const { r0, r1 } = boneShape(p, c);
        return (
          <mesh
            key={`b${i}`}
            ref={(m) => { boneRefs.current[i] = m; }}
            castShadow
            receiveShadow
          >
            {/* args: (rTop, rBottom, height, radialSegments). Top = distal
                because the cylinder is oriented +Y from midpoint and we
                rotate the +Y axis to point at the child. */}
            <cylinderGeometry args={[r1, r0, 1, 18]} />
            <meshStandardMaterial
              color="#C9D4E0"
              emissive="#1A2530"
              emissiveIntensity={0.15}
              roughness={0.45}
              metalness={0.12}
            />
          </mesh>
        );
      })}

      {/* Head — sphere we scale into an ellipsoid. */}
      <mesh ref={headRef} castShadow receiveShadow>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color="#D9E2EC"
          emissive="#1F2C38"
          emissiveIntensity={0.18}
          roughness={0.4}
          metalness={0.06}
        />
      </mesh>

      {/* Hands + feet — capsule geometry (rounded both ends). */}
      <mesh ref={lHandRef} castShadow receiveShadow>
        <capsuleGeometry args={[0.02, 1, 8, 18]} />
        <meshStandardMaterial color="#C9D4E0" emissive="#1A2530" emissiveIntensity={0.12} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh ref={rHandRef} castShadow receiveShadow>
        <capsuleGeometry args={[0.02, 1, 8, 18]} />
        <meshStandardMaterial color="#C9D4E0" emissive="#1A2530" emissiveIntensity={0.12} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh ref={lFootRef} castShadow receiveShadow>
        <capsuleGeometry args={[0.025, 1, 8, 18]} />
        <meshStandardMaterial color="#C9D4E0" emissive="#1A2530" emissiveIntensity={0.12} roughness={0.55} metalness={0.1} />
      </mesh>
      <mesh ref={rFootRef} castShadow receiveShadow>
        <capsuleGeometry args={[0.025, 1, 8, 18]} />
        <meshStandardMaterial color="#C9D4E0" emissive="#1A2530" emissiveIntensity={0.12} roughness={0.55} metalness={0.1} />
      </mesh>
    </group>
  );
}

/**
 * Reposition a unit-length capsule between two world-space points.
 * Used for hands (wrist → palm) and feet (ankle → toe).
 */
function updateExtremity(
  mesh: THREE.Mesh | null,
  pa: THREE.Vector3, pb: THREE.Vector3,
  va: number, vb: number,
  /** Radius for the capsule body (in metres). */ _radius: number,
  /** Tip radius — unused right now since capsuleGeometry doesn't
   *  taper, but kept in the signature so we can swap to a tapered
   *  mesh later without touching call sites. */ _tipRadius: number,
) {
  if (!mesh) return;
  if (va < 0.3 || vb < 0.3) {
    mesh.visible = false;
    return;
  }
  const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
  const dir = new THREE.Vector3(dx, dy, dz).divideScalar(len);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // capsuleGeometry default length is `args[1]` (we set it to 1 above);
  // scale Y to the actual segment length.
  mesh.scale.set(1, len, 1);
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

const _colorHigh = new THREE.Color('#5BD6A0');
const _colorMid = new THREE.Color('#FFC97D');
const _colorLow = new THREE.Color('#FF7B7B');

function visibilityColour(v: number): THREE.Color {
  if (v >= 0.7) return _colorHigh;
  if (v >= 0.4) return _colorMid;
  return _colorLow;
}
