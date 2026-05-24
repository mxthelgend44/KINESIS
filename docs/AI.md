# How the AI works

KINESIS doesn't run one big neural net. It runs a **pipeline of small,
specialised models and signal-processing stages**, each tuned for the
part of the problem it solves best. This document walks the pipeline
end-to-end with pointers to the file each stage lives in.

```
camera frame                  IMU frame
     │                              │
     ▼                              ▼
MediaPipe Pose Landmarker      Madgwick AHRS (on-device, 100 Hz)
  → 33 landmarks                 → fused quaternion
     │                              │
     ▼                              ▼
One-Euro filter / frame      Web Serial transport → browser
     │                              │
     ▼                              │
Derived anatomical landmarks        │
(pelvis, spine, sternum, hands)     │
     │                              │
     ▼                              │
Bone-length calibrator              │
     │                              │
     ▼                              │
Anatomical IK pass                  │
     │                              │
     ├──────────────────┐           │
     ▼                  ▼           ▼
Joint-angle computation     ┌──────────────────────┐
     │                      │  Vision-IMU fusion   │
     ▼                      │  (confidence blend)  │
Rep counter +               └──────────┬───────────┘
muscle-activation tracker              │
     │                                 │
     └────────────────┬────────────────┘
                      ▼
              Quality scoring
              (ROM, jerk, asymmetry, cadence)
                      │
                      ▼
        Classification: normal / compensatory /
              guarded / abnormal
                      │
                      ▼
                Firestore write
                      │
                      ▼
        Cloud Function — AI session summary
```

## 1. Pose tracking — MediaPipe Pose Landmarker

`packages/pose/src/pose.ts`

The vision side runs Google's **BlazePose / Pose Landmarker** in the
browser via `@mediapipe/tasks-vision`. Three model variants are
shipped:

| Variant   | FPS on integrated GPU | Use case                                  |
| --------- | --------------------- | ----------------------------------------- |
| `lite`    | ~25                   | Older devices, quick warm-up.             |
| `full`    | ~20                   | Default — balanced accuracy and load.     |
| `heavy`   | ~12                   | Clinic-grade recording on a strong GPU.   |

Each frame returns **33 world-space landmarks in metres** (with Y
pointing down per image convention) plus a per-landmark visibility
score in [0, 1].

## 2. Per-landmark smoothing — One-Euro filter

`apps/patient/components/MeshTracker/SkeletonMesh.tsx` (class
`OneEuroVec3`)

MediaPipe's depth (Z) channel is noisy. A naïve render makes limbs
"breathe" — femur length flickering between 0.42 m and 0.51 m every
frame. We run a **One-Euro filter** on every landmark before any
downstream stage sees it:

- Low cutoff (β = 0.03, min_cutoff = 1.5) kills high-frequency jitter.
- Cutoff adapts up to the landmark's instantaneous derivative, so
  fast motion is preserved with low latency.

## 3. Derived anatomical landmarks

`apps/patient/components/MeshTracker/SkeletonMesh.tsx` —
`computeDerived()`

MediaPipe only observes skin-surface landmarks. The real skeleton has
joints it doesn't see — pelvis center, lumbar / thoracic spine,
sternum, atlanto-occipital pivot, head crown. We synthesise eleven of
them every frame:

| Synth index | Joint            | How                                                    |
| ----------- | ---------------- | ------------------------------------------------------ |
| 33          | Pelvis           | midpoint of L/R hip                                    |
| 34          | Lumbar (L3)      | 36 % up pelvis→sternum + forward bulge (lordosis)      |
| 35          | Thoracic (T6)    | 72 % up pelvis→sternum + slight backward (kyphosis)    |
| 36          | Sternum          | midpoint of L/R shoulder                               |
| 37          | Neck (C7)        | sternum + body-up × neck offset                        |
| 38          | Head base        | midpoint of L/R ear (the real atlanto-occipital pivot) |
| 39          | Head top         | head base + body-up × head height                      |
| 40 / 41     | Left / right hand | centroid of pinky / index / thumb                     |
| 42 / 43     | Left / right foot | midpoint of heel and toe                              |

Vitruvian proportions are normalised to the calibrated body height —
real human anatomy, not arbitrary scale.

## 4. Bone-length calibration

`apps/patient/components/MeshTracker/SkeletonMesh.tsx` — class
`BoneLengths`

For the first ~25 high-visibility frames per bone we record observed
distances, then lock the **median** as the patient's true rest
length. Body height itself uses the **75th percentile** of head-top to
mid-foot distance, biased toward fully-extended frames.

This is the step that makes the avatar look like a person and not a
balloon animal. Once calibrated, MediaPipe's depth jitter can never
warp the figure again.

## 5. Anatomical IK

`apps/patient/components/MeshTracker/SkeletonMesh.tsx` — `applyIK()`

For every bone in the parent → child hierarchy, the IK pass:

1. Computes the observed direction from parent to child landmark.
2. Pins the child at exactly `rest_length` along that direction,
   discarding the noisy magnitude.

The direction follows the patient's real motion; the magnitude is
locked. Result: every joint angle is preserved while every limb
length stays anatomically correct.

## 6. Joint angles + rep counter

`packages/pose/src/angles.ts`, `packages/pose/src/rep-counter.ts`

For each tracked joint we compute the angle from the 3-point landmark
triple (e.g. shoulder–elbow–wrist for elbow flexion). The rep counter
is a hysteresis state machine with anti-jitter guards:

- Per-model confidence threshold (lite 0.5 / full 0.6 / heavy 0.7).
- Direction-change detection with min-margin so the figure must
  travel through the rep before we count it.
- Max-jump cap to discard tracking glitches.
- Per-rep metrics: peak angle, trough angle, range of motion, mean
  speed, symmetry, interval.

## 7. Muscle activation inference

`packages/pose/src/anatomy.ts`

We don't have EMG. We **infer** muscle activation from joint
kinematics:

- Elbow flexion (angle decreasing) → biceps fires.
- Elbow extension (angle increasing) → triceps fires.
- Same logic generalises to every major hinge joint.

For each tracked muscle we project the relevant joint's signed
angular velocity onto a "this muscle fires in this direction" vector,
clamp to [0, 1], and run an exponential moving average so the
on-screen bundle pulses rather than flickers.

## 8. On-device sensor fusion — Madgwick AHRS

`kinesis_node.ino`

The ESP32 samples accel and gyro at 100 Hz and runs **Madgwick AHRS**
on-device. Madgwick is a gradient-descent filter that fuses gyro
(short-term accurate, drifts) with accel (long-term gravity reference,
noisy) — the result is a stable orientation quaternion with low
latency. We drop the magnetometer path because the MYOSA IMU is
6-axis; yaw drift is tolerable for a single-limb use case.

Fused output is serialised to JSON and streamed over USB at 20 Hz:

```json
{"t":12345,"qw":0.999,"qx":0.013,...,"ax":0.02,"ay":0.98,"az":0.21,"gx":1.2,"gy":-0.4,"gz":0.1,...}
```

## 9. In-browser fusion — Complementary / Madgwick / Passthrough

`packages/imu/src/filter.ts`

Three filters live in the browser, all implementing the same
`OrientationFilter` interface:

| Filter                       | When to use                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `ComplementaryFilter`        | Default if firmware emits only accel + gyro. Cheap.                    |
| `MadgwickAHRS`               | Higher accuracy when re-fusing in-browser is the right call.           |
| `DevicePassthroughFilter`    | When firmware already fused on-device (preferred — preserves 100 Hz).  |

The patient app defaults to passthrough — the firmware is doing the
real fusion at full rate, the browser just consumes the quaternion.

## 10. Vision-IMU fusion

`packages/imu/src/mapping.ts` — `fuseAngles()`

When both vision and IMU are tracking the same joint, we blend them
with a confidence-weighted average:

```
weight_vision = clamp(vision_confidence × 1.0, 0.1, 0.9)
weight_imu    = 1 - weight_vision
fused_angle   = vision_angle × weight_vision + imu_angle × weight_imu
```

When the patient turns sideways and the camera loses the joint
(confidence drops below 0.3), the IMU dominates. When the patient is
facing the camera (confidence > 0.7), vision dominates. The
transition is continuous, not switched.

## 11. Quality scoring

`packages/pose/src/quality.ts`

Every 600 ms we score the current set on four axes:

| Axis          | Weight | Computed from                                          |
| ------------- | ------ | ------------------------------------------------------ |
| Range of motion | 40 %  | `currentROM / targetROM`, clamped to [0, 1]            |
| Smoothness    | 25 %   | RMS jerk (3rd derivative of angle) — lower is better.  |
| Symmetry      | 20 %   | `1 - |L_ROM - R_ROM| / max(L_ROM, R_ROM)`              |
| Cadence       | 15 %   | Penalty for >2σ variance from the patient's mean pace. |

The four scores combine into a 0–100 quality number and a
classification:

- `normal` (≥ 80)
- `compensatory` (60–80, asymmetry or off-target ROM)
- `guarded` (40–60, very low velocity or shortened ROM)
- `abnormal` (< 40, multiple failure modes)

## 12. AI session summary (Cloud Function)

`firebase/functions/src/summarise-session.ts`

When a session finalises (the patient hits End), a Cloud Function
fires and writes a one-paragraph natural-language summary to the
session doc. The clinician reads it on the Notes tab next to the raw
metrics:

> "Patient completed 8 of 10 prescribed reps. ROM improved from 78°
> to 91° (+17 %) compared to the previous session. Two compensatory
> patterns flagged in the last set, both involving early shoulder
> elevation. Quality trend remains positive."

The function uses Claude (`claude-opus-4-7`) with a prompt that
includes the per-rep stats, the patient's recent ROM trajectory, and
any active alerts. Cached prompts keep the cost per session under a
cent.

## What's deliberately *not* AI

A few things people assume are ML but aren't:

- **Joint angle computation** — pure trigonometry from three points.
- **Rep counting** — hysteresis state machine, no learned model.
- **The 3D avatar** — geometry primitives positioned by IK, not a
  neural net. The "AI tracking" you see in the demo is the
  combination of MediaPipe + filters + IK + fusion above, not a
  single skeleton-rigging model.

The result is something that runs **fully in the browser** on a
mid-range phone, gives clinicians genuine clinical signal, and uses
the MYOSA IMU as the trust anchor that keeps the vision honest.
