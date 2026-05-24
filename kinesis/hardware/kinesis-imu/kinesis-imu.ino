/*
 * KINESIS IMU streamer — reference sketch.
 *
 * Target: any Arduino with USB Serial + I2C (Uno, Nano, ESP32, RP2040, …).
 * IMU:    MPU-6050 (or MPU-9250, ICM-20948) on I2C address 0x68.
 *
 * Output:
 *   • CSV over USB Serial at 115200 baud, 100 Hz.
 *   • One line per sample: tMs,ax,ay,az,gx,gy,gz\n
 *   • Accel in g (1.0 ≈ 9.81 m/s²), gyro in °/s.
 *   • Lines starting with '#' are treated as comments by the host.
 *
 * The KINESIS patient app picks this up via Web Serial, runs a
 * complementary filter or Madgwick AHRS on it, and fuses the resulting
 * orientation with the camera-based pose estimate for whichever limb the
 * IMU is strapped to.
 *
 * Wiring (Uno / Nano):
 *   MPU-6050 VCC  → 3.3V or 5V (most breakouts are tolerant of both)
 *   MPU-6050 GND  → GND
 *   MPU-6050 SCL  → A5
 *   MPU-6050 SDA  → A4
 *   MPU-6050 INT  → not required (we poll)
 *
 * Wiring (ESP32):
 *   SCL → GPIO22, SDA → GPIO21
 *
 * Wiring (RP2040 / Pico):
 *   SCL → GP5,    SDA → GP4
 *
 * Place the sensor on the limb segment you want to track. For rehab, a
 * good default is:
 *   • Knee flexion → on the shin, ~halfway between knee and ankle.
 *   • Elbow flexion → on the forearm, ~halfway between elbow and wrist.
 *   • Shoulder abduction → on the upper arm, just above the elbow.
 *
 * Strap orientation: the sensor's +X axis should point distally (toward
 * the hand or foot). If the resulting angles run the wrong way in the
 * app, toggle "Invert" in the calibration step or flip the strap.
 *
 * --- DEPENDENCIES ---
 * Install the "MPU6050_tockn" or "Adafruit MPU6050" library from the
 * Arduino IDE Library Manager. This sketch targets MPU6050_tockn for
 * its terse API; switch the include + setup calls if you prefer a
 * different one.
 */

#include <Wire.h>
#include <MPU6050_tockn.h>

MPU6050 mpu(Wire);

// Sample period — 10ms = 100Hz. Increase to e.g. 20ms (50Hz) if your USB
// link is unreliable or the host can't keep up.
static const unsigned long SAMPLE_PERIOD_MS = 10;

unsigned long lastSampleMs = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) { /* wait briefly for USB on Leonardo/Pro Micro */ }
  Serial.println(F("# KINESIS IMU streamer v1"));
  Serial.println(F("# format: tMs,ax,ay,az,gx,gy,gz"));

  Wire.begin();
  mpu.begin();
  Serial.println(F("# calibrating gyro — keep sensor still for 2s"));
  mpu.calcGyroOffsets(true);
  Serial.println(F("# ready"));
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSampleMs < SAMPLE_PERIOD_MS) return;
  lastSampleMs = now;

  mpu.update();

  // Raw scaled values straight from the library:
  //   getAccX/Y/Z()  → g
  //   getGyroX/Y/Z() → °/s
  //
  // We emit a fixed-precision CSV. 3 decimal places is plenty (gyro
  // noise floor is around 0.05°/s, accel noise around 0.005g).
  Serial.print(now);            Serial.print(',');
  Serial.print(mpu.getAccX(), 3); Serial.print(',');
  Serial.print(mpu.getAccY(), 3); Serial.print(',');
  Serial.print(mpu.getAccZ(), 3); Serial.print(',');
  Serial.print(mpu.getGyroX(), 2); Serial.print(',');
  Serial.print(mpu.getGyroY(), 2); Serial.print(',');
  Serial.println(mpu.getGyroZ(), 2);
}
