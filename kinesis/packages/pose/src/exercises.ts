// Joint definitions and the local exercise catalog (mirrors supabase seed).

import { LM } from './landmarks';

export type Side = 'left' | 'right';
export type Limb = 'arm' | 'leg';

export type JointKey =
  | 'left_elbow' | 'right_elbow'
  | 'left_shoulder' | 'right_shoulder'
  | 'left_knee' | 'right_knee'
  | 'left_hip' | 'right_hip'
  | 'left_ankle' | 'right_ankle';

export type JointDef = {
  key: JointKey;
  label: string;
  limb: Limb;
  side: Side;
  triplet: readonly [number, number, number];
  target: { min: number; max: number };
  rep: { flexedBelow: number; extendedAbove: number };
};

export const JOINTS: Record<JointKey, JointDef> = {
  left_elbow: {
    key: 'left_elbow', label: 'Left Elbow', limb: 'arm', side: 'left',
    triplet: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST],
    target: { min: 0, max: 150 },
    rep: { flexedBelow: 70, extendedAbove: 150 },
  },
  right_elbow: {
    key: 'right_elbow', label: 'Right Elbow', limb: 'arm', side: 'right',
    triplet: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
    target: { min: 0, max: 150 },
    rep: { flexedBelow: 70, extendedAbove: 150 },
  },
  left_shoulder: {
    key: 'left_shoulder', label: 'Left Shoulder', limb: 'arm', side: 'left',
    triplet: [LM.LEFT_ELBOW, LM.LEFT_SHOULDER, LM.LEFT_HIP],
    target: { min: 0, max: 180 },
    rep: { flexedBelow: 30, extendedAbove: 120 },
  },
  right_shoulder: {
    key: 'right_shoulder', label: 'Right Shoulder', limb: 'arm', side: 'right',
    triplet: [LM.RIGHT_ELBOW, LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
    target: { min: 0, max: 180 },
    rep: { flexedBelow: 30, extendedAbove: 120 },
  },
  left_knee: {
    key: 'left_knee', label: 'Left Knee', limb: 'leg', side: 'left',
    triplet: [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
    target: { min: 0, max: 135 },
    rep: { flexedBelow: 90, extendedAbove: 160 },
  },
  right_knee: {
    key: 'right_knee', label: 'Right Knee', limb: 'leg', side: 'right',
    triplet: [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
    target: { min: 0, max: 135 },
    rep: { flexedBelow: 90, extendedAbove: 160 },
  },
  left_hip: {
    key: 'left_hip', label: 'Left Hip', limb: 'leg', side: 'left',
    triplet: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE],
    target: { min: 0, max: 120 },
    rep: { flexedBelow: 100, extendedAbove: 170 },
  },
  right_hip: {
    key: 'right_hip', label: 'Right Hip', limb: 'leg', side: 'right',
    triplet: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE],
    target: { min: 0, max: 120 },
    rep: { flexedBelow: 100, extendedAbove: 170 },
  },
  left_ankle: {
    key: 'left_ankle', label: 'Left Ankle', limb: 'leg', side: 'left',
    triplet: [LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
    target: { min: 70, max: 130 },
    rep: { flexedBelow: 85, extendedAbove: 110 },
  },
  right_ankle: {
    key: 'right_ankle', label: 'Right Ankle', limb: 'leg', side: 'right',
    triplet: [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
    target: { min: 70, max: 130 },
    rep: { flexedBelow: 85, extendedAbove: 110 },
  },
};

export function pairOf(k: JointKey): JointKey | null {
  if (k.startsWith('left_')) return ('right_' + k.slice(5)) as JointKey;
  if (k.startsWith('right_')) return ('left_' + k.slice(6)) as JointKey;
  return null;
}

export function joints(keys: readonly string[]): JointKey[] {
  return keys.filter((k): k is JointKey => k in JOINTS);
}
