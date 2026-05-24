// Anatomical model that turns MediaPipe landmarks into per-muscle
// activation strengths so the renderer can draw the bundle and "fire"
// it as the patient moves.
//
// We don't actually have EMG data — activation here is *inferred* from
// joint kinematics. For a hinge joint like the elbow:
//
//   • flexing (angle decreasing) → biceps activates
//   • extending (angle increasing) → triceps activates
//
// The same logic generalises to every major hinge joint we track.
// Multi-axis joints (shoulder, hip) use both flexion and abduction
// criteria. Activation is normalised to [0, 1], smoothed with an
// exponential moving average so the on-screen bundle pulses rather
// than flickers.

import type { Pt3 } from './angles';
import { LM } from './landmarks';

export type MuscleId =
  // Shoulder girdle
  | 'left_deltoid' | 'right_deltoid'
  | 'left_trapezius' | 'right_trapezius'
  // Arm
  | 'left_biceps' | 'right_biceps'
  | 'left_triceps' | 'right_triceps'
  | 'left_forearm_flexor' | 'right_forearm_flexor'
  // Trunk
  | 'pectoralis' | 'rectus_abdominis'
  | 'left_latissimus' | 'right_latissimus'
  // Hip + thigh
  | 'left_glute' | 'right_glute'
  | 'left_quadriceps' | 'right_quadriceps'
  | 'left_hamstrings' | 'right_hamstrings'
  // Lower leg
  | 'left_gastrocnemius' | 'right_gastrocnemius'
  | 'left_tibialis' | 'right_tibialis';

export type MuscleSpec = {
  id: MuscleId;
  /** Display label for tooltips / debug. */
  label: string;
  /** The bone (proximal → distal) this muscle parallels. */
  from: number;
  to: number;
  /** Offset perpendicular to the bone, in fraction of bone length.
   *  Positive = right-hand side of the bone vector. Used so the bundle
   *  sits beside the bone, not on it. */
  perpOffset: number;
  /** Position along the bone where the bundle is centred (0..1). */
  alongBone: number;
  /** Length of the bundle as a fraction of the bone length. */
  lengthFraction: number;
  /** Width of the bundle in bone-length units. */
  widthFraction: number;
  /** Which joint(s) drive activation, and the direction of motion that
   *  fires this muscle. Vector of (jointAngleKey, sign). The angle
   *  derivative is multiplied by sign and clamped — positive product
   *  means "firing". */
  triggers: Array<{ joint: JointAngleKey; sign: 1 | -1 }>;
};

/**
 * Joint-angle keys we compute every frame. The renderer reads these
 * for the angle pill; the activation tracker reads their derivatives.
 */
export type JointAngleKey =
  | 'left_elbow' | 'right_elbow'
  | 'left_shoulder_abd' | 'right_shoulder_abd'
  | 'left_knee' | 'right_knee'
  | 'left_hip_flex' | 'right_hip_flex'
  | 'left_ankle' | 'right_ankle';

/**
 * Anatomical catalogue. Coordinates are mirrored automatically for
 * left vs right by leaning on the landmark indexing.
 */
export const MUSCLES: MuscleSpec[] = [
  // ── Deltoids (shoulder cap) ─────────────────────────────────────────
  {
    id: 'left_deltoid',
    label: 'Left deltoid',
    from: LM.LEFT_SHOULDER, to: LM.LEFT_ELBOW,
    perpOffset: -0.25, alongBone: 0.08, lengthFraction: 0.25, widthFraction: 0.22,
    triggers: [{ joint: 'left_shoulder_abd', sign: 1 }],
  },
  {
    id: 'right_deltoid',
    label: 'Right deltoid',
    from: LM.RIGHT_SHOULDER, to: LM.RIGHT_ELBOW,
    perpOffset: 0.25, alongBone: 0.08, lengthFraction: 0.25, widthFraction: 0.22,
    triggers: [{ joint: 'right_shoulder_abd', sign: 1 }],
  },
  // ── Biceps & triceps ───────────────────────────────────────────────
  {
    id: 'left_biceps',
    label: 'Left biceps',
    from: LM.LEFT_SHOULDER, to: LM.LEFT_ELBOW,
    perpOffset: 0.18, alongBone: 0.5, lengthFraction: 0.55, widthFraction: 0.20,
    triggers: [{ joint: 'left_elbow', sign: -1 }],
  },
  {
    id: 'right_biceps',
    label: 'Right biceps',
    from: LM.RIGHT_SHOULDER, to: LM.RIGHT_ELBOW,
    perpOffset: -0.18, alongBone: 0.5, lengthFraction: 0.55, widthFraction: 0.20,
    triggers: [{ joint: 'right_elbow', sign: -1 }],
  },
  {
    id: 'left_triceps',
    label: 'Left triceps',
    from: LM.LEFT_SHOULDER, to: LM.LEFT_ELBOW,
    perpOffset: -0.18, alongBone: 0.55, lengthFraction: 0.55, widthFraction: 0.20,
    triggers: [{ joint: 'left_elbow', sign: 1 }],
  },
  {
    id: 'right_triceps',
    label: 'Right triceps',
    from: LM.RIGHT_SHOULDER, to: LM.RIGHT_ELBOW,
    perpOffset: 0.18, alongBone: 0.55, lengthFraction: 0.55, widthFraction: 0.20,
    triggers: [{ joint: 'right_elbow', sign: 1 }],
  },
  // ── Forearm flexor (lumped) ─────────────────────────────────────────
  {
    id: 'left_forearm_flexor',
    label: 'Left forearm',
    from: LM.LEFT_ELBOW, to: LM.LEFT_WRIST,
    perpOffset: 0.0, alongBone: 0.5, lengthFraction: 0.6, widthFraction: 0.20,
    triggers: [{ joint: 'left_elbow', sign: -1 }],
  },
  {
    id: 'right_forearm_flexor',
    label: 'Right forearm',
    from: LM.RIGHT_ELBOW, to: LM.RIGHT_WRIST,
    perpOffset: 0.0, alongBone: 0.5, lengthFraction: 0.6, widthFraction: 0.20,
    triggers: [{ joint: 'right_elbow', sign: -1 }],
  },
  // ── Trunk ──────────────────────────────────────────────────────────
  // Pectoralis is drawn across the upper torso; we use the
  // shoulder-shoulder edge with vertical offset toward the chest.
  {
    id: 'pectoralis',
    label: 'Pectoralis',
    from: LM.LEFT_SHOULDER, to: LM.RIGHT_SHOULDER,
    perpOffset: 0.25, alongBone: 0.5, lengthFraction: 0.85, widthFraction: 0.30,
    triggers: [
      { joint: 'left_shoulder_abd', sign: -1 },
      { joint: 'right_shoulder_abd', sign: -1 },
    ],
  },
  {
    id: 'rectus_abdominis',
    label: 'Rectus abdominis',
    from: LM.LEFT_SHOULDER, to: LM.LEFT_HIP,
    perpOffset: 0.55, alongBone: 0.65, lengthFraction: 0.6, widthFraction: 0.22,
    triggers: [
      { joint: 'left_hip_flex', sign: 1 },
      { joint: 'right_hip_flex', sign: 1 },
    ],
  },
  {
    id: 'left_latissimus',
    label: 'Left lat',
    from: LM.LEFT_SHOULDER, to: LM.LEFT_HIP,
    perpOffset: -0.20, alongBone: 0.6, lengthFraction: 0.65, widthFraction: 0.18,
    triggers: [{ joint: 'left_shoulder_abd', sign: -1 }],
  },
  {
    id: 'right_latissimus',
    label: 'Right lat',
    from: LM.RIGHT_SHOULDER, to: LM.RIGHT_HIP,
    perpOffset: 0.20, alongBone: 0.6, lengthFraction: 0.65, widthFraction: 0.18,
    triggers: [{ joint: 'right_shoulder_abd', sign: -1 }],
  },
  // ── Thigh ──────────────────────────────────────────────────────────
  {
    id: 'left_quadriceps',
    label: 'Left quads',
    from: LM.LEFT_HIP, to: LM.LEFT_KNEE,
    perpOffset: 0.0, alongBone: 0.45, lengthFraction: 0.7, widthFraction: 0.30,
    triggers: [{ joint: 'left_knee', sign: 1 }],
  },
  {
    id: 'right_quadriceps',
    label: 'Right quads',
    from: LM.RIGHT_HIP, to: LM.RIGHT_KNEE,
    perpOffset: 0.0, alongBone: 0.45, lengthFraction: 0.7, widthFraction: 0.30,
    triggers: [{ joint: 'right_knee', sign: 1 }],
  },
  {
    id: 'left_hamstrings',
    label: 'Left hamstrings',
    from: LM.LEFT_HIP, to: LM.LEFT_KNEE,
    perpOffset: -0.22, alongBone: 0.55, lengthFraction: 0.55, widthFraction: 0.22,
    triggers: [{ joint: 'left_knee', sign: -1 }],
  },
  {
    id: 'right_hamstrings',
    label: 'Right hamstrings',
    from: LM.RIGHT_HIP, to: LM.RIGHT_KNEE,
    perpOffset: 0.22, alongBone: 0.55, lengthFraction: 0.55, widthFraction: 0.22,
    triggers: [{ joint: 'right_knee', sign: -1 }],
  },
  // ── Glutes ─────────────────────────────────────────────────────────
  {
    id: 'left_glute',
    label: 'Left glute',
    from: LM.LEFT_HIP, to: LM.LEFT_KNEE,
    perpOffset: -0.30, alongBone: 0.08, lengthFraction: 0.20, widthFraction: 0.30,
    triggers: [{ joint: 'left_hip_flex', sign: -1 }],
  },
  {
    id: 'right_glute',
    label: 'Right glute',
    from: LM.RIGHT_HIP, to: LM.RIGHT_KNEE,
    perpOffset: 0.30, alongBone: 0.08, lengthFraction: 0.20, widthFraction: 0.30,
    triggers: [{ joint: 'right_hip_flex', sign: -1 }],
  },
  // ── Calf ───────────────────────────────────────────────────────────
  {
    id: 'left_gastrocnemius',
    label: 'Left calf',
    from: LM.LEFT_KNEE, to: LM.LEFT_ANKLE,
    perpOffset: -0.18, alongBone: 0.35, lengthFraction: 0.55, widthFraction: 0.22,
    triggers: [{ joint: 'left_ankle', sign: -1 }],
  },
  {
    id: 'right_gastrocnemius',
    label: 'Right calf',
    from: LM.RIGHT_KNEE, to: LM.RIGHT_ANKLE,
    perpOffset: 0.18, alongBone: 0.35, lengthFraction: 0.55, widthFraction: 0.22,
    triggers: [{ joint: 'right_ankle', sign: -1 }],
  },
  {
    id: 'left_tibialis',
    label: 'Left tibialis',
    from: LM.LEFT_KNEE, to: LM.LEFT_ANKLE,
    perpOffset: 0.10, alongBone: 0.55, lengthFraction: 0.45, widthFraction: 0.14,
    triggers: [{ joint: 'left_ankle', sign: 1 }],
  },
  {
    id: 'right_tibialis',
    label: 'Right tibialis',
    from: LM.RIGHT_KNEE, to: LM.RIGHT_ANKLE,
    perpOffset: -0.10, alongBone: 0.55, lengthFraction: 0.45, widthFraction: 0.14,
    triggers: [{ joint: 'right_ankle', sign: 1 }],
  },
];

/**
 * Tracks each joint angle's recent history and exposes the derivative
 * (deg/sec) plus a smoothed activation magnitude for every MuscleId.
 *
 * The activation is `max(0, signedDerivative * sign)` for each trigger,
 * summed across triggers, normalised by a "max meaningful angular
 * velocity" (we cap at ~360°/s ≈ a brisk rep), then exponentially
 * smoothed so the bundle pulses rather than flickers.
 */
export class MuscleActivationTracker {
  private prevAngles = new Map<JointAngleKey, number>();
  private prevT = 0;
  private velocity = new Map<JointAngleKey, number>(); // deg/s, EMA
  private activation = new Map<MuscleId, number>();    // [0..1], EMA

  /** Smoothing factor for velocity EMA (higher = smoother). */
  private velAlpha = 0.35;
  /** Smoothing factor for activation EMA. */
  private actAlpha = 0.30;
  /** Max meaningful velocity for normalisation (deg/s). */
  private vMax = 320;

  update(angles: Partial<Record<JointAngleKey, number>>, tMs: number): void {
    const dt = this.prevT > 0 ? (tMs - this.prevT) / 1000 : 0;
    this.prevT = tMs;

    if (dt > 0 && dt < 0.5) {
      for (const [k, v] of Object.entries(angles) as Array<[JointAngleKey, number | undefined]>) {
        if (v === undefined) continue;
        const prev = this.prevAngles.get(k);
        if (prev !== undefined) {
          const inst = (v - prev) / dt;
          const cur = this.velocity.get(k) ?? 0;
          const smoothed = cur * (1 - this.velAlpha) + inst * this.velAlpha;
          this.velocity.set(k, smoothed);
        }
        this.prevAngles.set(k, v);
      }
    } else {
      // First frame or large gap: just snapshot.
      for (const [k, v] of Object.entries(angles) as Array<[JointAngleKey, number | undefined]>) {
        if (v !== undefined) this.prevAngles.set(k, v);
      }
    }

    // Recompute activation per muscle.
    for (const m of MUSCLES) {
      let raw = 0;
      for (const t of m.triggers) {
        const vel = this.velocity.get(t.joint) ?? 0;
        const signed = vel * t.sign;
        if (signed > 0) raw += signed / this.vMax;
      }
      raw = Math.max(0, Math.min(1, raw));
      const prev = this.activation.get(m.id) ?? 0;
      const smoothed = prev * (1 - this.actAlpha) + raw * this.actAlpha;
      this.activation.set(m.id, smoothed);
    }
  }

  get(id: MuscleId): number {
    return this.activation.get(id) ?? 0;
  }
}

/**
 * Compute the joint angles we care about from a flat landmark array.
 * Angles are returned in degrees, 0..180.
 *
 * Returns nullable values per joint — when input visibility is below
 * threshold the angle is left undefined so the tracker doesn't pollute
 * its velocity buffer with garbage.
 */
export function computeJointAngles(
  landmarks: ReadonlyArray<Pt3 & { visibility?: number }>,
): Partial<Record<JointAngleKey, number>> {
  const out: Partial<Record<JointAngleKey, number>> = {};
  const angle = (ai: number, bi: number, ci: number): number | undefined => {
    const a = landmarks[ai]; const b = landmarks[bi]; const c = landmarks[ci];
    if (!a || !b || !c) return undefined;
    if ((a.visibility ?? 1) < 0.35 || (b.visibility ?? 1) < 0.35 || (c.visibility ?? 1) < 0.35) return undefined;
    const abx = a.x - b.x, aby = a.y - b.y, abz = a.z - b.z;
    const cbx = c.x - b.x, cby = c.y - b.y, cbz = c.z - b.z;
    const dot = abx * cbx + aby * cby + abz * cbz;
    const m1 = Math.hypot(abx, aby, abz);
    const m2 = Math.hypot(cbx, cby, cbz);
    if (m1 === 0 || m2 === 0) return undefined;
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    return (Math.acos(cos) * 180) / Math.PI;
  };
  out.left_elbow  = angle(LM.LEFT_SHOULDER,  LM.LEFT_ELBOW,  LM.LEFT_WRIST);
  out.right_elbow = angle(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST);
  out.left_shoulder_abd  = angle(LM.LEFT_ELBOW,  LM.LEFT_SHOULDER,  LM.LEFT_HIP);
  out.right_shoulder_abd = angle(LM.RIGHT_ELBOW, LM.RIGHT_SHOULDER, LM.RIGHT_HIP);
  out.left_knee  = angle(LM.LEFT_HIP,  LM.LEFT_KNEE,  LM.LEFT_ANKLE);
  out.right_knee = angle(LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE);
  out.left_hip_flex  = angle(LM.LEFT_SHOULDER,  LM.LEFT_HIP,  LM.LEFT_KNEE);
  out.right_hip_flex = angle(LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE);
  out.left_ankle  = angle(LM.LEFT_KNEE,  LM.LEFT_ANKLE,  LM.LEFT_FOOT_INDEX);
  out.right_ankle = angle(LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX);
  return out;
}
