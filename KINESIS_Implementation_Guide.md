# KINESIS Implementation Guide

## Kinetic Intelligence for Neuromusculoskeletal Evaluation, Synthesis, and Insight Systems

**IEEE MYOSA Event 5.0 | Phase 1 Build Guide**

**Team:** Mohammed Alhnidi (Lead), Obada Walid Mohammad, Yazan Maamoon Kassab, Firas Al Eter

**Institution:** Khalifa University of Science and Technology, Abu Dhabi, UAE



---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Hardware Build](#2-hardware-build)
3. [Firmware (Arduino/ESP32)](#3-firmware)
4. [AI Model Pipeline](#4-ai-model-pipeline)
5. [Companion Android App](#5-companion-android-app)
6. [Task Assignment](#6-task-assignment)
7. [Build Timeline](#7-build-timeline)
8. [Demo Preparation](#8-demo-preparation)

---

## 1. Project Overview

### What is KINESIS?

KINESIS is an AI-driven wearable rehabilitation monitoring system that uses IMU sensors attached to a patient's limb segments to capture motion data during rehabilitation exercises. The data streams via Bluetooth to a companion Android app, which runs TensorFlow Lite models to classify movement quality (normal, compensatory, guarded, abnormal) and track range of motion (ROM) recovery progress in real-time.

### Why does it matter?

Musculoskeletal disorders affect 1.71 billion people globally (WHO). Rehabilitation monitoring currently relies on periodic, subjective clinical assessments 2-3 times per week. Between sessions, regressions and complications go undetected. Research shows combining sensor and clinical data achieves 0.94 correlation with outcomes vs 0.79 for clinical data alone. KINESIS fills this gap with continuous, objective, AI-driven monitoring.

### Phase 1 Scope (MYOSA Event)

Phase 1 uses the MYOSA Mini Kit (ESP32 + sensors) as the hardware platform and a companion Android phone app for AI inference. This is the proof-of-concept that we demo at the IEEE conference.

### System Architecture Summary

```
[MYOSA ESP32 + MPU6050 x2-3]  --BLE-->  [Android Phone App]  --optional-->  [Firebase Cloud]
     |                                        |
     |-- APDS9960 (gesture/proximity)         |-- Feature Extraction (ROM, jerk, symmetry)
     |-- BMP180 (barometric pressure)         |-- TFLite Movement Classifier
     |-- SSD1306 OLED (local display)         |-- TFLite ROM Tracker
     |-- Madgwick sensor fusion               |-- Dashboard + Alerts
     |-- BLE GATT streaming                   |-- PDF Report Generation
```

### MYOSA Kit Components Used

| Component | Role in KINESIS |
|-----------|----------------|
| ESP32 Motherboard | Dual-core sensor fusion (Core 0) + BLE streaming (Core 1) |
| MPU6050 (Accel+Gyro) | Primary motion sensor for joint kinematics, ROM, jerk |
| APDS9960 (Gesture/Proximity/Light) | Contactless session trigger + exercise navigation |
| BMP180 (Barometric Pressure) | Sit-to-stand detection via altitude changes |
| SSD1306 OLED | Real-time display of ROM, quality score, rep count |

---

## 2. Hardware Build

### 2.1 Bill of Materials (Beyond MYOSA Kit)

| Item | Qty | Approx Cost | Source |
|------|-----|-------------|--------|
| GY-521 MPU6050 breakout board | 2 | $3-4 each | AliExpress/Amazon |
| TCA9548A I2C multiplexer module | 1 | $2 | AliExpress (only if using 3+ IMUs) |
| TP4056 Li-Po charging module | 1 | $1 | AliExpress |
| 3.7V 500mAh Li-Po battery | 1 | $3 | AliExpress |
| JST PH 2.0 connectors + jumper wires (F-F) | 1 pack | $2 | AliExpress |
| Elastic Velcro straps (adjustable, 30cm) | 2 | $3 | Amazon |
| Breadboard mini (optional, for prototyping) | 1 | $1 | AliExpress |

**Total additional cost: ~$15-20**

Optional: 3D-printed enclosures if KU's 3D printer is available (STL files will be designed by Firas).

### 2.2 Wiring Diagram

#### Node 1: Main MYOSA Stack (Upper Arm)

```
MYOSA Motherboard (ESP32)
  |
  |-- [I2C Bus: GPIO 21 (SDA), GPIO 22 (SCL)]
  |     |
  |     |-- MPU6050 #1 (kit sensor board, stacked via plug-and-play)
  |     |     AD0 = LOW -> address 0x68
  |     |
  |     |-- APDS9960 (kit sensor board, stacked on top)
  |     |     address 0x39 (fixed)
  |     |
  |     |-- BMP180 (kit sensor board, via JST cable)
  |     |     address 0x77 (fixed)
  |     |
  |     |-- SSD1306 OLED (kit display board, stacked)
  |           address 0x3C (fixed)
  |
  |-- [Power]
  |     |-- TP4056 module -> Li-Po 3.7V 500mAh
  |     |-- TP4056 OUT+ -> MYOSA VIN
  |     |-- TP4056 OUT- -> MYOSA GND
  |
  |-- [USB-C] for programming and charging
```

#### Node 2: Extra IMU (Forearm) - Wired to Main Board

```
MYOSA Motherboard GPIO 21 (SDA) ---[30cm wire]--- MPU6050 #2 SDA
MYOSA Motherboard GPIO 22 (SCL) ---[30cm wire]--- MPU6050 #2 SCL
MYOSA Motherboard 3.3V          ---[30cm wire]--- MPU6050 #2 VCC
MYOSA Motherboard GND           ---[30cm wire]--- MPU6050 #2 GND
                                                  MPU6050 #2 AD0 -> VCC (HIGH, address 0x69)
```

#### If Using 3 IMUs (Optional: Shoulder + Upper Arm + Forearm)

```
MYOSA Motherboard I2C -> TCA9548A multiplexer (address 0x70)
  |
  |-- Channel 0 -> MPU6050 #1 (shoulder) at 0x68
  |-- Channel 1 -> MPU6050 #2 (upper arm) at 0x68
  |-- Channel 2 -> MPU6050 #3 (forearm) at 0x68
```

All MPU6050s can use the same default address (0x68) because they are on separate multiplexer channels.

### 2.3 I2C Address Map

| Device | Address | Notes |
|--------|---------|-------|
| MPU6050 #1 | 0x68 | AD0 = LOW (default) |
| MPU6050 #2 | 0x69 | AD0 = HIGH (pull to VCC) |
| APDS9960 | 0x39 | Fixed, no conflict |
| BMP180 | 0x77 | Fixed, no conflict |
| SSD1306 OLED | 0x3C | Fixed, no conflict |
| TCA9548A (optional) | 0x70 | Only if using 3+ IMUs |

### 2.4 Assembly Steps

**Step 1: Prepare the MYOSA motherboard**
- Unbox the MYOSA Mini Kit
- Install the Arduino IDE and ESP32 board support (see Section 3)
- Connect via USB-C, upload a simple blink sketch to verify board works

**Step 2: Stack kit sensors onto the motherboard**
- Plug MPU6050 sensor board onto the motherboard's I2C stack connector
- Plug APDS9960 on top of MPU6050
- Plug SSD1306 OLED on top
- Connect BMP180 via JST cable

**Step 3: Verify all I2C devices**
- Upload an I2C scanner sketch
- Verify you see addresses: 0x68, 0x39, 0x77, 0x3C
- If any missing, check connections

**Step 4: Wire the extra MPU6050**
- Solder header pins onto the GY-521 breakout if needed
- Connect SDA, SCL, VCC (3.3V), GND via jumper wires to the MYOSA motherboard
- Pull AD0 HIGH (solder or wire to VCC) for address 0x69
- Re-run I2C scanner, verify 0x69 appears alongside others

**Step 5: Power system**
- Solder wires from TP4056 OUT+ and OUT- to MYOSA VIN and GND
- Connect Li-Po battery to TP4056 BAT+ and BAT-
- Test: unplug USB, verify board runs on battery
- Test: plug USB into TP4056, verify charging LED lights up

**Step 6: Physical mounting**
- Attach main MYOSA stack to upper arm using Velcro strap
- OLED should face outward (visible to patient/audience)
- Route cable to forearm MPU6050, strap it on
- BMP180 can clip to waist or sit on table (measures ambient pressure)

### 2.5 Enclosure Design (Firas)

If 3D printing is available, design two enclosures:

**Main node enclosure (~60mm x 50mm x 25mm):**
- Houses MYOSA motherboard + stacked sensors + battery
- Cutouts for: USB-C port, OLED window, I2C cable exit, strap slots
- Material: PLA, 0.2mm layer height

**IMU node enclosure (~30mm x 25mm x 15mm):**
- Houses single MPU6050 breakout
- Cable exit hole, strap slots
- Material: PLA

Export STL files. If no 3D printer, use foam padding + Velcro wrap.

---

## 3. Firmware

### 3.1 Development Environment Setup

```bash
# Install Arduino IDE 2.x from https://www.arduino.cc/en/software
# Add ESP32 board support:
#   File -> Preferences -> Additional Board Manager URLs:
#   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
# Tools -> Board -> Board Manager -> search "esp32" -> install "esp32 by Espressif"
# Select board: "ESP32 Dev Module"
# Port: select the USB-C serial port
```

### 3.2 Required Libraries (Install via Library Manager)

```
MPU6050_light (by rfetick) - or - I2Cdevlib MPU6050
MadgwickAHRS (by Arduino)
Adafruit_SSD1306
Adafruit_GFX
Adafruit_BMP085_Unified (works for BMP180)
SparkFun_APDS9960
```

### 3.3 Claude Code Prompt for Firmware

Copy and paste the following into Claude Code:

```
Build the complete Arduino firmware for the KINESIS wearable rehabilitation
monitoring system running on an ESP32 (MYOSA motherboard). The system reads
multiple IMU sensors, performs sensor fusion, computes rehabilitation metrics,
displays them on an OLED, and streams data via BLE to a companion phone app.

PROJECT STRUCTURE:
kinesis-firmware/
  kinesis-firmware.ino      // Main entry point
  config.h                  // All configuration constants
  imu_manager.h             // IMU initialization and reading
  imu_manager.cpp
  madgwick_filter.h         // Madgwick AHRS filter wrapper
  madgwick_filter.cpp
  sensor_manager.h          // APDS9960 + BMP180 management
  sensor_manager.cpp
  feature_engine.h          // Sliding window feature computation
  feature_engine.cpp
  ble_service.h             // BLE GATT service
  ble_service.cpp
  oled_display.h            // OLED display rendering
  oled_display.cpp

CONFIG (config.h):
  #define IMU_COUNT 2                    // Number of MPU6050 sensors
  #define IMU1_ADDR 0x68                 // Upper arm (AD0 LOW)
  #define IMU2_ADDR 0x69                 // Forearm (AD0 HIGH)
  #define SAMPLE_RATE_HZ 100            // IMU sampling rate
  #define BLE_STREAM_RATE_HZ 20         // BLE packet rate
  #define FEATURE_WINDOW_SAMPLES 250    // 2.5 seconds at 100Hz
  #define FEATURE_OVERLAP 0.5           // 50% overlap
  #define OLED_UPDATE_RATE_HZ 5         // OLED refresh rate
  #define SDA_PIN 21
  #define SCL_PIN 22
  #define OLED_ADDR 0x3C
  #define APDS_ADDR 0x39
  #define BMP_ADDR 0x77
  #define BLE_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
  #define BLE_CHAR_UUID    "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
  #define DEVICE_NAME "KINESIS-NODE"

IMU MANAGER (imu_manager):
  - Initialize both MPU6050 sensors on I2C bus
  - Read raw accel (ax, ay, az) and gyro (gx, gy, gz) from each at 100Hz
  - Apply calibration offsets (computed during setup by averaging 1000 samples while stationary)
  - Provide getter functions: getAccel(imu_id), getGyro(imu_id)
  - Handle I2C errors gracefully (retry 3 times, flag error)

MADGWICK FILTER (madgwick_filter):
  - Maintain separate MadgwickAHRS instances for each IMU
  - Feed accel + gyro data each cycle
  - Output quaternion (w, x, y, z) for each IMU
  - Compute joint angle between two IMUs:
    q_joint = q1_conjugate * q2
    angle = 2 * acos(q_joint.w) * 180 / PI
  - This gives the angle between the two limb segments (the elbow/shoulder angle)
  - Filter beta = 0.1 (default, tunable)

SENSOR MANAGER (sensor_manager):
  APDS9960:
    - Initialize in proximity + gesture mode
    - Read proximity value (0-255) every 100ms
    - If proximity > 200 for 1 second: trigger "session start" flag
    - If proximity > 200 after session running for 2 seconds: trigger "session stop" flag
    - Read gestures: UP, DOWN, LEFT, RIGHT
    - Expose: getProximity(), getGesture(), isSessionTriggered()
  
  BMP180:
    - Initialize and read pressure/altitude every 500ms
    - Maintain a baseline altitude (set at session start)
    - Compute altitude delta from baseline
    - If altitude delta > 0.3m sustained for 1s: flag "sit-to-stand" event
    - If altitude delta < -0.3m sustained for 1s: flag "stand-to-sit" event
    - Expose: getAltitude(), getAltitudeDelta(), getActivityTransition()

FEATURE ENGINE (feature_engine):
  - Maintain circular buffer of FEATURE_WINDOW_SAMPLES entries
  - Each entry: {timestamp, joint_angle, angular_velocity, accel_magnitude_1, accel_magnitude_2}
  - Every FEATURE_WINDOW_SAMPLES * (1 - FEATURE_OVERLAP) new samples, compute:
    - ROM: max(joint_angle) - min(joint_angle) in window (degrees)
    - Avg angular velocity: mean of absolute angular velocity (deg/s)
    - Peak angular velocity: max absolute angular velocity (deg/s)
    - Jerk: RMS of derivative of angular velocity (smoothness metric, lower = smoother)
    - Peak acceleration: max of accel_magnitude across both IMUs (g)
    - Rep count: count zero-crossings of angular velocity (each full up-down = 1 rep)
    - Movement duration: time span of window (ms)
  - Compute a simple quality score (0-100):
    - Start at 100
    - Subtract points for: high jerk (>threshold), low ROM (below expected),
      asymmetric acceleration, irregular rep timing
    - Clamp to 0-100
  - Expose: getROM(), getJerk(), getQualityScore(), getRepCount(), etc.

BLE SERVICE (ble_service):
  - Create BLE server with DEVICE_NAME
  - Create service with BLE_SERVICE_UUID
  - Create notify characteristic with BLE_CHAR_UUID
  - On client connect: set connected flag, log
  - On client disconnect: set disconnected flag, attempt to restart advertising
  - Every 50ms (20Hz): pack and send data packet
  
  PACKET FORMAT (68 bytes, little-endian):
    Bytes 0-3:   uint32_t timestamp_ms
    Bytes 4-7:   float q1_w    (upper arm quaternion)
    Bytes 8-11:  float q1_x
    Bytes 12-15: float q1_y
    Bytes 16-19: float q1_z
    Bytes 20-23: float q2_w    (forearm quaternion)
    Bytes 24-27: float q2_x
    Bytes 28-31: float q2_y
    Bytes 32-35: float q2_z
    Bytes 36-39: float ax1     (upper arm accel x)
    Bytes 40-43: float ay1
    Bytes 44-47: float az1
    Bytes 48-51: float ax2     (forearm accel x)
    Bytes 52-55: float ay2
    Bytes 56-59: float az2
    Bytes 60-63: float rom_degrees
    Bytes 64-67: float jerk_value
  
  - Use BLECharacteristic::setValue(packet, 68) then notify()

OLED DISPLAY (oled_display):
  - Initialize SSD1306 128x64 at address 0x3C
  - Update at OLED_UPDATE_RATE_HZ (5Hz)
  - Layout:
    Line 1 (bold, 16px): "KINESIS" (centered)
    Line 2: "ROM: XXX°  Rep: XX"
    Line 3: "Vel: XXX°/s"
    Line 4: "Score: XX/100  [===]"
    Line 5: Status bar - "BLE: Connected" or "BLE: ---"
  - The score bar on line 4 is a small progress bar (e.g., 10 chars wide)
  - If quality score > 70: draw normally
  - If quality score 40-70: draw with inverted section as warning
  - If quality score < 40: flash the display briefly as alert

MAIN LOOP (kinesis-firmware.ino):
  setup():
    - Initialize Serial at 115200
    - Initialize I2C at 400kHz
    - Initialize IMU manager (calibrate both MPU6050s - hold still 5 seconds)
    - Initialize sensor manager (APDS9960 + BMP180)
    - Initialize OLED display (show "KINESIS - Calibrating...")
    - Initialize feature engine
    - Initialize BLE service and start advertising
    - Show "Ready" on OLED
    - Create FreeRTOS task for BLE on Core 1
  
  loop() [runs on Core 0]:
    - Read both IMUs at 100Hz (use micros() timing)
    - Update Madgwick filters for both
    - Compute joint angle
    - Push to feature engine buffer
    - Every OLED_UPDATE interval: update OLED display
    - Check APDS9960 proximity/gestures
    - Read BMP180 every 500ms
    - Handle gesture commands:
      - Gesture UP: cycle to next exercise mode
      - Gesture DOWN: cycle to previous exercise mode
      - Gesture LEFT: reset session baseline
      - Gesture RIGHT: mark event timestamp
  
  bleTask() [runs on Core 1, FreeRTOS]:
    - Loop at 20Hz
    - If client connected: pack current data into 68-byte packet, notify
    - If client disconnected: restart advertising

LIBRARIES TO INCLUDE:
  #include <Wire.h>
  #include <MPU6050_light.h>   // or I2Cdevlib
  #include <MadgwickAHRS.h>
  #include <Adafruit_SSD1306.h>
  #include <Adafruit_GFX.h>
  #include <Adafruit_BMP085.h>
  #include <SparkFun_APDS9960.h>
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>

IMPORTANT NOTES:
  - Use FreeRTOS xTaskCreatePinnedToCore() to pin BLE to Core 1
  - Use volatile for shared variables between cores
  - Use mutex/semaphore for feature engine buffer access
  - Set I2C clock to 400kHz for fast multi-device reads
  - Handle MPU6050 FIFO overflow (clear FIFO if read falls behind)
  - BLE MTU should be set to at least 72 bytes (68 data + overhead)
  - If BLE disconnects during session, keep recording locally
  - Serial debug output should be toggleable via #define DEBUG
```

---

## 4. AI Model Pipeline

### 4.1 Development Environment Setup

```bash
# Create virtual environment
python -m venv kinesis-ml-env
source kinesis-ml-env/bin/activate  # Linux/Mac
# or: kinesis-ml-env\Scripts\activate  # Windows

# Install dependencies
pip install tensorflow numpy scipy pandas scikit-learn matplotlib jupyter
```

### 4.2 Claude Code Prompt for AI Model

Copy and paste the following into Claude Code:

```
Build a TensorFlow Lite movement quality classification and ROM tracking
model pipeline for the KINESIS wearable rehabilitation monitoring system.
The models will run on an Android phone receiving BLE data from ESP32 IMU
sensors. Since we don't have real patient data yet, generate realistic
synthetic training data first.

PROJECT STRUCTURE:
kinesis-ml/
  data/
    raw/                          # Raw sensor recordings (CSV)
    processed/                    # Feature-engineered datasets
    synthetic/                    # Generated synthetic data
  notebooks/
    01_data_exploration.ipynb
    02_feature_engineering.ipynb
    03_model_training.ipynb
    04_evaluation.ipynb
    05_tflite_conversion.ipynb
  src/
    synthetic_generator.py        # Generate training data
    data_loader.py                # Load and preprocess data
    feature_engine.py             # Feature extraction (mirrors phone app)
    augmentation.py               # Data augmentation
    movement_classifier.py        # 1D CNN classifier
    rom_tracker.py                # ROM regression model
    train.py                      # Training script
    evaluate.py                   # Evaluation with metrics + plots
    convert_tflite.py             # TFLite conversion + validation
  models/
    movement_classifier.h5
    movement_classifier.tflite
    rom_tracker.h5
    rom_tracker.tflite
  requirements.txt
  README.md

REQUIREMENTS.TXT:
  tensorflow>=2.15
  numpy>=1.24
  scipy>=1.11
  pandas>=2.0
  scikit-learn>=1.3
  matplotlib>=3.7
  seaborn>=0.12
  jupyter>=1.0

---

TASK 1: SYNTHETIC DATA GENERATION (synthetic_generator.py)

Generate realistic IMU-derived rehabilitation movement data for training.
Each sample represents a 2.5-second window of features extracted from
quaternion/acceleration sensor data.

The sensor setup: two IMU sensors (upper arm + forearm) capturing a
rehabilitation exercise like shoulder abduction or elbow flexion.

For each sample, generate a feature vector with these columns:
  - rom_degrees: range of motion in the window (max - min joint angle)
  - avg_angular_velocity: mean angular velocity (deg/s)
  - peak_angular_velocity: max angular velocity (deg/s)  
  - rms_jerk: RMS of angular acceleration (smoothness, lower = better)
  - peak_accel_1: peak acceleration magnitude, sensor 1 (g)
  - peak_accel_2: peak acceleration magnitude, sensor 2 (g)
  - accel_asymmetry: |peak_accel_1 - peak_accel_2| / max(peak_accel_1, peak_accel_2)
  - rom_variability: standard deviation of per-rep ROM within window
  - velocity_variability: CV of angular velocity
  - rep_count: number of repetitions detected in window
  - rep_regularity: std of inter-rep timing (lower = more regular)
  - altitude_delta: barometric altitude change in window (meters)

Generate 4 classes with these characteristics:

CLASS 0 - NORMAL:
  - rom_degrees: 70-120 (full healthy range)
  - avg_angular_velocity: 40-80 deg/s (moderate, controlled speed)
  - rms_jerk: 5-20 (smooth)
  - accel_asymmetry: 0-0.15 (symmetric)
  - rom_variability: 0-5 (consistent)
  - rep_regularity: 0-0.3s (regular timing)
  - rep_count: 3-6 per window

CLASS 1 - COMPENSATORY:
  - rom_degrees: 50-100 (slightly reduced)
  - avg_angular_velocity: 30-90 (variable, bursts)
  - rms_jerk: 20-60 (jerky due to compensation)
  - accel_asymmetry: 0.2-0.5 (asymmetric, favoring one side)
  - rom_variability: 5-15 (inconsistent)
  - velocity_variability: high (0.3-0.6 CV)
  - rep_count: 2-5

CLASS 2 - GUARDED:
  - rom_degrees: 20-60 (significantly reduced, protecting injury)
  - avg_angular_velocity: 10-30 (very slow, cautious)
  - rms_jerk: 15-40 (moderate, hesitant)
  - peak_accel: low (0.5-1.5g)
  - rom_variability: 3-10
  - rep_regularity: 0.5-1.5s (irregular, pauses)
  - rep_count: 1-3 (fewer reps)

CLASS 3 - ABNORMAL:
  - rom_degrees: variable (10-130, erratic)
  - avg_angular_velocity: variable (5-120, unpredictable)
  - rms_jerk: 40-100+ (very jerky, uncontrolled)
  - accel_asymmetry: 0.3-0.8 (highly asymmetric)
  - peak_accel: spikes (2-5g, sudden movements)
  - rom_variability: 10-30 (very inconsistent)
  - rep_regularity: high variance
  - rep_count: 0-4 (irregular)

Generation parameters:
  - 10,000 samples per class = 40,000 total
  - Add Gaussian noise (5-10% of feature range) to all features
  - Add correlation between features (e.g., high jerk correlates with high accel_asymmetry)
  - Split: 70% train, 15% validation, 15% test
  - Save as CSV files: train.csv, val.csv, test.csv
  - Also save as numpy arrays: X_train.npy, y_train.npy, etc.

---

TASK 2: FEATURE ENGINE (feature_engine.py)

This mirrors the feature extraction that runs on the Android phone app.
It processes raw sensor data (quaternions + accelerations) into the
feature vectors described above.

class FeatureEngine:
    def __init__(self, window_size=250, overlap=0.5, sample_rate=100):
        self.window_size = window_size
        self.overlap = overlap
        self.sample_rate = sample_rate
        self.buffer = deque(maxlen=window_size)
    
    def add_sample(self, timestamp, q1, q2, accel1, accel2, pressure):
        """Add a single sensor reading to the buffer."""
        joint_angle = self._compute_joint_angle(q1, q2)
        sample = {
            'timestamp': timestamp,
            'joint_angle': joint_angle,
            'angular_velocity': 0,  # computed from consecutive angles
            'accel_mag_1': np.linalg.norm(accel1),
            'accel_mag_2': np.linalg.norm(accel2),
            'pressure': pressure
        }
        self.buffer.append(sample)
    
    def compute_features(self) -> dict:
        """Extract feature vector from current window."""
        # Returns dict with all 12 features
        pass
    
    def _compute_joint_angle(self, q1, q2):
        """Angle between two quaternions (limb segments)."""
        q1_conj = quaternion_conjugate(q1)
        q_rel = quaternion_multiply(q1_conj, q2)
        angle = 2 * np.arccos(np.clip(q_rel[0], -1, 1)) * 180 / np.pi
        return angle
    
    def _detect_reps(self, angular_velocities):
        """Count reps via zero-crossings of angular velocity."""
        pass
    
    def _compute_jerk(self, angular_velocities, dt):
        """RMS of derivative of angular velocity."""
        pass

Include helper functions for quaternion math:
  - quaternion_conjugate(q) -> [w, -x, -y, -z]
  - quaternion_multiply(q1, q2) -> q_result
  - quaternion_to_euler(q) -> [roll, pitch, yaw]

---

TASK 3: MOVEMENT QUALITY CLASSIFIER (movement_classifier.py)

4-class classification: normal, compensatory, guarded, abnormal

Architecture: 1D CNN

def build_classifier(input_shape, num_classes=4):
    model = tf.keras.Sequential([
        # Reshape for Conv1D: treat feature vector as 1D sequence
        tf.keras.layers.Reshape((input_shape[0], 1), input_shape=input_shape),
        
        tf.keras.layers.Conv1D(32, kernel_size=3, padding='same'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.ReLU(),
        tf.keras.layers.MaxPooling1D(2),
        
        tf.keras.layers.Conv1D(64, kernel_size=3, padding='same'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.ReLU(),
        tf.keras.layers.GlobalAveragePooling1D(),
        
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model

Training:
  - Batch size: 64
  - Epochs: 100 with early stopping (patience=15, monitor='val_loss')
  - Learning rate scheduler: ReduceLROnPlateau(factor=0.5, patience=5)
  - Data augmentation during training:
    - Gaussian noise injection (std=0.05)
    - Feature scaling jitter (0.9-1.1x random per feature)
    - Random feature dropout (mask 1 feature with 0, 10% probability)
  - Save best model checkpoint

Evaluation:
  - Print classification report (precision, recall, F1 per class)
  - Plot confusion matrix
  - Plot ROC curves per class
  - Target: >80% accuracy on test set, >75% F1 on each class

---

TASK 4: ROM PROGRESS TRACKER (rom_tracker.py)

Regression model predicting recovery percentage (0-100).

Input features (7):
  - current_rom: ROM from current session (degrees)
  - baseline_rom: patient's initial ROM at start of rehab (degrees)
  - rom_delta: current_rom - baseline_rom
  - current_jerk: jerk from current session
  - baseline_jerk: jerk from first session
  - session_number: which session this is (1, 2, 3...)
  - days_since_start: calendar days since first session

Output: recovery_percentage (0-100)
  - 0 = no improvement from baseline
  - 100 = full recovery (ROM at healthy target)

Model:
  def build_rom_tracker():
      model = tf.keras.Sequential([
          tf.keras.layers.Dense(64, activation='relu', input_shape=(7,)),
          tf.keras.layers.Dropout(0.2),
          tf.keras.layers.Dense(32, activation='relu'),
          tf.keras.layers.Dropout(0.2),
          tf.keras.layers.Dense(1, activation='sigmoid')  # output * 100
      ])
      model.compile(
          optimizer='adam',
          loss='mse',
          metrics=['mae']
      )
      return model

Generate synthetic ROM tracking data:
  - Simulate 500 patients, each with 10-30 sessions over 30-90 days
  - Recovery curves: logarithmic improvement with noise
  - Some patients plateau early, some have regressions
  - Include fast recoverers and slow recoverers
  - Target MAE < 8% on test set

---

TASK 5: TFLITE CONVERSION (convert_tflite.py)

def convert_to_tflite(model, output_path, quantize=True):
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    if quantize:
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]
    tflite_model = converter.convert()
    
    with open(output_path, 'wb') as f:
        f.write(tflite_model)
    
    print(f"Model saved: {output_path} ({len(tflite_model)/1024:.1f} KB)")
    return tflite_model

def validate_tflite(keras_model, tflite_path, test_data, tolerance=0.01):
    """Verify TFLite outputs match Keras outputs within tolerance."""
    interpreter = tf.lite.Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    mismatches = 0
    for i in range(min(100, len(test_data))):
        # Keras prediction
        keras_out = keras_model.predict(test_data[i:i+1], verbose=0)
        # TFLite prediction
        interpreter.set_tensor(input_details[0]['index'], 
                              test_data[i:i+1].astype(np.float32))
        interpreter.invoke()
        tflite_out = interpreter.get_tensor(output_details[0]['index'])
        
        if not np.allclose(keras_out, tflite_out, atol=tolerance):
            mismatches += 1
    
    print(f"Validation: {mismatches}/{min(100, len(test_data))} mismatches")

Convert both models:
  - movement_classifier.tflite (target: <200KB)
  - rom_tracker.tflite (target: <50KB)
  - Use float16 quantization
  - Validate both against Keras originals

---

TASK 6: TRAINING SCRIPT (train.py)

Main entry point that orchestrates everything:
  1. Generate synthetic data (if not already exists)
  2. Load and preprocess data
  3. Train movement classifier
  4. Evaluate movement classifier
  5. Train ROM tracker
  6. Evaluate ROM tracker
  7. Convert both to TFLite
  8. Validate TFLite models
  9. Print summary report
  10. Copy .tflite files to ../kinesis-app/app/src/main/assets/

Usage: python src/train.py --generate-data --epochs 100 --batch-size 64
```

---

## 5. Companion Android App

### 5.1 Development Environment Setup

```bash
# Install Android Studio (latest stable)
# SDK: API 34 (Android 14)
# Min SDK: API 26 (Android 8.0)
# Create new project: "KINESIS" with Jetpack Compose + Material 3
# Add to app/build.gradle.kts:
#   implementation("org.tensorflow:tensorflow-lite:2.14.0")
#   implementation("org.tensorflow:tensorflow-lite-support:0.4.4")
#   implementation("com.patrykandpatrick.vico:compose:1.13.1")  // Charts
#   implementation("androidx.room:room-runtime:2.6.1")
#   implementation("androidx.room:room-ktx:2.6.1")
#   kapt("androidx.room:room-compiler:2.6.1")
```

### 5.2 Claude Code Prompt for Android App

Copy and paste the following into Claude Code:

```
Build the complete Android companion app for the KINESIS wearable
rehabilitation monitoring system. The app connects to an ESP32 via BLE,
receives real-time IMU sensor data, runs TFLite AI models for movement
quality classification and ROM tracking, and displays rehabilitation
analytics with charts, scores, and exportable PDF reports.

TECH STACK:
  - Language: Kotlin
  - UI: Jetpack Compose with Material 3
  - BLE: Android BLE API (BluetoothLeScanner, BluetoothGatt)
  - AI: TensorFlow Lite Android
  - Charts: Vico (compose charting library)
  - Database: Room (local session storage)
  - PDF: Android Canvas-based PDF generation
  - Architecture: MVVM with clean architecture layers
  - Concurrency: Kotlin Coroutines + Flow
  - DI: Manual (no Hilt/Dagger for simplicity)
  - Min SDK: 26, Target SDK: 34

PROJECT STRUCTURE:
app/src/main/java/com/kinesis/app/
  KinesisApp.kt                        // Application class
  MainActivity.kt                      // Single activity, Compose host
  
  data/
    ble/
      BleManager.kt                    // Scan, connect, disconnect, auto-reconnect
      KinesisGattCallback.kt           // GATT callback handling notifications
      SensorPacket.kt                  // Parse 68-byte BLE packet into data class
      BleConnectionState.kt            // Sealed class: Disconnected, Connecting, Connected, Error
    
    db/
      KinesisDatabase.kt               // Room database definition
      dao/
        SessionDao.kt                  // CRUD for sessions
        ReadingDao.kt                  // CRUD for sensor readings within session
      entity/
        SessionEntity.kt               // id, startTime, endTime, avgQualityScore, avgRom, totalReps, exerciseType
        ReadingEntity.kt               // id, sessionId, timestamp, rom, jerk, qualityScore, classification, confidence
    
    repository/
      SessionRepository.kt             // Abstracts DB access
      BleRepository.kt                 // Abstracts BLE access, exposes Flow<SensorPacket>
  
  domain/
    model/
      SensorReading.kt                 // Domain model for a single sensor reading
      SessionSummary.kt                // Domain model for session overview
      MovementClass.kt                 // Enum: NORMAL, COMPENSATORY, GUARDED, ABNORMAL
      ClassificationResult.kt          // {movementClass, confidence, allProbabilities}
      RecoveryMetrics.kt               // {recoveryPercentage, romTrend, jerkTrend}
      FeatureVector.kt                 // The 12 features extracted from sensor window
    
    usecase/
      ConnectDeviceUseCase.kt
      StartSessionUseCase.kt
      StopSessionUseCase.kt
      ProcessSensorWindowUseCase.kt    // Feature extraction + inference
      GetSessionHistoryUseCase.kt
      GenerateReportUseCase.kt
      ExportPdfUseCase.kt
  
  ml/
    FeatureEngine.kt                   // Sliding window, feature computation
    MovementClassifier.kt              // TFLite model wrapper
    RomTracker.kt                      // TFLite model wrapper
    ModelManager.kt                    // Load/unload models, lifecycle
  
  ui/
    theme/
      Theme.kt                         // Material 3 theme (medical blues)
      Color.kt                         // Color palette
      Type.kt                          // Typography
    
    navigation/
      NavGraph.kt                      // 4 screens: Home, Session, History, Report
      Screen.kt                        // Sealed class for routes
    
    screens/
      home/
        HomeScreen.kt
        HomeViewModel.kt
      session/
        SessionScreen.kt
        SessionViewModel.kt
      history/
        HistoryScreen.kt
        HistoryViewModel.kt
      report/
        ReportScreen.kt
        ReportViewModel.kt
    
    components/
      DeviceCard.kt                    // BLE device in scan list
      QualityGauge.kt                  // Circular gauge 0-100
      RomDisplay.kt                    // ROM degrees with trend arrow
      ClassificationChip.kt            // "Normal 87%" colored chip
      AlertBanner.kt                   // Green/yellow/red top banner
      LiveChart.kt                     // Real-time scrolling line chart
      SessionCard.kt                   // Session summary in history list
      MetricRow.kt                     // Label + value + unit row

app/src/main/assets/
  movement_classifier.tflite           // Copied from ML pipeline
  rom_tracker.tflite                   // Copied from ML pipeline

---

SCREEN SPECIFICATIONS:

1. HOME SCREEN (HomeScreen.kt + HomeViewModel.kt)

State:
  - bleState: BleConnectionState (Disconnected, Scanning, Connecting, Connected)
  - discoveredDevices: List<BleDevice> (name, address, rssi)
  - lastSession: SessionSummary? (most recent session card)
  - permissionsGranted: Boolean

UI Layout:
  - Top: App bar with "KINESIS" title and settings icon
  - If permissions not granted: show permission request card
  - "Scan for Devices" button -> starts BLE scan
  - List of discovered devices (filter to "KINESIS-*" names):
    - Each card shows: device name, MAC address, RSSI bar
    - Tap -> connect
  - Connection status indicator (animated dots when connecting)
  - Once connected: "Start Session" large button with exercise type selector
    - Exercise types: "Shoulder Abduction", "Elbow Flexion", "Sit-to-Stand", "Custom"
  - Bottom card: last session summary if available
    - Date, duration, avg quality, ROM, trend arrow

ViewModel logic:
  - Request BLE + location permissions on launch
  - Scan for 10 seconds, update device list via Flow
  - On device tap: connect via BleManager
  - Observe connection state, update UI
  - On "Start Session": navigate to SessionScreen with exercise type

2. SESSION SCREEN (SessionScreen.kt + SessionViewModel.kt)

This is the main screen during a rehabilitation session. It must be
responsive and smooth despite continuous data updates.

State:
  - isSessionActive: Boolean
  - elapsedTime: Duration
  - currentRom: Float (degrees)
  - currentJerk: Float
  - qualityScore: Int (0-100)
  - repCount: Int
  - classification: ClassificationResult
  - romHistory: List<Float> (last 60 seconds for chart)
  - velocityHistory: List<Float>
  - alerts: List<String>
  - bleConnected: Boolean
  - activityTransition: String? ("Sit-to-Stand" / "Stand-to-Sit" / null)

UI Layout (scrollable column):
  - Top bar: timer (MM:SS), BLE status dot (green/red), Stop button
  
  - ALERT BANNER (full width):
    - Green: "Movement quality: Good"
    - Yellow: "Compensatory pattern detected"
    - Red: "Abnormal movement - check form"
    - Updates every inference cycle (1.25s)
  
  - LIVE METRICS ROW (horizontal, 3 cards):
    - Card 1: QualityGauge (circular, large, 0-100)
    - Card 2: RomDisplay (big number "87°", small trend arrow up/down, "vs baseline: 72°")
    - Card 3: Rep counter (big number, exercise name below)
  
  - CLASSIFICATION CHIP ROW:
    - 4 chips: Normal, Compensatory, Guarded, Abnormal
    - Active one is highlighted with confidence %, others are dimmed
    - e.g., [Normal 87%] [Comp 8%] [Guard 4%] [Abnorm 1%]
  
  - LIVE CHARTS (tabs: ROM / Velocity / Acceleration):
    - ROM chart: scrolling line chart, last 60 seconds, Y axis in degrees
    - Velocity chart: angular velocity over time
    - Acceleration chart: accel magnitude both sensors overlaid
    - Update at 20fps, smooth scrolling
  
  - ACTIVITY EVENTS:
    - If sit-to-stand detected: show animated card "Sit-to-Stand detected at MM:SS"
  
  - DETAILS SECTION (collapsible):
    - Jerk value with "Smoothness: Good/Fair/Poor" label
    - Acceleration asymmetry percentage
    - Angular velocity variability
  
  - Bottom: "Stop Session" button (with confirmation dialog)

ViewModel logic:
  - Collect Flow<SensorPacket> from BleRepository
  - Feed each packet into FeatureEngine
  - When FeatureEngine produces a new feature vector (every 1.25s):
    - Run MovementClassifier inference -> ClassificationResult
    - Run RomTracker inference -> RecoveryMetrics
    - Update all UI state
  - Save each reading to Room DB
  - On stop: compute session summary, save to DB, navigate to ReportScreen
  - Handle BLE disconnection: show warning, buffer data, auto-reconnect
  - Timer runs on coroutine, updates every second

3. HISTORY SCREEN (HistoryScreen.kt + HistoryViewModel.kt)

State:
  - sessions: List<SessionSummary> (sorted by date, newest first)
  - overallRomTrend: List<Pair<Date, Float>> (for trend chart)

UI Layout:
  - Top: "Session History" title
  - RECOVERY TREND CHART (top section):
    - Line chart: average ROM per session over time (X = date, Y = degrees)
    - Shows improvement trajectory
  - SESSION LIST:
    - Each SessionCard shows:
      - Date and time
      - Duration
      - Avg quality score (with colored dot: green/yellow/red)
      - Avg ROM (degrees)
      - Rep count
      - Mini sparkline of ROM during that session
    - Tap -> navigate to ReportScreen for that session

4. REPORT SCREEN (ReportScreen.kt + ReportViewModel.kt)

State:
  - session: SessionSummary (full detail)
  - readings: List<ReadingEntity> (all readings in session)
  - romChart: chart data
  - qualityChart: chart data
  - classificationBreakdown: Map<MovementClass, Int> (counts)
  - aiSummary: String (generated text)

UI Layout:
  - Session header: date, duration, exercise type
  - SUMMARY METRICS ROW: avg quality, avg ROM, total reps, peak ROM
  - ROM OVER TIME chart (full width, detailed)
  - QUALITY SCORE OVER TIME chart
  - CLASSIFICATION BREAKDOWN:
    - Horizontal bar chart or pie chart
    - "Normal: 72%, Compensatory: 18%, Guarded: 8%, Abnormal: 2%"
  - AI SUMMARY TEXT:
    - Generated from metrics, e.g.:
      "Session completed in 12 minutes with 24 repetitions. Average ROM
       of 87° represents a 12% improvement from baseline (72°). Movement
       quality scored 78/100. Compensatory patterns were detected in 18%
       of repetitions, primarily during the latter half of the session,
       suggesting fatigue-related compensation. Jerk decreased 15% from
       the previous session, indicating improved movement smoothness."
    - Generate this text programmatically from the metrics (template-based)
  - ACTION BUTTONS:
    - "Export PDF" -> generate PDF, save to Downloads, show share sheet
    - "Share with Clinician" -> same PDF via share intent

AI SUMMARY GENERATION (template-based, in GenerateReportUseCase):
  Build the summary string from these templates:
  - Opening: "Session completed in {duration} with {reps} repetitions."
  - ROM: "Average ROM of {rom}° represents a {delta}% {improvement/decline} from baseline ({baseline}°)."
  - Quality: "Movement quality scored {score}/100."
  - Classification: If compensatory > 15%: "Compensatory patterns were detected in {pct}% of repetitions{fatigue_note}."
  - Jerk: "Movement smoothness {improved/declined} {pct}% from the previous session."
  - If abnormal > 5%: "ALERT: Abnormal movement patterns detected in {pct}% of repetitions. Clinical review recommended."

---

BLE IMPLEMENTATION DETAILS:

BleManager.kt:
  - Uses BluetoothLeScanner for device discovery
  - Filter scan by device name prefix "KINESIS"
  - Connect with TRANSPORT_LE and autoConnect=false
  - On connected: discover services, find the notify characteristic
  - Enable notifications via BLE2902 descriptor
  - Parse incoming 68-byte packets into SensorPacket data class
  - Expose: connectionState (StateFlow), sensorData (SharedFlow)
  - Auto-reconnect on disconnect (3 attempts, 2s delay)
  - Handle all BLE edge cases: bond issues, MTU negotiation (request 72+)

SensorPacket.kt:
  data class SensorPacket(
      val timestampMs: Long,
      val q1: Quaternion,        // upper arm
      val q2: Quaternion,        // forearm
      val accel1: Vector3,       // upper arm acceleration
      val accel2: Vector3,       // forearm acceleration
      val romDegrees: Float,     // pre-computed on ESP32
      val jerkValue: Float       // pre-computed on ESP32
  )
  
  fun parsePacket(bytes: ByteArray): SensorPacket {
      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      // Parse all fields from the 68-byte packet
  }

---

ML INTEGRATION:

FeatureEngine.kt:
  - Mirrors the Python feature_engine.py exactly
  - Circular buffer of 250 SensorPackets
  - Every 125 new packets: compute 12-feature vector
  - Return FeatureVector data class

MovementClassifier.kt:
  class MovementClassifier(context: Context) {
      private val interpreter: Interpreter
      
      init {
          val model = loadModelFile(context, "movement_classifier.tflite")
          interpreter = Interpreter(model)
      }
      
      fun classify(features: FeatureVector): ClassificationResult {
          val input = features.toFloatArray()  // shape: [1, 12]
          val output = Array(1) { FloatArray(4) }
          interpreter.run(arrayOf(input), output)
          // output[0] = [p_normal, p_compensatory, p_guarded, p_abnormal]
          val probs = output[0]
          val maxIdx = probs.indices.maxBy { probs[it] }
          return ClassificationResult(
              movementClass = MovementClass.values()[maxIdx],
              confidence = probs[maxIdx],
              allProbabilities = probs.toList()
          )
      }
  }

RomTracker.kt:
  - Similar wrapper for rom_tracker.tflite
  - Input: [current_rom, baseline_rom, rom_delta, current_jerk, baseline_jerk, session_number, days_since_start]
  - Output: recovery_percentage (0-100)
  - Baseline values stored in SharedPreferences per patient

---

PDF GENERATION (ExportPdfUseCase.kt):
  - Use android.graphics.pdf.PdfDocument
  - A4 page (595 x 842 points)
  - Page 1:
    - Header: "KINESIS Rehabilitation Session Report"
    - Patient info section (date, duration, exercise)
    - Summary metrics table
    - AI-generated text summary
  - Page 2 (if needed):
    - ROM chart (render chart to Bitmap, draw to PDF canvas)
    - Quality score chart
    - Classification breakdown
    - Footer: "Generated by KINESIS v1.0"
  - Save to Downloads/KINESIS/
  - Return URI for sharing

---

DESIGN SPECIFICATIONS:
  
  Color Palette:
    - Primary: #1B3A5C (deep navy)
    - Secondary: #2E75B6 (medical blue)
    - Surface: #F8FAFC (near-white)
    - Quality Green: #22C55E
    - Quality Yellow: #EAB308
    - Quality Red: #EF4444
    - Text Primary: #1E293B
    - Text Secondary: #64748B
  
  Typography:
    - Headlines: 600 weight
    - Body: 400 weight
    - Metrics (big numbers): 700 weight, 32-48sp
    - Min text size: 14sp
  
  The app should feel medical/clinical but modern.
  Large, readable metrics suitable for tablet use.
  Dark theme option available.

---

CRITICAL IMPLEMENTATION NOTES:
  - All BLE operations on IO dispatcher (Dispatchers.IO)
  - All ML inference on Default dispatcher (Dispatchers.Default)
  - UI updates collected on Main dispatcher
  - Charts throttled to 20fps max
  - Metric text updates throttled to 1fps
  - Room DB writes batched (every 10 readings)
  - Handle configuration changes (rotation) gracefully
  - Handle app backgrounding during session (foreground service with notification)
  - Request all permissions at launch: BLUETOOTH_SCAN, BLUETOOTH_CONNECT, 
    ACCESS_FINE_LOCATION (for BLE on older APIs), POST_NOTIFICATIONS
  - Graceful degradation if TFLite models fail to load (show raw data only)
  - Session auto-saves every 30 seconds in case of crash
```

---

## 6. Task Assignment

| Team Member | Role | Primary Track | Responsibilities |
|-------------|------|---------------|------------------|
| Mohammed Alhnidi | Project Lead | System Integration | Firmware architecture, BLE protocol design, system integration, overall coordination, demo presentation |
| Obada Walid Mohammad | AI/ML Lead | AI Model Pipeline | Synthetic data generation, model training, TFLite conversion, model validation, feature engine design |
| Yazan Maamoon Kassab | App Developer | Android App | Android app development, BLE integration, Compose UI, charts, PDF generation, Room DB |
| Firas Al Eter | Hardware Lead | Hardware Build | Physical assembly, wiring, sensor calibration, enclosure design, battery integration, OLED display firmware |

### Shared Responsibilities

- **Code review:** Everyone reviews PRs in their non-primary tracks
- **Testing:** Everyone participates in end-to-end integration testing
- **Demo rehearsal:** Everyone practices the presentation
- **Documentation:** Each person documents their track

### Communication

- **Daily standup:** 15 min check-in (WhatsApp group or in-person)
- **Weekly integration test:** Every Friday, connect all components end-to-end
- **Git:** Single monorepo with folders: `/firmware`, `/ml`, `/app`, `/docs`, `/hardware`
- **Branch strategy:** `main` (stable) + feature branches (`feature/ble-service`, `feature/classifier`, etc.)

---

## 7. Build Timeline

### Week 1-2: Foundation

| Who | Task | Deliverable |
|-----|------|-------------|
| Firas | Order additional components (MPU6050 x2, TP4056, battery, straps) | Parts ordered |
| Firas | Assemble MYOSA stack, wire extra MPU6050, verify I2C addresses | Working hardware with all sensors detected |
| Mohammed | Set up Arduino IDE, ESP32 board support, create firmware project skeleton | Firmware compiles and uploads, Serial output works |
| Mohammed | Implement IMU reading (both MPU6050s) + Madgwick filter | Quaternion output on Serial monitor |
| Obada | Set up Python ML environment, create project structure | Environment ready, synthetic data generator started |
| Obada | Complete synthetic data generation (40,000 samples) | train.csv, val.csv, test.csv generated |
| Yazan | Set up Android Studio project, create Compose scaffold | App compiles, 4-screen navigation works |
| Yazan | Implement BleManager (scan, connect, disconnect) | Can discover and connect to ESP32 |

### Week 3-4: Core Functionality

| Who | Task | Deliverable |
|-----|------|-------------|
| Firas | Battery integration, test portable operation | System runs untethered for 3+ hours |
| Firas | OLED display code (ROM, score, BLE status) | Real-time display working |
| Mohammed | BLE GATT service (68-byte packet streaming at 20Hz) | Phone receives sensor data |
| Mohammed | Feature engine on ESP32 (ROM, jerk, quality score) | Features computed and displayed on OLED |
| Mohammed | APDS9960 proximity session trigger + gesture handling | Gesture controls working |
| Mohammed | BMP180 altitude tracking + sit-to-stand detection | Activity transitions detected |
| Obada | Train movement classifier (1D CNN) | >80% accuracy on test set |
| Obada | Train ROM tracker (MLP) | MAE <8% on test set |
| Yazan | Session screen with live charts (ROM, velocity) | Charts scroll with simulated data |
| Yazan | BLE data reception and parsing (SensorPacket) | Real data flowing into charts |

### Week 5-6: AI Integration and Polish

| Who | Task | Deliverable |
|-----|------|-------------|
| Firas | Enclosure design (3D print or foam), final mounting solution | Wearable, comfortable nodes |
| Firas | Sensor calibration protocol (document steps) | Calibration guide written |
| Mohammed | End-to-end integration: firmware + app + models | Full pipeline working |
| Mohammed | Debug BLE reliability (reconnection, data loss) | Stable connection for 30+ minutes |
| Obada | Convert models to TFLite, validate accuracy | .tflite files <200KB and <50KB |
| Obada | Integrate TFLite models into Android app (with Yazan) | Classification + ROM tracking working in app |
| Yazan | QualityGauge, RomDisplay, ClassificationChip components | Full session screen UI complete |
| Yazan | History screen with session list and trend chart | Past sessions viewable |
| Yazan | Report screen with AI summary text generation | Template-based text summaries working |

### Week 7-8: Integration Testing and Real Data

| Who | Task | Deliverable |
|-----|------|-------------|
| ALL | Collect real movement data from team members | 50+ sessions of real sensor data |
| Obada | Retrain models on real data (mixed with synthetic) | Models updated, accuracy validated |
| Obada | Update TFLite files in app | Final models deployed |
| Yazan | PDF report generation and export | PDF downloadable and shareable |
| Mohammed | Full system stress testing (30+ minute sessions) | System stable under sustained use |
| Firas | Final hardware inspection, cable management, appearance | Demo-ready hardware |
| ALL | Bug fixes and edge case handling | Stable system |

### Week 9-10: Demo Preparation

| Who | Task | Deliverable |
|-----|------|-------------|
| Mohammed | Write and rehearse demo script (3-5 minutes) | Script finalized |
| ALL | Record 5-minute presentation video | Video submitted |
| ALL | Record 3-minute demonstration video | Video submitted |
| Mohammed | Prepare backup plan (pre-recorded fallback if BLE fails at venue) | Backup video ready |
| Firas | Pack hardware for shipping/travel | Hardware travel-ready |
| ALL | Final dress rehearsal of live demo | Ready for conference |

---

## 8. Demo Preparation

### 8.1 Demo Script (3-5 minutes)

**Introduction (30 seconds):**
"Good morning. We are the KINESIS team from Khalifa University. KINESIS stands for Kinetic Intelligence for Neuromusculoskeletal Evaluation, Synthesis, and Insight Systems. We built an AI-driven wearable rehabilitation monitoring system using the MYOSA kit."

**Problem (30 seconds):**
"1.71 billion people globally suffer from musculoskeletal disorders. Rehabilitation monitoring today relies on subjective, periodic clinical assessments. Between appointments, critical regressions go undetected. We built KINESIS to fix this."

**Live Demo (2-3 minutes):**
1. Show the MYOSA sensor nodes (audience sees the hardware)
2. Volunteer (team member) straps on two nodes (upper arm + forearm)
3. Open the KINESIS app, scan, connect to "KINESIS-NODE"
4. Start a session (exercise: "Elbow Flexion")
5. Perform 5-6 elbow flexion/extension movements
   - Point out: OLED showing ROM and score in real-time
   - Point out: phone app showing live charts and classification
   - "You can see the AI classifies this as Normal with 91% confidence"
6. Deliberately perform a compensatory movement (shrug shoulder while flexing)
   - "Watch the alert change to yellow - compensatory pattern detected"
7. Perform a sit-to-stand transition
   - "The barometric sensor detected the sit-to-stand transition"
8. Stop the session
9. Show the generated report with AI summary text
10. Show the PDF export

**Roadmap (30 seconds):**
"What you see today is Phase 1. Phase 2 upgrades to clinical-grade sensors and a Raspberry Pi with a dedicated AI chip for on-device deep learning. Phase 3 delivers custom PCBs and hospital EHR integration for clinical deployment."

**Close (15 seconds):**
"KINESIS transforms the MYOSA kit from an educational platform into a clinically meaningful rehabilitation monitoring system. Thank you."

### 8.2 Backup Plan

If BLE fails at the venue (interference, etc.):
- Pre-record a high-quality video of the full demo working in the lab
- Have it ready on the phone to play immediately
- Still show the hardware physically while narrating over the video

### 8.3 What to Bring to the Conference

- MYOSA sensor nodes (2 sets as backup)
- Extra batteries (charged)
- USB-C cable for emergency charging
- Android phone with KINESIS app installed (2 phones as backup)
- Velcro straps (extra set)
- Laptop with presentation slides and backup demo video
- Poster (if required by the event)
- Business cards (optional but professional)

---

## Appendix A: BLE Packet Format Reference

```
Offset  Size  Type      Field
------  ----  --------  ---------------------------
0       4     uint32    timestamp_ms
4       4     float32   q1_w (upper arm quaternion w)
8       4     float32   q1_x
12      4     float32   q1_y
16      4     float32   q1_z
20      4     float32   q2_w (forearm quaternion w)
24      4     float32   q2_x
28      4     float32   q2_y
32      4     float32   q2_z
36      4     float32   ax1 (upper arm accel x, g)
40      4     float32   ay1
44      4     float32   az1
48      4     float32   ax2 (forearm accel x, g)
52      4     float32   ay2
56      4     float32   az2
60      4     float32   rom_degrees
64      4     float32   jerk_value
------  ----  --------  ---------------------------
Total: 68 bytes, little-endian
```

## Appendix B: Feature Vector Reference

| Index | Feature | Unit | Description |
|-------|---------|------|-------------|
| 0 | rom_degrees | degrees | Max - min joint angle in window |
| 1 | avg_angular_velocity | deg/s | Mean absolute angular velocity |
| 2 | peak_angular_velocity | deg/s | Max absolute angular velocity |
| 3 | rms_jerk | deg/s^2 | RMS of angular acceleration (smoothness) |
| 4 | peak_accel_1 | g | Peak accel magnitude, sensor 1 |
| 5 | peak_accel_2 | g | Peak accel magnitude, sensor 2 |
| 6 | accel_asymmetry | ratio | Asymmetry between sensors (0-1) |
| 7 | rom_variability | degrees | Std dev of per-rep ROM |
| 8 | velocity_variability | ratio | CV of angular velocity |
| 9 | rep_count | count | Repetitions in window |
| 10 | rep_regularity | seconds | Std dev of inter-rep timing |
| 11 | altitude_delta | meters | Barometric altitude change |

## Appendix C: I2C Address Quick Reference

| Address | Device | Notes |
|---------|--------|-------|
| 0x3C | SSD1306 OLED | Fixed |
| 0x39 | APDS9960 | Fixed |
| 0x68 | MPU6050 #1 | AD0 = LOW |
| 0x69 | MPU6050 #2 | AD0 = HIGH |
| 0x77 | BMP180 | Fixed |
| 0x70 | TCA9548A | Optional multiplexer |

---

*Last updated: April 2026*
*KINESIS Team, Khalifa University*
