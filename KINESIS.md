---
title: "KINESIS — AI-driven rehab monitoring with MYOSA"
team: Team KINESIS
cover: KINESIS/cover.png
---

<img src="KINESIS/cover.png">

## The problem

Post-injury rehab is mostly invisible. A therapist sees a patient
for thirty minutes a week, prescribes exercises, and the patient goes
home and either does them properly, does them badly, or doesn't do
them at all. By the time the next appointment rolls around the
clinician has no idea what really happened — just the patient's
self-report and a vague sense of progress.

KINESIS closes that loop. The patient opens our PWA on a phone,
straps a MYOSA IMU node to the working limb, points the camera at
themselves, and the system records the entire session — joint angles,
range of motion, rep count, movement quality — in real time. Their
clinician sees every rep on a live dashboard the moment it happens.

## What it does

<img src="/assets/images/KINESIS/hero-3d-mirror.jpg">

- **Real-time pose tracking.** MediaPipe Pose Landmarker runs in the
  browser at 25–30 FPS, producing 33 anatomical landmarks per frame.
- **3D anatomical mirror.** We render an avatar built from spheres
  and tapered cylinders, driven directly by the landmarks plus a
  bone-length calibration step so limb proportions stay locked to the
  patient's body.
- **MYOSA IMU ground truth.** The ESP32 streams a fused quaternion
  from a Madgwick filter running at 100 Hz on-device. The browser
  receives it over Web Serial and fuses the IMU angle with the camera
  angle using a confidence-weighted blend.
- **Per-rep quality scoring.** Range of motion, jerk, asymmetry, and
  cadence variance are computed live and combined into a 0–100 quality
  score with a classification (normal / compensatory / guarded /
  abnormal).
- **Live clinician view.** Every angle, sample, and rep streams to
  Firestore. The clinician dashboard subscribes per-patient and shows
  ROM trajectories, quality trends, alerts, and the full message
  thread.
- **Motion capture recording.** Patients can record exercise clips
  that play back on the same avatar — useful for "show me how you
  did the exercise this morning" reviews.

## Hardware

<img src="/assets/images/KINESIS/myosa-hardware.jpg">

The IMU node is a single MYOSA stack:

- **MYOSA motherboard** — ESP32-WROOM-32E, USB-serial, regulator.
- **MYOSA AccelAndGyro module** — MPU-style 6-axis IMU on the I²C bus.

The ESP32 runs `kinesis_node.ino`. It samples the IMU at 100 Hz,
runs Madgwick AHRS to produce a fused quaternion, and streams JSON
frames over USB serial at 20 Hz. The full firmware deep-dive is in
[docs/FIRMWARE.md](docs/FIRMWARE.md).

## Architecture

<img src="/assets/images/KINESIS/pipeline-architecture.png">

```
┌────────────────────────────────────────────────────────────────┐
│  Patient PWA (Next.js, React 18, runs in browser)              │
│                                                                │
│    ┌──────────────┐    ┌────────────────┐    ┌────────────┐   │
│    │  Camera →    │    │  Web Serial →  │    │  3D Skeleton│  │
│    │  MediaPipe   │    │  ESP32 / IMU   │    │  Mesh       │  │
│    └──────┬───────┘    └────────┬───────┘    └─────▲──────┘   │
│           │                     │                  │           │
│           ▼                     ▼                  │           │
│    ┌─────────────────────────────────────────────┐ │           │
│    │  Sensor fusion + anatomical IK + quality     │─┘           │
│    │  scoring (in browser, every frame)           │            │
│    └────────────────────┬─────────────────────────┘            │
│                         │                                       │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼  (per-sample Firestore writes)
              ┌──────────────────────────┐
              │  Firebase (Auth +        │
              │  Firestore + Hosting)    │
              └────────────┬─────────────┘
                           │  (live subscriptions)
                           ▼
              ┌──────────────────────────┐
              │  Clinician dashboard     │
              │  (Next.js)               │
              └──────────────────────────┘
```

Three deep-dives if you want detail:

- **[docs/AI.md](docs/AI.md)** — the AI/ML pipeline: pose tracking,
  filtering, anatomical IK, sensor fusion, quality scoring.
- **[docs/SOFTWARE.md](docs/SOFTWARE.md)** — the apps: monorepo,
  Next.js, Firebase, real-time pipelines.
- **[docs/FIRMWARE.md](docs/FIRMWARE.md)** — the ESP32 sketch and
  the JSON wire protocol.

## In the patient's hands

The patient picks a prescribed exercise, points the camera at their
limb, the avatar mirrors them, the ROM gauge tracks the joint, and
each rep beeps when complete. A 3-second countdown gives them a
chance to brace before recording starts.

## In the clinician's hands

<img src="/assets/images/KINESIS/clinician-dashboard.jpg">

The clinician opens the patient's page and sees:

- **Overview** — ROM trajectory across all sessions, quality stack
  (normal/compensatory/guarded breakdown), most recent 5 sessions.
- **Sessions** — every recorded session with peak ROM, quality,
  reps, and motion classification.
- **Exercises** — active prescriptions with sets × reps × frequency,
  one-click Remove and Prescribe buttons.
- **Messages** — direct chat with the patient. Sent messages appear
  in the patient's app immediately.
- **Notes** — patient condition, week progression, and AI-summarised
  session notes.

The AI Insight pane at the top of the patient page surfaces flags
like "ROM declining for 3 sessions" or "compensatory pattern
detected" so the clinician doesn't have to dig.

## Motion capture

<img src="/assets/images/KINESIS/motion-capture.jpg">

Hit the record button during a session and the system captures every
landmark of every frame to a Firestore document. The clinic team can
later play the clip back on the same skeleton — useful for reviewing
form changes across weeks of recovery.

## Demo videos

- **[KINESIS-demo.mp4](KINESIS/KINESIS-demo.mp4)** — patient PWA walkthrough: signing in, picking an exercise, enabling the camera, pairing the MYOSA IMU, live tracking with the 3D mirror.
- **[KINESIS-demo-2.mp4](KINESIS/KINESIS-demo-2.mp4)** — clinician dashboard walkthrough: cohort view, per-patient detail, ROM trajectories, AI insights, messages.

## The team

KINESIS was built end-to-end during the MYOSA programme — hardware,
firmware, AI pipeline, two web apps, and the AI insight layer on top.

Source: [github.com/mxthelgend44/KINESIS](https://github.com/mxthelgend44/KINESIS)
