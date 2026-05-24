/*
 * KINESIS IMU streamer — MYOSA kit (MPU-6050)
 *
 *  Target board:   MYOSA "Multiple Yet One Sensors Assembly" — Arduino-Nano
 *                  flavoured kit (ATmega328P @ 16 MHz).
 *  IMU used:       Onboard MPU-6050 on the shared I²C bus (addr 0x68).
 *  Wire protocol:  Identical to the desktop reference sketch — CSV at
 *                  115200 baud, 100 Hz, one line per sample:
 *
 *                      tMs,ax,ay,az,gx,gy,gz\n
 *
 *                  • tMs is the device's millisecond clock (resets on boot).
 *                  • ax, ay, az are in g  (1.0 ≈ 9.81 m/s²).
 *                  • gx, gy, gz are in °/s.
 *                  • Comment lines start with "#" and are ignored by the host.
 *
 *  The KINESIS patient app (Web Serial → @kinesis/imu) parses this stream
 *  directly. No app-side changes are needed when you flash this sketch.
 *
 * ────────────────────────────────────────────────────────────────────
 *  LIBRARIES (install from Arduino IDE → Tools → Manage Libraries…)
 *
 *    1. "MPU6050_tockn" by tockn          — terse MPU-6050 wrapper.
 *    2. Wire (built-in)                   — I²C bus driver.
 *
 *  Why MPU6050_tockn? It exposes the calibration step as a single
 *  `calcGyroOffsets()` call and gives you scaled accel/gyro in g and
 *  °/s without manual scaling. If you'd prefer Adafruit's library,
 *  swap the include + the call sites — the rest of the sketch is
 *  library-agnostic.
 *
 * ────────────────────────────────────────────────────────────────────
 *  MYOSA WIRING NOTES
 *
 *    • The MYOSA carrier wires the MPU-6050 to the Nano's hardware I²C
 *      pins, so SDA = A4 and SCL = A5. No jumpers required.
 *    • Power is taken from the kit's 5 V rail. The MPU-6050 breakout has
 *      a regulator + level shifter onboard so this is fine.
 *    • The MYOSA board has other I²C sensors on the same bus (BME280,
 *      AT24C, etc.). Don't worry — each has a unique address; the
 *      MPU-6050 sits at 0x68 and won't collide.
 *    • Use the onboard LED on D13 as a status light: solid during
 *      calibration, off afterwards (so you know the gyro offsets locked
 *      in before you start strapping the sensor to a limb).
 *
 * ────────────────────────────────────────────────────────────────────
 *  STRAPPING THE SENSOR
 *
 *   Choose the limb segment matching the joint you want to track and
 *   secure the MPU-6050 board to the skin (or thin clothing) with
 *   velcro or athletic tape. The sensor's +X axis should point distally
 *   (toward the hand or foot). If KINESIS shows the joint angle running
 *   the wrong way, either flip the strap orientation or toggle "Invert"
 *   on the calibration card.
 *
 *     Knee flexion       → mid-shin, halfway between knee and ankle.
 *     Elbow flexion      → mid-forearm, palm-up.
 *     Shoulder abduction → lateral upper arm, just above the elbow.
 *     Hip flexion        → anterior thigh, mid-femur.
 *     Ankle dorsiflexion → top of the foot, behind the toes.
 *
 * ────────────────────────────────────────────────────────────────────
 *  PAIRING IN KINESIS
 *
 *    1. Flash this sketch via Arduino IDE → Sketch → Upload.
 *    2. Close the Serial Monitor (Web Serial can only hold the port once).
 *    3. Open the patient app at http://localhost:3001/session.
 *    4. After picking an exercise, hit "Enable camera", then "Pair IMU".
 *    5. Pick the COM port labelled with the MYOSA's USB-Serial chip
 *       (Windows: COMx ; macOS: /dev/cu.usbserial-XXXX ; Linux:
 *       /dev/ttyUSB0).
 *    6. Hold the limb at the calibration pose, hit Calibrate, and start
 *       recording.
 */

#include <Wire.h>
#include <MPU6050_tockn.h>

// ── Configuration ────────────────────────────────────────────────────
static const unsigned long SERIAL_BAUD       = 115200UL;
static const unsigned long SAMPLE_PERIOD_MS  = 10UL;   // 10 ms = 100 Hz
static const uint8_t       STATUS_LED_PIN    = 13;     // onboard LED on MYOSA
static const bool          BLINK_HEARTBEAT   = true;   // toggle LED every 1s while streaming

// ── State ────────────────────────────────────────────────────────────
MPU6050 mpu(Wire);
unsigned long lastSampleMs = 0;
unsigned long lastHeartbeatMs = 0;
bool          heartbeatOn = false;

// ── Setup ────────────────────────────────────────────────────────────
void setup() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);  // solid during boot/calibration

  Serial.begin(SERIAL_BAUD);
  // On Leonardo/Pro Micro the USB serial isn't ready immediately. The Nano
  // (which MYOSA uses) doesn't need this, but the guard is harmless.
  unsigned long start = millis();
  while (!Serial && millis() - start < 2000) { /* wait briefly */ }

  // Header — every line starting with '#' is a comment that the KINESIS
  // host ignores. We use them for human-readable diagnostics.
  Serial.println(F("# KINESIS IMU streamer · MYOSA / MPU-6050"));
  Serial.println(F("# format: tMs,ax,ay,az,gx,gy,gz"));
  Serial.println(F("# units : ms,g,g,g,deg/s,deg/s,deg/s"));

  // ── I²C bring-up ─────────────────────────────────────────────────
  Wire.begin();
  Wire.setClock(400000UL);  // fast-mode I²C; MPU-6050 supports up to 400 kHz

  // ── Probe the MPU-6050 ──────────────────────────────────────────
  // Sanity check the address before MPU6050_tockn talks to it, so we can
  // give a friendly error if the sensor isn't responding.
  Wire.beginTransmission(0x68);
  if (Wire.endTransmission() != 0) {
    Serial.println(F("# ERROR: MPU-6050 not found at 0x68"));
    Serial.println(F("# Check ribbon cable / sensor jumper. Halting."));
    while (true) {
      digitalWrite(STATUS_LED_PIN, HIGH); delay(120);
      digitalWrite(STATUS_LED_PIN, LOW);  delay(120);
    }
  }

  // ── Initialise + calibrate ──────────────────────────────────────
  mpu.begin();
  // Configure the sensor ranges before calibration. Defaults are fine for
  // limb tracking — ±2g accel / ±250°/s gyro — but we explicitly set them
  // so we don't depend on whatever the previous sketch left in the
  // sensor's registers.
  mpu.setGyroConfig(0);   // 0 = ±250 °/s
  mpu.setAccConfig(0);    // 0 = ±2 g

  Serial.println(F("# calibrating gyro offsets — keep sensor still for 2s"));
  mpu.calcGyroOffsets(false);  // false = don't print to Serial (keeps the stream clean)
  Serial.println(F("# ready"));

  digitalWrite(STATUS_LED_PIN, LOW);
  lastSampleMs = millis();
  lastHeartbeatMs = millis();
}

// ── Loop ─────────────────────────────────────────────────────────────
void loop() {
  const unsigned long now = millis();

  // Heartbeat — slow blink so you can tell the firmware is alive even
  // when the USB cable is connected to nothing in particular.
  if (BLINK_HEARTBEAT && now - lastHeartbeatMs >= 1000UL) {
    lastHeartbeatMs = now;
    heartbeatOn = !heartbeatOn;
    digitalWrite(STATUS_LED_PIN, heartbeatOn ? HIGH : LOW);
  }

  if (now - lastSampleMs < SAMPLE_PERIOD_MS) return;
  lastSampleMs = now;

  // Read fresh samples from the sensor.
  mpu.update();

  // Stream one CSV row. MPU6050_tockn returns scaled values already:
  //   getAccX()/Y()/Z()  → g
  //   getGyroX()/Y()/Z() → °/s
  Serial.print(now);                Serial.print(',');
  Serial.print(mpu.getAccX(), 3);   Serial.print(',');
  Serial.print(mpu.getAccY(), 3);   Serial.print(',');
  Serial.print(mpu.getAccZ(), 3);   Serial.print(',');
  Serial.print(mpu.getGyroX(), 2);  Serial.print(',');
  Serial.print(mpu.getGyroY(), 2);  Serial.print(',');
  Serial.println(mpu.getGyroZ(), 2);
}
