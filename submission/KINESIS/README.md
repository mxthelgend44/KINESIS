# KINESIS — Project image assets

This folder holds every image referenced from `KINESIS.md` (the blog
post). MYOSA's submission spec requires the folder name to match the
project name exactly (`KINESIS`).

When you submit to MYOSA, upload this folder (just `KINESIS/`, not
`submission/KINESIS/`) so it ends up at `/assets/images/KINESIS/` on
their site.

## Images

| Filename                    | Used for                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `cover.png`                 | Blog cover image. Referenced as `KINESIS/cover.png`.           |
| `hero-3d-mirror.jpg`        | Patient app showing the 3D anatomical skeleton tracking live.  |
| `clinician-dashboard.jpg`   | Clinician cohort view with AI insights.                        |
| `myosa-hardware.jpg`        | Photo of the MYOSA stack — the AccelAndGyro IMU module on the motherboard with the Velcro strap. |
| `pipeline-architecture.png` | Block diagram: Camera + IMU → Fusion → Quality scoring.        |
| `motion-capture.jpg`        | A recorded motion-capture clip playing back on the avatar.     |

## Videos

| Filename               | Resolution    | Used for                                                  |
| ---------------------- | ------------- | --------------------------------------------------------- |
| `KINESIS-demo.mp4`     | 1280 × 720    | Primary demo — patient PWA, IMU pairing, live tracking.   |
| `KINESIS-demo-2.mp4`   | 1910 × 988    | Secondary demo — clinician dashboard walkthrough.         |

Both files are confirmed **horizontal/landscape** per the MYOSA spec.

## Path conventions (per MYOSA spec)

- **Cover image** (no `/assets/images/` prefix):
  ```html
  <img src="KINESIS/cover.png">
  ```
- **All other images** (with prefix):
  ```html
  <img src="/assets/images/KINESIS/hero-3d-mirror.jpg">
  ```
- **Video format:** horizontal/landscape only.
