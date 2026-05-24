# KINESIS IMU — Arduino reference

A 6-axis IMU strapped to a limb segment lets KINESIS fuse high-rate inertial
data with the camera-based pose estimate. This directory holds the firmware
side: a stock Arduino sketch that streams accel + gyro at 100Hz over USB,
and notes on physical attachment.

## What you need

| Part | Cheap option | Why |
|------|--------------|-----|
| Microcontroller | Arduino Nano clone (~$5) | Any USB-Serial capable board works. ESP32 is also fine. |
| IMU breakout | MPU-6050 (~$3) | 6-axis (3 accel + 3 gyro). The sketch targets this. MPU-9250 / ICM-20948 / LSM6DSOX also work with a different library. |
| USB cable | Whatever fits your board | Powers + carries data. No batteries needed in the wired path. |
| Strap | Velcro or athletic tape | Holds the breakout flat against the limb. |
| Optional | A 3.7V LiPo + BLE-capable board (ESP32) | For a wireless variant — out of scope of the reference sketch but easy to adapt. |

Total BOM cost: well under $20.

## Wiring

| MPU-6050 | Uno / Nano | ESP32 | Pico (RP2040) |
|----------|-----------|-------|---------------|
| VCC | 5V (or 3.3V) | 3.3V | 3.3V |
| GND | GND | GND | GND |
| SCL | A5 | GPIO22 | GP5 |
| SDA | A4 | GPIO21 | GP4 |
| INT | unused | unused | unused |

## Which sketch should I flash?

| You have… | Open this file |
|-----------|----------------|
| A MYOSA "Multiple Yet One Sensors Assembly" kit | [`myosa-mpu6050.ino`](./myosa-mpu6050.ino) |
| A bare Arduino + standalone MPU-6050 breakout (Uno, Nano, ESP32, Pico) | [`kinesis-imu.ino`](./kinesis-imu.ino) |

Both emit the same `tMs,ax,ay,az,gx,gy,gz` CSV at 115 200 baud / 100 Hz,
so the KINESIS patient app picks either one up identically.

The MYOSA sketch adds:
* an explicit I²C probe at `0x68` with a friendly "sensor not found" LED
  pattern (so you know if the ribbon cable is loose);
* a slow heartbeat blink on D13 while streaming, so the kit looks alive
  even when no host is connected;
* an explicit gyro/accel range configuration in case a previous sketch
  left non-default settings in the MPU-6050's registers;
* 400 kHz I²C fast-mode (MYOSA's bus supports it cleanly).

## Flashing

1. Install the Arduino IDE.
2. From the Library Manager, install **MPU6050_tockn** (used by both
   reference sketches for its terse API). Adafruit's MPU6050 library
   also works — you'll just need to swap the includes and the
   `mpu.getAccX()` style calls for the Adafruit equivalents.
3. Open the appropriate `.ino` file from the table above, pick your
   board + port, and click Upload.
4. Open the Serial Monitor at 115200 baud. Within ~2s of reset, you
   should see the calibration banner followed by a flood of CSV lines
   like `12345,0.012,-0.004,0.987,0.10,0.05,-0.02`.
5. Close the Serial Monitor before pairing in the app — only one process
   can hold the port at a time.

## Placement

Place the breakout flat against the skin or over thin clothing, then
secure it with the strap. Some good defaults for rehab use:

| Joint to track | Sensor location | Strap |
|----------------|-----------------|-------|
| Knee flexion (e.g. ACL recovery) | Mid-shin, ~halfway between knee and ankle | Around the lower leg |
| Elbow flexion | Mid-forearm, palm-up | Around the wrist or forearm |
| Shoulder abduction | Lateral upper arm, just above the elbow | Around the bicep |
| Hip flexion | Anterior thigh, mid-femur | Around the thigh |
| Ankle dorsiflexion | Top of the foot, behind the toes | Around the instep |

The sensor's +X axis should point distally (toward the hand or foot).
If the app shows the angle running the wrong way, either flip the strap
or use the "Invert" toggle in the calibration step.

## Pairing in the app

1. Plug the Arduino into the same computer that's running the patient
   app (`pnpm dev:patient`, default `http://localhost:3001`).
2. Navigate to **Session** in the patient app.
3. Tap **Pair sensor** in the IMU panel below the recording controls.
4. The browser will show a port picker — choose the one labelled with
   your Arduino. (USB Serial on Linux: `/dev/ttyACM0`. macOS:
   `/dev/cu.usbmodem*`. Windows: `COM4` or similar.)
5. Hold the limb in the calibration pose (typically *full extension* for
   the joint being tracked), then tap **Calibrate (<joint>)**. The IMU
   now reports angle delta from that pose.
6. The session live view will display an **IMU FUSED · NHz** badge over
   the video when the IMU is providing input to the angle estimate.

> **Browser support.** Web Serial works in Chrome and Edge on desktop
> (Windows, macOS, Linux, ChromeOS). It does **not** work in Safari or
> on iOS. For mobile (Capacitor) builds, a BLE transport will need to be
> added — the `ImuTransport` interface in `@kinesis/imu` is designed to
> support that without changes to the rest of the pipeline.

## Wire protocol

```
tMs,ax,ay,az,gx,gy,gz\n              # 6-axis (current sketch)
tMs,ax,ay,az,gx,gy,gz,mx,my,mz\n     # 9-axis (with magnetometer, optional)
```

* `tMs` — device's millisecond clock (resets on reboot)
* `ax/ay/az` — accelerometer in *g*
* `gx/gy/gz` — gyroscope in *deg/s*
* `mx/my/mz` — optional magnetometer in *µT*

Lines starting with `#` are treated as comments and ignored by the host
parser. Any malformed line is dropped silently — the next good line
just continues the stream.

## Tuning

If the fused angle looks jittery, increase smoothing in
`packages/imu/src/filter.ts` by raising the complementary filter
`alpha` (default 0.98) toward 1.0, or by lowering the Madgwick `beta`
(default 0.04) toward 0.01.

If it looks laggy, do the opposite — lower `alpha` to ~0.95 or raise
`beta` to ~0.1.

If yaw drifts over a session (typical with no magnetometer), recalibrate
between exercises. Yaw drift doesn't affect flexion angles for hinge
joints like knee or elbow, so for most rehab use it can be ignored.
