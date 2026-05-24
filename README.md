# KINESIS

AI-driven rehab monitoring built on MYOSA sensors.

A patient straps the MYOSA IMU to the working limb, opens the
patient PWA in a browser, and points the camera at themselves. The
system tracks every rep, every joint angle, every range-of-motion
ceiling, and the clinician sees it live on their dashboard.

## Live deployments

- **Patient PWA** — https://kinesis-2d856.web.app
- **Clinician dashboard** — https://kinesis-clinician.web.app

## Documentation

- **[KINESIS.md](KINESIS.md)** — the blog-format project writeup
  submitted to MYOSA.
- **[docs/AI.md](docs/AI.md)** — the AI/ML pipeline end-to-end:
  pose tracking, anatomical IK, sensor fusion, quality scoring.
- **[docs/SOFTWARE.md](docs/SOFTWARE.md)** — monorepo layout, the
  two Next.js apps, Firebase wiring, dev + deploy commands.
- **[docs/FIRMWARE.md](docs/FIRMWARE.md)** — the ESP32 sketch,
  Madgwick fusion, JSON wire protocol, flashing + troubleshooting.

## Repository layout

```
.
├── KINESIS.md             ← MYOSA-format blog post
├── README.md              ← you are here
├── docs/                  ← deep-dive technical docs
│   ├── AI.md
│   ├── SOFTWARE.md
│   └── FIRMWARE.md
├── submission/
│   └── KINESIS/           ← images for the MYOSA blog
├── kinesis_node.ino       ← ESP32 firmware
└── kinesis/               ← Next.js monorepo (patient + clinician apps)
    ├── apps/
    └── packages/
```

## Quick start

```bash
cd kinesis
pnpm install
pnpm dev
```

Patient app boots at http://localhost:3000, clinician at
http://localhost:3001.
