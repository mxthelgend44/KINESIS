# KINESIS

AI-driven rehabilitation monitoring. Production monorepo: a clinician web dashboard and a patient mobile app, sharing a Supabase backend.

```
kinesis/
├── apps/
│   ├── clinician/        # Next.js 14 — desktop web dashboard (clinicians)
│   └── patient/          # Next.js 14 + Capacitor — mobile PWA + iOS/Android
├── packages/
│   ├── db/               # Supabase client, types, server/middleware helpers
│   ├── ui/               # Shared design primitives + theme tokens
│   ├── pose/             # MediaPipe Pose tracker, angle math, exercises, quality
│   └── tsconfig/         # Base TypeScript configs
├── supabase/
│   ├── config.toml       # Supabase CLI config
│   ├── migrations/       # SQL — schema + RLS + realtime + seed exercises
│   └── seed.sql          # Optional dev seed (one demo clinic)
└── turbo.json            # Build graph orchestration
```

## Tech stack

- **Monorepo:** pnpm workspaces + Turborepo.
- **Web (both apps):** Next.js 14 (App Router), TypeScript strict, Tailwind, React 18.
- **Auth & data:** Supabase — PostgreSQL, Row Level Security, Realtime, magic-link auth.
- **AI motion:** Google MediaPipe Pose Landmarker (BlazePose v2, 33 keypoints, GPU-accelerated WASM).
- **Native packaging (patient):** Capacitor — iOS + Android shells over the Next.js build.
- **Linting/formatting:** ESLint (Next preset) + Prettier (with Tailwind plugin).
- **CI:** GitHub Actions (typecheck + build for both apps).

## Prerequisites

```
Node ≥ 20
pnpm ≥ 9
Docker Desktop (for local Supabase only)
Xcode (for iOS Capacitor builds, macOS only)
Android Studio (for Android Capacitor builds)
```

## One-time setup

### 1. Install dependencies

```bash
cd kinesis
pnpm install
```

### 2. Create your Supabase project

Either **hosted** (recommended for v1):

1. Sign up at https://supabase.com → new project.
2. Note the **Project URL** and **anon key** (Project Settings → API).
3. From the dashboard SQL Editor, run the files in `supabase/migrations/` **in order**:
   - `20260101000000_initial_schema.sql`
   - `20260101000001_rls_policies.sql`
   - `20260101000002_realtime.sql`
   - `20260101000003_seed_global_exercises.sql`
4. Run `supabase/seed.sql` to create a demo clinic with invite code `KINESIS-DEMO`.

Or **local** (faster iteration, needs Docker):

```bash
pnpm supabase:start          # boots local PG + Auth + Realtime on 54321
pnpm supabase:reset          # applies migrations + seed
# Local URL: http://127.0.0.1:54321
```

### 3. Wire env vars

Each app has a `.env.example`. Copy and fill:

```bash
cp apps/clinician/.env.example apps/clinician/.env.local
cp apps/patient/.env.example   apps/patient/.env.local
```

Set:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # clinician app only
NEXT_PUBLIC_APP_URL=http://localhost:3000      # or :3001 for patient
```

### 4. Supabase Auth — add redirect URLs

In Supabase Studio → Authentication → URL Configuration:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/api/auth/callback` and `http://localhost:3001/api/auth/callback`. Add production URLs as well when you deploy.

## Run both apps

```bash
pnpm dev
# Clinician: http://localhost:3000
# Patient:   http://localhost:3001
```

Or one at a time: `pnpm dev:clinician` / `pnpm dev:patient`.

## Sign-up flow (end to end)

1. Open the **clinician** app → sign up. Use the seed clinic's invite code `KINESIS-DEMO`. Confirm your email's magic link.
2. After landing in the Command Centre, click **Invite patient** (top right) and copy the invite link or code.
3. Open the **patient** app on a phone (or another browser) → sign up, paste the invite code, fill in name + condition, send magic link.
4. Patient lands in their Home, taps **Begin session**, allows camera, picks limbs, starts recording.
5. Switch back to the clinician dashboard — the patient appears in the cohort with a **LIVE SESSION** badge, and their detail page shows the angle gauge updating in realtime.
6. After the patient ends the session, it appears in the ROM trajectory chart on the clinician detail page.

## Native iOS / Android (patient app)

```bash
cd apps/patient
pnpm build
pnpm cap:add:ios            # one-time
pnpm cap:add:android        # one-time
pnpm cap:sync               # rebuild and sync into native projects
pnpm cap:open:ios           # opens Xcode
pnpm cap:open:android       # opens Android Studio
```

Capacitor publishes the patient PWA wrapped as a native shell. The app keeps using MediaPipe via the in-shell WebView (which has GPU-WebGL access for the pose model).

For app-store builds, comment out the `server` block in `apps/patient/capacitor.config.ts` and run `pnpm cap:sync` again so the native shell loads the static build instead of your dev server.

## Production deploy

The two apps are deployable independently.

| App | Recommended hosts | Notes |
|---|---|---|
| **clinician** | Vercel, Cloudflare Pages, Fly.io | Set the same Supabase env vars in the host dashboard. |
| **patient (PWA)** | Same | Need HTTPS for camera access. |
| **patient (native)** | App Store / Play Store via Capacitor | See above. |
| **supabase** | Supabase Cloud (already hosted), or self-host on Fly / DigitalOcean | Apply the migrations on the prod database. |

## Scripts (root)

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all apps concurrently |
| `pnpm dev:clinician` / `pnpm dev:patient` | Single app |
| `pnpm build` | Production build of both apps |
| `pnpm typecheck` | Strict TS check across the workspace |
| `pnpm lint` | ESLint across the workspace |
| `pnpm format` | Prettier write |
| `pnpm supabase:start` | Boot local Supabase (Docker) |
| `pnpm supabase:reset` | Apply migrations + seed locally |
| `pnpm supabase:gen` | Regenerate `packages/db/src/database.types.ts` from local DB |
| `pnpm supabase:push` | Push pending migrations to your linked remote project |

## What's implemented

### Backend
- Schema for clinics, clinicians, patients, exercises, prescriptions, sessions, samples, messages, alerts, pain check-ins.
- RLS policies that scope every read/write by role + clinic.
- Realtime publication on sessions, samples, messages, alerts, pain check-ins.
- 14 seeded global exercises.

### Clinician web app
- Magic-link sign-in / sign-up with clinic invite code.
- Command Centre: real-time cohort table, stats strip, alerts panel.
- Patient Detail: live session banner that updates from realtime session_samples; ROM trajectory from real sessions; quality stacked bars; recent sessions table.
- Sidebar with live alert counter (realtime subscription).
- Invite Patient flow (copy code or share link).
- Alerts feed, Settings, stubs for Analytics + Reports.

### Patient mobile app
- Magic-link sign-in / sign-up with clinic invite code and patient profile fields.
- Mobile-optimized layout (≤ 440 px), bottom tab bar, safe-area aware.
- Home: greeting, recovery progress strip, dark hero session card, three progress rings, last-session detail, streak, pain check-in (writes to DB).
- Session: camera + MediaPipe pose tracking, tracked-joint pills, dark ROM gauge, live reps + quality. Writes a `sessions` row on start, streams `session_samples` every 2 s so clinicians see the patient live.
- Progress: ROM / Quality / Pain / History tabs, all reading real session + pain data.
- Library: real exercise catalog with RX badges on prescribed items.
- Messages: realtime patient↔clinician chat.
- Profile: care team, settings, sign-out.
- PWA manifest + Capacitor config ready for iOS/Android builds.

## What's deferred (and how to add it)

| Feature | Effort | Pointer |
|---|---|---|
| PDF session reports | ~1 day | Add `@react-pdf/renderer` to clinician app, wire to `Generate report` button. |
| Email/push notifications | ~1–2 days | Supabase + Resend (email) or Firebase Cloud Messaging (push via Capacitor). |
| Automated alert generation | ~half day | Supabase Edge Function triggered on session insert; insert rows into `alerts` with severity rules. Sample shell in `supabase/functions/`. |
| Exercise demo videos | content | `exercises.demo_video_url` is already on the schema — populate it. |
| Real TFLite quality classifier | ~1 week + data | Replace `packages/pose/src/quality.ts` with a TFLite call. The 4-class output matches. |
| Multi-language | ~1–2 days | Add `next-intl`; the design tokens already support RTL. |
| Cohort analytics + PDF | ~2 days | Page stubs exist at `/analytics` and `/reports`. |

## Privacy

- Camera frames never leave the device. MediaPipe runs locally via WebAssembly.
- Only derived numeric data (angles per joint, peak ROM, reps, quality score) is sent to Supabase.
- All patient data is subject to Row Level Security: a clinician only sees patients in their own clinic; a patient only sees themselves.
- For production deployments processing real patient health data, complete your jurisdiction's compliance review (HIPAA, GDPR, PIPL, etc.) — this codebase is designed to support it but does not certify compliance on its own.
