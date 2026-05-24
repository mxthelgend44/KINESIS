// Sensor-fusion filters that turn an (accel, gyro) stream into an
// orientation estimate.
//
// Three filters here:
//   • ComplementaryFilter — simple, fast, good enough for limb rehab where
//     yaw drift is acceptable (one axis of rotation per joint typically).
//   • MadgwickAHRS — gradient-descent variant; more accurate but more CPU.
//   • DevicePassthroughFilter — when the firmware emits a pre-fused
//     quaternion (e.g. MYOSA ESP32 running Madgwick on-device at 100 Hz),
//     use it directly instead of re-fusing the down-sampled stream.
//
// All three have the same surface area: feed an ImuFrame, read .orientation.

import type { ImuFrame, ImuOrientation, Quaternion } from './types';
import { quatNormalize, quatToEuler, quatTilt, QUAT_IDENTITY } from './quaternion';

const D2R = Math.PI / 180;

export interface OrientationFilter {
  update(frame: ImuFrame): ImuOrientation;
  reset(): void;
  get orientation(): ImuOrientation;
}

// ────────────────────────────────────────────────────────────────────────
//  Complementary filter
// ────────────────────────────────────────────────────────────────────────

export class ComplementaryFilter implements OrientationFilter {
  private q: Quaternion = { ...QUAT_IDENTITY };
  private prevTMs: number | null = null;

  /**
   * @param alpha 0..1 — how much of the gyro estimate to keep each step.
   *   0.98 is the classic "trust gyro short-term, use accel as long-term
   *   reference" value. Lower alpha = trust accel more (less drift, more
   *   bounce). Higher alpha = trust gyro more (smoother, more drift).
   */
  constructor(private alpha = 0.98) {}

  reset(): void {
    this.q = { ...QUAT_IDENTITY };
    this.prevTMs = null;
  }

  update(f: ImuFrame): ImuOrientation {
    const dt = this.prevTMs === null ? 0 : Math.max(0, (f.tMs - this.prevTMs) / 1000);
    this.prevTMs = f.tMs;

    // 1) Integrate gyro into the quaternion.
    if (dt > 0) {
      const wx = f.gx * D2R;
      const wy = f.gy * D2R;
      const wz = f.gz * D2R;
      const halfDt = 0.5 * dt;
      // q̇ = 0.5 · q ⊗ ω  → small-angle update
      const { w, x, y, z } = this.q;
      const dq = {
        w: (-x * wx - y * wy - z * wz) * halfDt,
        x: ( w * wx + y * wz - z * wy) * halfDt,
        y: ( w * wy - x * wz + z * wx) * halfDt,
        z: ( w * wz + x * wy - y * wx) * halfDt,
      };
      this.q = quatNormalize({
        w: w + dq.w,
        x: x + dq.x,
        y: y + dq.y,
        z: z + dq.z,
      });
    }

    // 2) Derive roll & pitch from gravity (the long part of the accel
    //    vector). Only meaningful when the limb is roughly stationary.
    const aMag = Math.hypot(f.ax, f.ay, f.az);
    if (aMag > 0.3 && aMag < 1.7) {
      const ax = f.ax / aMag;
      const ay = f.ay / aMag;
      const az = f.az / aMag;
      const accelRoll  = Math.atan2(ay, az);
      const accelPitch = Math.atan2(-ax, Math.hypot(ay, az));

      // Build a quaternion from those + the *current* yaw, then blend.
      const e = quatToEuler(this.q);
      const yaw = e.yaw * D2R;
      const cr = Math.cos(accelRoll / 2),  sr = Math.sin(accelRoll / 2);
      const cp = Math.cos(accelPitch / 2), sp = Math.sin(accelPitch / 2);
      const cy = Math.cos(yaw / 2),         sy = Math.sin(yaw / 2);
      const aQ: Quaternion = {
        w: cr * cp * cy + sr * sp * sy,
        x: sr * cp * cy - cr * sp * sy,
        y: cr * sp * cy + sr * cp * sy,
        z: cr * cp * sy - sr * sp * cy,
      };
      const a = this.alpha;
      const b = 1 - a;
      this.q = quatNormalize({
        w: a * this.q.w + b * aQ.w,
        x: a * this.q.x + b * aQ.x,
        y: a * this.q.y + b * aQ.y,
        z: a * this.q.z + b * aQ.z,
      });
    }

    return this.orientation;
  }

  get orientation(): ImuOrientation {
    return {
      quat: this.q,
      euler: quatToEuler(this.q),
      tiltDeg: quatTilt(this.q),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Device-passthrough — trusts the firmware's own fused quaternion
// ────────────────────────────────────────────────────────────────────────

/**
 * Uses the on-device fused orientation when present. Falls back to a
 * Complementary filter for any frame that lacks a quaternion (so a
 * mid-session firmware glitch or a CSV-only stream still produces
 * usable angles).
 *
 * Best paired with firmware that runs its own Madgwick / Mahony loop
 * at full sample rate (e.g. 100 Hz) and emits the fused quaternion
 * alongside the raw readings. That way the angle the patient sees is
 * fused at 100 Hz on-device rather than re-fused at the (slower)
 * serial transport rate in the browser.
 */
export class DevicePassthroughFilter implements OrientationFilter {
  private q: Quaternion = { ...QUAT_IDENTITY };
  private fallback = new ComplementaryFilter();

  reset(): void {
    this.q = { ...QUAT_IDENTITY };
    this.fallback.reset();
  }

  update(f: ImuFrame): ImuOrientation {
    if (
      f.qw !== undefined && f.qx !== undefined &&
      f.qy !== undefined && f.qz !== undefined
    ) {
      this.q = quatNormalize({ w: f.qw, x: f.qx, y: f.qy, z: f.qz });
      // Keep the fallback warm so a temporary drop-out doesn't snap
      // the orientation back to identity.
      this.fallback.update(f);
      return this.orientation;
    }
    const out = this.fallback.update(f);
    this.q = out.quat;
    return out;
  }

  get orientation(): ImuOrientation {
    return {
      quat: this.q,
      euler: quatToEuler(this.q),
      tiltDeg: quatTilt(this.q),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Madgwick AHRS (gyro + accel only, no magnetometer)
// ────────────────────────────────────────────────────────────────────────

/**
 * Sebastian Madgwick's IMU algorithm (accel + gyro). Adapted from the
 * 2010 paper. We deliberately drop the magnetometer path because cheap
 * IMUs (MPU6050) don't include one; yaw drift is tolerable for a single
 * limb-rotation use case.
 */
export class MadgwickAHRS implements OrientationFilter {
  private q: Quaternion = { ...QUAT_IDENTITY };
  private prevTMs: number | null = null;

  constructor(public beta = 0.04) {}

  reset(): void {
    this.q = { ...QUAT_IDENTITY };
    this.prevTMs = null;
  }

  update(f: ImuFrame): ImuOrientation {
    const dt = this.prevTMs === null ? 0 : Math.max(0, (f.tMs - this.prevTMs) / 1000);
    this.prevTMs = f.tMs;
    if (dt <= 0) return this.orientation;

    let { w: q1, x: q2, y: q3, z: q4 } = this.q;
    const gx = f.gx * D2R;
    const gy = f.gy * D2R;
    const gz = f.gz * D2R;
    let ax = f.ax;
    let ay = f.ay;
    let az = f.az;

    // Rate of change of quaternion from gyro
    let qDot1 = 0.5 * (-q2 * gx - q3 * gy - q4 * gz);
    let qDot2 = 0.5 * ( q1 * gx + q3 * gz - q4 * gy);
    let qDot3 = 0.5 * ( q1 * gy - q2 * gz + q4 * gx);
    let qDot4 = 0.5 * ( q1 * gz + q2 * gy - q3 * gx);

    const aNorm = Math.hypot(ax, ay, az);
    if (aNorm > 0) {
      ax /= aNorm;
      ay /= aNorm;
      az /= aNorm;

      // Auxiliary variables to avoid repeated arithmetic
      const _2q1 = 2 * q1;
      const _2q2 = 2 * q2;
      const _2q3 = 2 * q3;
      const _2q4 = 2 * q4;
      const _4q1 = 4 * q1;
      const _4q2 = 4 * q2;
      const _4q3 = 4 * q3;
      const _8q2 = 8 * q2;
      const _8q3 = 8 * q3;
      const q1q1 = q1 * q1;
      const q2q2 = q2 * q2;
      const q3q3 = q3 * q3;
      const q4q4 = q4 * q4;

      // Gradient descent step
      let s1 = _4q1 * q3q3 + _2q3 * ax + _4q1 * q2q2 - _2q2 * ay;
      let s2 = _4q2 * q4q4 - _2q4 * ax + 4 * q1q1 * q2 - _2q1 * ay - _4q2 + _8q2 * q2q2 + _8q2 * q3q3 + _4q2 * az;
      let s3 = 4 * q1q1 * q3 + _2q1 * ax + _4q3 * q4q4 - _2q4 * ay - _4q3 + _8q3 * q2q2 + _8q3 * q3q3 + _4q3 * az;
      let s4 = 4 * q2q2 * q4 - _2q2 * ax + 4 * q3q3 * q4 - _2q3 * ay;
      const sNorm = Math.hypot(s1, s2, s3, s4);
      if (sNorm > 0) {
        s1 /= sNorm; s2 /= sNorm; s3 /= sNorm; s4 /= sNorm;
        qDot1 -= this.beta * s1;
        qDot2 -= this.beta * s2;
        qDot3 -= this.beta * s3;
        qDot4 -= this.beta * s4;
      }
    }

    q1 += qDot1 * dt;
    q2 += qDot2 * dt;
    q3 += qDot3 * dt;
    q4 += qDot4 * dt;
    this.q = quatNormalize({ w: q1, x: q2, y: q3, z: q4 });

    return this.orientation;
  }

  get orientation(): ImuOrientation {
    return {
      quat: this.q,
      euler: quatToEuler(this.q),
      tiltDeg: quatTilt(this.q),
    };
  }
}
