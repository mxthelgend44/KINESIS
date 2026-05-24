// Minimal quaternion math, all functions return new objects (no in-place
// mutation) so callers don't have to reason about ownership.

import type { Euler, Quaternion } from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const QUAT_IDENTITY: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

export function quatNormalize(q: Quaternion): Quaternion {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (n === 0) return { ...QUAT_IDENTITY };
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

export function quatConjugate(q: Quaternion): Quaternion {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

/** Hamilton product a * b. */
export function quatMul(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Quaternion → intrinsic ZYX Euler angles (yaw, pitch, roll) in degrees. */
export function quatToEuler(q: Quaternion): Euler {
  const { w, x, y, z } = q;
  // Roll (x)
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr);
  // Pitch (y)
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  // Yaw (z)
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy);
  return { roll: roll * R2D, pitch: pitch * R2D, yaw: yaw * R2D };
}

/** Tilt magnitude from upright (Z-axis in world frame). 0° = upright. */
export function quatTilt(q: Quaternion): number {
  // Rotate world Z = (0,0,1) by q and take angle to (0,0,1).
  // For a unit quaternion: rotated Z is (2(xz+wy), 2(yz-wx), 1-2(x²+y²))
  const zx = 2 * (q.x * q.z + q.w * q.y);
  const zy = 2 * (q.y * q.z - q.w * q.x);
  const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const dot = Math.max(-1, Math.min(1, zz));
  // Acos of the z-component gives the angle between the rotated Z and world Z.
  // sqrt(zx² + zy²) is the sine of that angle — use atan2 for numerical
  // stability rather than acos near ±1.
  const sinPart = Math.hypot(zx, zy);
  return Math.atan2(sinPart, dot) * R2D;
}

/** Angle (degrees) of the shortest rotation from a to b. */
export function quatAngleDelta(a: Quaternion, b: Quaternion): number {
  const d = quatMul(b, quatConjugate(a));
  // |w| = cos(angle/2). Use clamp to avoid NaN from 1.0000001.
  const w = Math.max(-1, Math.min(1, Math.abs(d.w)));
  return 2 * Math.acos(w) * R2D;
}

export function eulerDeg(roll: number, pitch: number, yaw: number): Quaternion {
  const cr = Math.cos((roll * D2R) / 2);
  const sr = Math.sin((roll * D2R) / 2);
  const cp = Math.cos((pitch * D2R) / 2);
  const sp = Math.sin((pitch * D2R) / 2);
  const cy = Math.cos((yaw * D2R) / 2);
  const sy = Math.sin((yaw * D2R) / 2);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}
