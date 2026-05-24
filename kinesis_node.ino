/*
 * ============================================================================
 * KINESIS  -  Inertial Ground-Truth Node Firmware
 * ----------------------------------------------------------------------------
 * Platform: MYOSA Motherboard (ESP32-WROOM-32E) with onboard MPU6050 IMU
 *
 * This firmware turns the wearable into a high-rate orientation sensor that
 * anchors the wider KINESIS pipeline. The IMU sits on the upper arm and
 * streams quaternion plus Euler orientation at 20 Hz, while a separate
 * computer-vision pipeline running on the host estimates the full body
 * skeleton from camera input. The CV side handles the heavy kinematic
 * inference, the IMU here provides the absolute orientation reference
 * that keeps the vision estimates honest, particularly when the camera
 * loses sight of the limb or lighting drops.
 *
 * Why this split: clinical wearables succeed or fail on how little
 * hardware the patient has to wear. One body-worn IMU plus a camera
 * gives near-medical-grade joint kinematics without strapping sensors
 * to every segment. The IMU is the truth signal, the AI fills in the rest.
 *
 * Sampling runs at 100 Hz on the device, Madgwick AHRS fuses the
 * accelerometer and gyroscope into a stable orientation quaternion,
 * and the host receives a JSON frame every 50 ms containing:
 *
 *   t                 millisecond timestamp since boot
 *   qw, qx, qy, qz    orientation quaternion
 *   roll, pitch, yaw  Euler angles in degrees
 *   ax, ay, az        accelerometer reading
 *   gx, gy, gz        gyroscope reading in deg/s
 *   romMin, romMax    running min and max pitch for the session
 *   romSpan           total range of motion swept so far
 *   motion            short-window activity magnitude
 *
 * The frame is consumed by the KINESIS Android companion app for live
 * visualization, by the CV fusion service for kinematic alignment, and
 * by the offline data pipeline that trains the movement-quality classifier.
 *
 * Author: Mohammed Alhnidi, Khalifa University
 * Project: KINESIS, IEEE MYOSA Event 5.0 / IEEE Biosensors 2026
 * ============================================================================
 */

#include <AccelAndGyro.h>
#include <Wire.h>
#include <MadgwickAHRS.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

static const uint32_t SAMPLING_RATE_HZ   = 100;   // IMU read + fusion update
static const uint32_t STATUS_INTERVAL_MS = 200;   // human-readable status print
static const uint32_t TELEMETRY_INTERVAL_MS = 50; // JSON telemetry frame
static const float    DEG_TO_HALF_RAD    = 0.0087266f;  // pi / 360, for half-angle

// ---------------------------------------------------------------------------
// Sensor and filter instances
// ---------------------------------------------------------------------------

AccelAndGyro inertialSensor;
Madgwick     orientationFilter;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

struct OrientationState {
  float roll  = 0.0f;
  float pitch = 0.0f;
  float yaw   = 0.0f;
};

struct InertialFrame {
  float accelX = 0.0f, accelY = 0.0f, accelZ = 0.0f;
  float gyroX  = 0.0f, gyroY  = 0.0f, gyroZ  = 0.0f;
};

struct RangeOfMotion {
  float minPitch = 9999.0f;
  float maxPitch = -9999.0f;
  float span() const { return maxPitch - minPitch; }
};

OrientationState orientation;
InertialFrame    inertial;
RangeOfMotion    rangeOfMotion;

float    motionMagnitude   = 0.0f;
float    previousPitch     = 0.0f;
uint32_t totalSamples      = 0;

uint32_t lastSampleMicros  = 0;
uint32_t lastStatusMillis  = 0;
uint32_t lastTelemetryMillis = 0;

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

// Derive a quaternion from the current Euler angles. The Arduino MadgwickAHRS
// library only exposes roll/pitch/yaw directly, so we reconstruct the
// quaternion at telemetry time. The CV fusion service re-normalizes on
// receive, so any rounding from the conversion is absorbed downstream.
void emitTelemetryFrame() {
  const float halfRoll  = orientation.roll  * DEG_TO_HALF_RAD;
  const float halfPitch = orientation.pitch * DEG_TO_HALF_RAD;
  const float halfYaw   = orientation.yaw   * DEG_TO_HALF_RAD;

  const float cy = cosf(halfYaw);
  const float sy = sinf(halfYaw);
  const float cp = cosf(halfPitch);
  const float sp = sinf(halfPitch);
  const float cr = cosf(halfRoll);
  const float sr = sinf(halfRoll);

  const float qw = cr * cp * cy + sr * sp * sy;
  const float qx = sr * cp * cy - cr * sp * sy;
  const float qy = cr * sp * cy + sr * cp * sy;
  const float qz = cr * cp * sy - sr * sp * cy;

  Serial.print("{\"t\":");        Serial.print(millis());
  Serial.print(",\"qw\":");       Serial.print(qw, 4);
  Serial.print(",\"qx\":");       Serial.print(qx, 4);
  Serial.print(",\"qy\":");       Serial.print(qy, 4);
  Serial.print(",\"qz\":");       Serial.print(qz, 4);
  Serial.print(",\"roll\":");     Serial.print(orientation.roll, 2);
  Serial.print(",\"pitch\":");    Serial.print(orientation.pitch, 2);
  Serial.print(",\"yaw\":");      Serial.print(orientation.yaw, 2);
  Serial.print(",\"ax\":");       Serial.print(inertial.accelX, 3);
  Serial.print(",\"ay\":");       Serial.print(inertial.accelY, 3);
  Serial.print(",\"az\":");       Serial.print(inertial.accelZ, 3);
  Serial.print(",\"gx\":");       Serial.print(inertial.gyroX, 2);
  Serial.print(",\"gy\":");       Serial.print(inertial.gyroY, 2);
  Serial.print(",\"gz\":");       Serial.print(inertial.gyroZ, 2);
  Serial.print(",\"romMin\":");   Serial.print(rangeOfMotion.minPitch, 2);
  Serial.print(",\"romMax\":");   Serial.print(rangeOfMotion.maxPitch, 2);
  Serial.print(",\"romSpan\":");  Serial.print(rangeOfMotion.span(), 2);
  Serial.print(",\"motion\":");   Serial.print(motionMagnitude, 2);
  Serial.println("}");

  motionMagnitude = 0.0f;
}

void emitStatusLine() {
  Serial.print("[STATUS] Pitch: "); Serial.print(orientation.pitch, 1);
  Serial.print(" | Roll: ");        Serial.print(orientation.roll, 1);
  Serial.print(" | Yaw: ");         Serial.print(orientation.yaw, 1);
  Serial.print(" | ROM: ");         Serial.print(rangeOfMotion.span(), 1);
  Serial.print(" deg | Samples: "); Serial.println(totalSamples);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

// Read one IMU sample and advance the orientation filter. Pitch is the
// primary kinematic axis when the sensor is mounted on the upper arm,
// so range-of-motion tracks it directly.
void sampleAndFuse() {
  if (!inertialSensor.ping()) return;

  inertial.accelX = inertialSensor.getAccelX(false);
  inertial.accelY = inertialSensor.getAccelY(false);
  inertial.accelZ = inertialSensor.getAccelZ(false);
  inertial.gyroX  = inertialSensor.getGyroX(false);
  inertial.gyroY  = inertialSensor.getGyroY(false);
  inertial.gyroZ  = inertialSensor.getGyroZ(false);

  orientationFilter.updateIMU(
    inertial.gyroX,  inertial.gyroY,  inertial.gyroZ,
    inertial.accelX, inertial.accelY, inertial.accelZ
  );

  orientation.roll  = orientationFilter.getRoll();
  orientation.pitch = orientationFilter.getPitch();
  orientation.yaw   = orientationFilter.getYaw();

  if (orientation.pitch < rangeOfMotion.minPitch) rangeOfMotion.minPitch = orientation.pitch;
  if (orientation.pitch > rangeOfMotion.maxPitch) rangeOfMotion.maxPitch = orientation.pitch;

  motionMagnitude += fabsf(orientation.pitch - previousPitch);
  previousPitch = orientation.pitch;

  totalSamples++;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== KINESIS Inertial Ground-Truth Node ===");
  Serial.println("Role: high-rate orientation anchor for IMU+CV fusion");

  Wire.begin();
  Wire.setClock(100000);

  // The MYOSA sensor stack sometimes needs a few retries to come up
  // cleanly after a cold boot, so we keep trying for a couple of seconds
  // before giving up.
  Serial.print("Initializing onboard IMU (0x69)... ");
  bool initialized = false;
  for (uint8_t attempt = 0; attempt < 10; attempt++) {
    if (inertialSensor.begin() == true) {
      initialized = true;
      break;
    }
    delay(200);
  }
  if (!initialized) {
    Serial.println("FAILED");
    Serial.println("Check that the sensor stack is fully seated.");
    while (true) delay(1000);
  }
  Serial.println("OK");

  orientationFilter.begin(SAMPLING_RATE_HZ);

  Serial.println("Streaming orientation telemetry at 20 Hz.");
  Serial.println("------------------------------------------------------");
  lastSampleMicros = micros();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

void loop() {
  const uint32_t sampleInterval = 1000000UL / SAMPLING_RATE_HZ;
  const uint32_t nowMicros = micros();

  if (nowMicros - lastSampleMicros >= sampleInterval) {
    lastSampleMicros = nowMicros;
    sampleAndFuse();
  }

  const uint32_t nowMillis = millis();

  if (nowMillis - lastStatusMillis >= STATUS_INTERVAL_MS) {
    lastStatusMillis = nowMillis;
    emitStatusLine();
  }

  if (nowMillis - lastTelemetryMillis >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMillis = nowMillis;
    emitTelemetryFrame();
  }
}
