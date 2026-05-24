'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ComplementaryFilter,
  DevicePassthroughFilter,
  MadgwickAHRS,
  type OrientationFilter,
} from './filter';
import { ImuJointMapper } from './mapping';
import { WebSerialImuTransport } from './serial';
import type { ImuFrame, ImuOrientation, ImuStatus, ImuTransport } from './types';

export type UseImuOptions = {
  /**
   * Which fusion filter to use:
   *   • `'complementary'` (default) — fuse accel+gyro in the browser.
   *   • `'madgwick'`                — gradient-descent fusion, more CPU.
   *   • `'device'`                  — trust the firmware's pre-fused
   *     quaternion when present, falling back to complementary otherwise.
   *     Use this when the Arduino sketch already runs Madgwick at full
   *     sample rate (e.g. the MYOSA ESP32 streaming `{"qw":..,"qx":..}`).
   */
  filter?: 'complementary' | 'madgwick' | 'device';
  /**
   * Transport override (for tests or non-USB transports). Defaults to a
   * fresh WebSerialImuTransport when the page first mounts.
   */
  transport?: ImuTransport;
  /** Baud rate when using the default Web Serial transport. */
  baudRate?: number;
};

export type UseImuReturn = {
  status: ImuStatus;
  supported: boolean;
  error: string | null;
  /** Hz at which frames are arriving from the device. */
  rateHz: number;
  /** Last raw frame seen. Updated on every frame; safe to read in animation loops. */
  lastFrameRef: React.MutableRefObject<ImuFrame | null>;
  /** Latest orientation. Snapshot for UI rendering. */
  orientation: ImuOrientation | null;
  /** Same as orientation but always-current (no re-render). */
  orientationRef: React.MutableRefObject<ImuOrientation | null>;
  mapper: ImuJointMapper;
  /** Snapshot of the bound joint (re-renders when binding changes). */
  boundJoint: string | null;
  jointAngleDeg: number | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  calibrate: (joint: string, opts?: { invert?: boolean; offsetDeg?: number }) => void;
  clearCalibration: () => void;
};

/**
 * React hook that wires up an IMU transport + fusion filter + joint mapper.
 * Designed so the caller only re-renders on coarse-grained state changes;
 * raw frames flow through refs to avoid render storms at 100Hz.
 */
export function useImu(opts: UseImuOptions = {}): UseImuReturn {
  const filterChoice = opts.filter ?? 'complementary';
  const transportRef = useRef<ImuTransport | null>(null);
  const filterRef = useRef<OrientationFilter | null>(null);
  const lastFrameRef = useRef<ImuFrame | null>(null);
  const orientationRef = useRef<ImuOrientation | null>(null);
  const mapperRef = useRef(new ImuJointMapper());

  const [status, setStatus] = useState<ImuStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<ImuOrientation | null>(null);
  const [rateHz, setRateHz] = useState(0);
  const [boundJoint, setBoundJoint] = useState<string | null>(null);
  const [jointAngleDeg, setJointAngleDeg] = useState<number | null>(null);

  // Lazy init the transport on first mount (client-only).
  if (!transportRef.current) {
    transportRef.current = opts.transport ?? new WebSerialImuTransport({ baudRate: opts.baudRate });
  }
  // Pick the right filter the first time, or when the caller swaps
  // `filter` to something incompatible with the cached instance.
  const needsRebuild = (() => {
    const cur = filterRef.current;
    if (!cur) return true;
    if (filterChoice === 'madgwick' && !(cur instanceof MadgwickAHRS)) return true;
    if (filterChoice === 'device' && !(cur instanceof DevicePassthroughFilter)) return true;
    if (filterChoice === 'complementary' && !(cur instanceof ComplementaryFilter)) return true;
    return false;
  })();
  if (needsRebuild) {
    filterRef.current =
      filterChoice === 'madgwick' ? new MadgwickAHRS() :
      filterChoice === 'device'   ? new DevicePassthroughFilter() :
      new ComplementaryFilter();
  }

  const supported = useMemo(() => transportRef.current?.isSupported() ?? false, []);

  // Subscribe to transport events once.
  useEffect(() => {
    const t = transportRef.current;
    if (!t) return;
    let framesInWindow = 0;
    let windowStart = performance.now();
    let raf = 0;
    let pendingOrientation: ImuOrientation | null = null;
    let pendingAngle: number | null = null;

    const tick = () => {
      if (pendingOrientation) {
        setOrientation(pendingOrientation);
        pendingOrientation = null;
      }
      if (pendingAngle !== null) {
        setJointAngleDeg(pendingAngle);
        pendingAngle = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const unsub = t.subscribe((e) => {
      if (e.kind === 'status') {
        setStatus(e.status);
        if (e.detail) setError(e.detail);
        if (e.status === 'streaming') setError(null);
      } else if (e.kind === 'error') {
        setError(e.message);
      } else if (e.kind === 'frame') {
        lastFrameRef.current = e.frame;
        const filt = filterRef.current!;
        const ori = filt.update(e.frame);
        orientationRef.current = ori;
        pendingOrientation = ori; // batched into requestAnimationFrame
        if (mapperRef.current.isBound()) {
          pendingAngle = mapperRef.current.computeFlexionDeg(ori.quat);
        } else {
          pendingAngle = null;
        }
        framesInWindow++;
        const dt = performance.now() - windowStart;
        if (dt >= 1000) {
          setRateHz(Math.round((framesInWindow * 1000) / dt));
          framesInWindow = 0;
          windowStart = performance.now();
        }
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      void t.stop();
    };
  }, []);

  const connect = useCallback(async () => {
    await transportRef.current?.start();
  }, []);

  const disconnect = useCallback(async () => {
    await transportRef.current?.stop();
  }, []);

  const calibrate = useCallback((joint: string, opts: { invert?: boolean; offsetDeg?: number } = {}) => {
    const ori = orientationRef.current;
    if (!ori) return;
    mapperRef.current.bind(joint, ori.quat, opts);
    setBoundJoint(joint);
  }, []);

  const clearCalibration = useCallback(() => {
    mapperRef.current.clear();
    setBoundJoint(null);
    setJointAngleDeg(null);
  }, []);

  return {
    status,
    supported,
    error,
    rateHz,
    lastFrameRef,
    orientation,
    orientationRef,
    mapper: mapperRef.current,
    boundJoint,
    jointAngleDeg,
    connect,
    disconnect,
    calibrate,
    clearCalibration,
  };
}
