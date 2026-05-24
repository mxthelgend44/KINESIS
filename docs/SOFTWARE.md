# How the software works

KINESIS is a pnpm + Turborepo monorepo with two Next.js 14 apps and
five shared packages. Everything client-side; Firebase for auth,
storage, and serverless functions.

```
kinesis/
├── apps/
│   ├── patient/         ← Patient PWA (camera + IMU + 3D mirror)
│   └── clinician/       ← Clinician dashboard (cohort + per-patient)
├── packages/
│   ├── db/              ← Firestore client, types, queries
│   ├── pose/            ← MediaPipe pose tracker, angles, rep counter
│   ├── imu/             ← Web Serial IMU pipeline, filters, fusion
│   ├── ui/              ← Shared UI primitives (ROMGauge, Pill, ErrorState…)
│   └── ai/              ← AI summarisation client (talks to Claude API)
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   └── functions/       ← Cloud Functions (session summary, alerts)
└── kinesis_node.ino     ← ESP32 firmware (lives at the repo root)
```

## The two apps

| App                                    | URL                                                                              | Audience                                  |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **Patient PWA** (`apps/patient`)       | [kinesis-2d856.web.app](https://kinesis-2d856.web.app)                            | The person doing the rehab exercises.     |
| **Clinician dashboard** (`apps/clinician`) | [kinesis-clinician.web.app](https://kinesis-clinician.web.app)             | The therapist supervising the recovery.   |

Both are static-exported Next.js 14 apps deployed to Firebase Hosting.
All authentication and data access happens client-side via the
Firebase JS SDK — no SSR, no Cloud Functions in the hot path.

## Patient PWA — flow walkthrough

`apps/patient/app/(app)/session/page.tsx` is the heart of the patient
experience. The flow:

1. **Sign in** with email / password (Firebase Auth).
2. **Choose an exercise** — defaults to whatever's prescribed.
3. **Enable camera** — explicit user-gesture click triggers
   `getUserMedia`; the MediaPipe model lazy-loads in a Web Worker.
4. **Optional: Pair IMU** — `<ImuPanel>` calls `navigator.serial.
   requestPort()`, opens at 115200 baud, pulses RTS to reset the
   ESP32, starts reading JSON frames.
5. **Calibrate** — at rest pose, click Calibrate. The IMU's current
   orientation is captured as the zero reference.
6. **Hit Start** → 3-second audio countdown → recording begins:
   - `PoseTracker` streams `LiveFrame` events to `onFrame`.
   - Each frame: compute joint angles, run the rep counter, write a
     sample to a 2-second buffer, score quality every 600 ms.
   - Every 2 seconds: flush the sample buffer to Firestore
     (`sessions/{id}/samples/{auto}`) and update the live header
     (rep count, quality, classification).
7. **3D mirror** — `SkeletonMesh` consumes the same `onLandmarks`
   stream the rep counter uses; the avatar animates in real time.
   Patient can hit **Record motion** to capture every landmark to a
   Firestore `motionCaptures` doc.
8. **End** → finalise the session (final stats written), pop a
   pain-feeling modal (0–10 scale), navigate to `/progress`.

`packages/pose/src` does the per-frame work. `packages/db/src/queries/sessions.ts`
handles the Firestore writes (`createSession`, `updateLiveSession`,
`appendSessionSamples`, `finalizeSession`).

## Clinician dashboard — flow walkthrough

`apps/clinician/app/(dashboard)/` is the dashboard:

| Route                          | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `/`                            | Cohort view — all patients, latest stats, alert feed.   |
| `/patients`                    | Searchable patient table, status filters.               |
| `/patients/view?id=...`        | Per-patient detail with five tabs.                      |
| `/patients/new`                | New-patient form (creates profile + sends invite).      |
| `/alerts`                      | Cross-cohort alert inbox.                               |
| `/analytics`                   | Quality outliers, ROM distribution, completion rates.   |
| `/reports`                     | Auto-generated weekly per-patient PDFs.                 |
| `/settings`                    | Clinic config, invite codes, member list.               |

The per-patient detail page (`patients/view/page.tsx`) loads the
`Patient` doc, subscribes to that patient's sessions and alerts, then
renders one of five tabs:

- **Overview** — ROM trajectory chart, quality stack, side panel,
  recent 5 sessions, AI insight pane.
- **Sessions** — full session list with peak ROM, quality, reps,
  classification.
- **Exercises** — live-subscribed prescriptions with sets × reps ×
  frequency. Prescribe / Remove buttons.
- **Messages** — chat thread via `subscribeMessages` + an input with
  Enter-to-send `sendMessage`.
- **Notes** — patient condition + AI session summaries.

### Why URL `?id=` instead of `[id]`

Next.js 14 dynamic route segments (`/patients/[id]`) trigger SSR even
when every file in the segment is `'use client'`. Firebase Hosting's
framework integration then tries to bundle the route into a Cloud
Function via npm — which breaks on our pnpm `workspace:*` deps. The
search-param URL is identical UX and keeps the build fully static.

## Shared packages

### `@kinesis/db`

Firestore client + every type used app-wide.

```
packages/db/src/
├── client.ts        ← initialiseFirestore() with memoryLocalCache + forceLongPolling
├── auth.ts          ← useAuth hook, sign-in / sign-up helpers
├── config.ts        ← Firebase project config (from env)
├── types.ts         ← Patient, Session, Alert, Message, Prescription…
└── queries/
    ├── patients.ts
    ├── sessions.ts
    ├── exercises.ts ← + prescriptions
    ├── messages.ts
    ├── alerts.ts
    ├── pain.ts
    ├── medications.ts
    ├── motion-captures.ts
    └── appointments.ts
```

`getDb()` is initialised with `experimentalForceLongPolling: true`
and `memoryLocalCache()` to avoid the well-known Firestore ca9 / b815
internal-assertion crashes during dev hot-reloads.

### `@kinesis/pose`

`<PoseTracker>` is the React component that wraps MediaPipe Pose
Landmarker, the smoothing filters, and the rep counter. It emits two
event streams:

- `onFrame(LiveFrame)` — per-joint angles + confidence (~25 Hz).
- `onLandmarks(landmarks, tMs)` — raw 33-point pose (forwarded to
  the 3D skeleton).

Also exports: `JOINTS` (configuration per joint key), `RepCounter`,
`scoreQuality`, `computeJointAngles`, `MuscleActivationTracker`.

### `@kinesis/imu`

`<ImuPanel>` is the IMU UI card. It wires a `WebSerialImuTransport`
(opens the port, pulses RTS to reset the ESP32, parses line-by-line)
into a `useImu` hook that runs one of three filters
(`Complementary`, `Madgwick`, or `DevicePassthrough`), maps the
orientation to a joint angle via `ImuJointMapper`, and exposes the
fused angle to the parent.

The line parser accepts **both** the CSV format
`t,ax,ay,az,gx,gy,gz` and the firmware's JSON format
`{"t":...,"qw":...,...}`. NaN / inf are sanitised before parsing.

### `@kinesis/ui`

Pure presentation components with no business logic:
`ROMGauge`, `Pill`, `ErrorState`, `useToast`, etc.

### `@kinesis/ai`

Thin Claude API client used by:

- The clinician's "Generate report" button.
- The Cloud Function that summarises sessions on finalize.

## Firebase pieces

- **Authentication** — email/password for clinicians and patients,
  invite-code-gated patient sign-up.
- **Firestore** — every entity (patients, sessions, samples,
  messages, alerts, prescriptions, medications, motion captures,
  appointments).
- **Security rules** — `firebase/firestore.rules`. Role-based by
  default (clinic membership + ownership); currently in dev mode
  (signed-in unrestricted) for the MVP.
- **Hosting** — static export for both apps, two hosting sites
  (`kinesis-2d856` and `kinesis-clinician`).
- **Functions** — `firebase/functions/src/`:
  - `summariseSession` — triggers on session finalize, writes
    `aiSummary` back to the session doc.
  - `escalateAlerts` — scheduled, escalates unacknowledged critical
    alerts after 12 h.

## Development

```bash
# Install
pnpm install

# Run both apps in parallel
pnpm dev

# Patient only
pnpm --filter @kinesis/patient dev   # localhost:3000

# Clinician only
pnpm --filter @kinesis/clinician dev # localhost:3001

# Typecheck the whole workspace
pnpm -r typecheck

# Build everything
pnpm build
```

## Deploy

```bash
# Rules
npx firebase deploy --only firestore:rules

# Hosting (both apps)
npx firebase deploy --only hosting

# Hosting (one app)
npx firebase deploy --only hosting:patient
npx firebase deploy --only hosting:clinician

# Functions
npx firebase deploy --only functions
```

## A few decisions worth knowing about

- **Static export everywhere.** All pages are `'use client'`; data
  is fetched via the Firebase client SDK at runtime. No SSR, no
  Cloud Functions in the request path — keeps hosting cost at
  basically free.
- **One-Euro on every landmark.** MediaPipe's raw output is too
  jittery to render directly. The smoothing is invisible to the
  user but is what makes the avatar feel solid.
- **Bone-length IK over rigged GLB.** We started with a rigged
  GLB avatar and a kalidokit retargeter. Bone-name mismatches and
  rest-axis conventions made it brittle. Switching to a parametric
  skeleton built from MediaPipe landmarks directly was the unlock —
  every joint is in the right place by construction.
- **On-device fusion by default.** The IMU's Madgwick filter runs
  at 100 Hz on the ESP32 and ships a pre-fused quaternion. The
  browser uses `DevicePassthroughFilter` to consume it directly —
  re-fusing in JS at the 20 Hz transport rate would only throw
  fidelity away.
