// Shared types for the IMU pipeline.
//
// The transport (Serial / BLE) produces ImuFrame at the device's sample rate.
// A filter (complementary or Madgwick) converts that stream into Orientation,
// which can then be mapped to a joint flexion angle.

export type ImuFrame = {
  /** Wall-clock timestamp from the device, ms. May reset to 0 at boot. */
  tMs: number;
  /** Accelerometer x/y/z in *g* (1.0 = 9.81 m/s²). */
  ax: number;
  ay: number;
  az: number;
  /** Gyroscope x/y/z in degrees per second. */
  gx: number;
  gy: number;
  gz: number;
  /** Optional magnetometer triple in micro-tesla. Many cheap IMUs omit this. */
  mx?: number;
  my?: number;
  mz?: number;
  /** Optional die temperature in °C. */
  temperature?: number;
  /** Optional on-device fused orientation quaternion. Some firmware
   *  (e.g. the MYOSA ESP32 sketch running Madgwick at 100 Hz internally)
   *  emits its fused orientation alongside the raw readings. When
   *  present, callers can use a passthrough filter to skip re-fusion. */
  qw?: number;
  qx?: number;
  qy?: number;
  qz?: number;
};

export type Quaternion = {
  w: number;
  x: number;
  y: number;
  z: number;
};

export type Euler = {
  /** roll (about x), degrees */
  roll: number;
  /** pitch (about y), degrees */
  pitch: number;
  /** yaw (about z), degrees */
  yaw: number;
};

export type ImuOrientation = {
  quat: Quaternion;
  euler: Euler;
  /** Gravity-aligned tilt magnitude in degrees, useful for a single-axis joint. */
  tiltDeg: number;
};

export type ImuStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'streaming'
  | 'error'
  | 'closed';

export type ImuTransportEvent =
  | { kind: 'status'; status: ImuStatus; detail?: string }
  | { kind: 'frame'; frame: ImuFrame }
  | { kind: 'error'; message: string };

export type ImuTransport = {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (e: ImuTransportEvent) => void): () => void;
  /** True if the runtime supports this transport (e.g. Web Serial on Chrome). */
  isSupported(): boolean;
  /** Short label, e.g. "USB · COM4 @ 115200". */
  label(): string;
};
