// Map a single-IMU orientation to a joint flexion angle.
//
// With one IMU attached to a limb segment, the simplest joint-angle estimate
// is "how far has this segment rotated from the calibrated reference pose?".
// The user holds the limb in a known pose (typically full extension for
// rehab), we snapshot the IMU orientation as `reference`, and any future
// reading's *angular delta* from that reference is the flexion angle.
//
// This loses one degree of freedom (we can't disambiguate which way the
// segment rotated) but for single-axis joints — knee, elbow — it's exactly
// what we want. For complex joints (shoulder, hip) it's a useful proxy.

import { quatAngleDelta, QUAT_IDENTITY } from './quaternion';
import type { Quaternion } from './types';

export type ImuJointBinding = {
  /** Which joint the sensor is reporting flexion for. */
  joint: string;
  /** Quaternion captured at the calibration pose. */
  referenceQuat: Quaternion;
  /** If true, the reported angle is inverted (use when the IMU is upside-down). */
  invert?: boolean;
  /** Optional offset added to the computed angle (degrees). */
  offsetDeg?: number;
};

export class ImuJointMapper {
  private binding: ImuJointBinding | null = null;

  bind(joint: string, currentQuat: Quaternion, opts: { invert?: boolean; offsetDeg?: number } = {}): ImuJointBinding {
    this.binding = {
      joint,
      referenceQuat: { ...currentQuat },
      invert: opts.invert,
      offsetDeg: opts.offsetDeg ?? 0,
    };
    return this.binding;
  }

  clear() {
    this.binding = null;
  }

  isBound(): boolean {
    return this.binding !== null;
  }

  jointKey(): string | null {
    return this.binding?.joint ?? null;
  }

  computeFlexionDeg(currentQuat: Quaternion): number | null {
    if (!this.binding) return null;
    const raw = quatAngleDelta(this.binding.referenceQuat, currentQuat);
    const signed = this.binding.invert ? -raw : raw;
    return signed + (this.binding.offsetDeg ?? 0);
  }
}

/**
 * Blend a camera-derived angle with an IMU-derived angle. Higher visionConf
 * leans toward camera; lower confidence (occlusion, out of frame) leans on
 * the IMU. If only one source is present, that source wins.
 */
export function fuseAngles(opts: {
  visionDeg: number | null;
  visionConf: number;
  imuDeg: number | null;
}): number | null {
  const { visionDeg, visionConf, imuDeg } = opts;
  if (visionDeg === null && imuDeg === null) return null;
  if (imuDeg === null) return visionDeg;
  if (visionDeg === null) return imuDeg;
  // Smooth handover: at conf ≥ 0.7 use mostly vision; below 0.3 use mostly IMU.
  const w = Math.max(0, Math.min(1, (visionConf - 0.3) / 0.4));
  return w * visionDeg + (1 - w) * imuDeg;
}

/** Convenience export so callers don't have to pull QUAT_IDENTITY directly. */
export { QUAT_IDENTITY };
