# How the firmware works

`kinesis_node.ino` is a single-file Arduino sketch that runs on the
MYOSA motherboard (ESP32-WROOM-32E) and turns the MYOSA AccelAndGyro
module into a high-rate ground-truth IMU stream for the patient web
app.

## Hardware

| Block               | Part / role                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| **MYOSA motherboard** | ESP32-WROOM-32E. USB-serial via CP210x, regulator, I²C bus header.    |
| **AccelAndGyro**    | 6-axis IMU (MPU-style) at I²C address `0x69`.                          |
| **Power**           | USB 5 V from the patient's laptop or a battery brick.                  |
| **Mounting**        | Velcro strap on the working limb segment (e.g. upper arm for elbow).   |

I²C bus runs at 100 kHz — slower than the IMU's spec ceiling but
rock-solid across the pogo-pin headers MYOSA uses for the sensor
stack.

## What it does, in one paragraph

Boot, init the IMU (10 retries), then loop forever sampling at
**100 Hz** through a Madgwick AHRS filter that fuses gyro and accel
into an orientation quaternion. Every **50 ms** (20 Hz) the most
recent fused frame is emitted as a single JSON line over USB serial.
The patient app opens the serial port, reads the JSON, and uses the
on-device quaternion directly as a high-fidelity joint-angle source.

## Output format

One JSON line per frame (LF terminated, 20 Hz):

```json
{
  "t": 12345,            // millis() at emit
  "qw": 0.9986,          // fused quaternion w
  "qx": 0.0123,          // fused quaternion x
  "qy": -0.0451,         // fused quaternion y
  "qz": 0.0207,          // fused quaternion z
  "roll": -2.65,         // Euler roll, deg
  "pitch": 5.18,         // Euler pitch, deg
  "yaw": 1.23,           // Euler yaw, deg
  "ax": 0.02, "ay": 0.98, "az": 0.21,    // accel, g (1 = 9.81 m/s²)
  "gx": 1.2,  "gy": -0.4, "gz": 0.1,     // gyro, deg/s
  "romMin":  -45.2,      // session min pitch
  "romMax":   78.4,      // session max pitch
  "romSpan": 123.6,      // romMax - romMin
  "motion":   2.13       // |Δpitch| accumulated since last emit
}
```

The browser parser is permissive — it extracts whatever keyed
numeric fields are present and tolerates `nan` / `inf` literals
(Arduino's `Serial.print(float)` prints those verbatim when the
Madgwick filter blips during boot).

## Why both quaternion and Euler?

- **Quaternion** is the canonical orientation; no gimbal lock.
- **Euler** is human-readable and convenient for the in-firmware
  ROM tracking (pitch is the primary kinematic axis when the
  sensor is strapped to a limb segment).

The browser uses the quaternion. The Euler triplet is along for
debugging and the `[STATUS]` line that prints to the Arduino IDE
Serial Monitor every 200 ms.

## Configuration

Three `#define`s control the timing:

```cpp
#define SAMPLE_RATE_HZ        100   // IMU read + Madgwick update rate
#define DISPLAY_REFRESH_MS    200   // [STATUS] debug print interval
#define SERIAL_STREAM_MS      50    // JSON emit interval (→ 20 Hz)
```

The Madgwick filter must be told its sample rate so its integration
step is correct:

```cpp
filter.begin(SAMPLE_RATE_HZ);
```

`SAMPLE_RATE_HZ` is the IMU read rate, not the serial rate. Reading
the IMU faster gives the filter more data and tighter orientation
estimates; the serial rate just controls how often the latest fused
frame escapes to USB.

To stream at higher rate, lower `SERIAL_STREAM_MS`. 20 ms (50 Hz)
is the sweet spot — halves perceived latency in the browser without
saturating the USB FIFO.

## Init sequence

```cpp
Serial.begin(115200);
delay(300);

Wire.begin();
Wire.setClock(100000);

for (uint8_t attempt = 0; attempt < 10; attempt++) {
  if (imu.begin() == true) { Serial.println("OK"); break; }
  delay(200);
  if (attempt == 9) {
    Serial.println("FAILED, check sensor stack seating");
    while (1) delay(1000);   // halt — IMU not detected
  }
}

filter.begin(SAMPLE_RATE_HZ);
```

If `imu.begin()` fails all 10 retries the firmware halts and prints
`FAILED, check sensor stack seating`. The browser will see a port
that opens cleanly but receives no JSON — it surfaces this as
`⚠ Port open but no bytes` so the user knows where to look.

## The main loop

```cpp
void loop() {
  const unsigned long sampleIntervalUs = 1000000UL / SAMPLE_RATE_HZ;
  unsigned long now = micros();

  if (now - lastSampleUs >= sampleIntervalUs) {
    lastSampleUs = now;
    if (imu.ping()) {
      lastAx = imu.getAccelX(false);  // false suppresses library prints
      lastAy = imu.getAccelY(false);
      lastAz = imu.getAccelZ(false);
      lastGx = imu.getGyroX(false);
      lastGy = imu.getGyroY(false);
      lastGz = imu.getGyroZ(false);

      filter.updateIMU(lastGx, lastGy, lastGz, lastAx, lastAy, lastAz);
      currentRoll  = filter.getRoll();
      currentPitch = filter.getPitch();
      currentYaw   = filter.getYaw();

      if (currentPitch < romMin) romMin = currentPitch;
      if (currentPitch > romMax) romMax = currentPitch;
      motionAccum += fabsf(currentPitch - lastPitch);
      lastPitch = currentPitch;
      sampleCount++;
    }
  }

  unsigned long ms = millis();
  if (ms - lastDisplayMs >= DISPLAY_REFRESH_MS) {
    lastDisplayMs = ms;
    displayStatus();          // [STATUS] line for Arduino IDE
  }
  if (ms - lastSerialMs >= SERIAL_STREAM_MS) {
    lastSerialMs = ms;
    streamKinesisJSON();      // the line the browser parses
  }
}
```

Three timers run independently — sample, status, stream — and the
loop's micro/milli arithmetic keeps them all phase-stable even when
one runs slow. The IMU read is gated by `imu.ping()` so the loop
never blocks on a sensor that's mid-transaction.

## Quaternion synthesis

The MYOSA Madgwick library exposes `getRoll() / getPitch() / getYaw()`
but no quaternion accessor. We synthesise it from the Euler triplet
inside `streamKinesisJSON()`:

```cpp
float cy = cosf(yaw  * 0.5f * DEG2RAD), sy = sinf(yaw  * 0.5f * DEG2RAD);
float cp = cosf(pit  * 0.5f * DEG2RAD), sp = sinf(pit  * 0.5f * DEG2RAD);
float cr = cosf(roll * 0.5f * DEG2RAD), sr = sinf(roll * 0.5f * DEG2RAD);

qw = cr*cp*cy + sr*sp*sy;
qx = sr*cp*cy - cr*sp*sy;
qy = cr*sp*cy + sr*cp*sy;
qz = cr*cp*sy - sr*sp*cy;
```

The browser side renormalises after parsing in case rounding introduces drift.

## Auto-reset on connect

The patient app pulses RTS high → low after opening the port:

```ts
await port.setSignals({ dataTerminalReady: false, requestToSend: true });
await wait(80);
await port.setSignals({ dataTerminalReady: false, requestToSend: false });
```

The MYOSA's USB-serial chip wires RTS to EN. Pulse high → EN goes
low → ESP32 resets. DTR stays low so the boot pin (IO0) stays high
and the chip boots into run mode, not bootloader. Net effect: every
time the patient clicks **Connect**, the firmware reboots cleanly
into the JSON stream, regardless of whatever state the chip was in
before.

## Flashing the sketch

In Arduino IDE:

1. **Tools → Board → ESP32 Dev Module** (or whatever MYOSA's
   programming guide specifies).
2. **Tools → Port** → the COM port the MYOSA shows up as
   (usually a Silicon Labs CP210x USB to UART Bridge).
3. **Tools → Upload Speed → 921600** (faster flash time).
4. Install dependencies via Library Manager:
   - `MYOSA AccelAndGyro` (from MYOSA's GitHub)
   - `MadgwickAHRS` by Arduino
5. Hit **Upload**.
6. Open **Serial Monitor at 115200 baud** to confirm:
   ```
   === KINESIS Phase 1 ===
   Init MYOSA onboard IMU (0x69)... OK
   KINESIS ready. Streaming ground-truth IMU frame at 20 Hz.
   ------------------------------------------------------
   {"t":120,"qw":1.0000,"qx":0.0000,...}
   {"t":170,"qw":0.9999,"qx":0.0007,...}
   ```

Once you see streaming JSON, the patient app's IMU panel will pick
it up the instant you click **Connect** and pick the port.

## Troubleshooting

| Symptom in the browser                        | Likely cause                                           | Fix                                                                |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `Failed to open serial port`                  | Arduino IDE / another app holds the port.              | Close Serial Monitor. Quit Arduino IDE entirely.                   |
| `Port open but no bytes`                      | `imu.begin()` failed → firmware halted.                | Reseat the IMU module. Hit RESET. Watch boot in Arduino IDE first. |
| `N bytes received but no parseable frames`    | Boot-loop / partial line / non-JSON serial garbage.    | Pulse RESET. Confirm boot banner in Arduino IDE.                   |
| IMU connected but joint angle never updates   | Calibration not done — IMU is unbound.                 | Hold limb at rest pose, click **Calibrate**.                       |

## Why a separate sensor at all

MediaPipe is good but it's a **camera-driven** estimator. When the
patient turns sideways, occludes the limb with their other arm, or
moves out of frame, the camera angle gets noisy or drops entirely.
The IMU keeps producing tight orientation data regardless, and the
browser blends them with a confidence-weighted average so the rep
counter never gets fooled by a single bad camera frame.
