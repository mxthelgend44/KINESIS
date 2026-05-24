'use client';

import { useEffect, useRef, useState } from 'react';
import { useImu } from './useImu';
import { rawByteCounter } from './serial';

const T = {
  paper: 'rgba(22, 34, 48, 0.82)',
  hairline: 'rgba(255,255,255,0.10)',
  ink: '#fff',
  inkMute: 'rgba(255,255,255,0.55)',
  inkFaint: 'rgba(255,255,255,0.35)',
  teal: '#1A6B5A',
  sage: '#5BD6A0',
  amber: '#D4824A',
  coral: '#C44545',
};

type Props = {
  /** Joint key the IMU should be bound to (e.g. "right_knee"). */
  jointKey: string;
  /** Receives flexion angles in degrees on every update; also gets the
   *  connection state so the parent can route fusion logic. */
  onAngle?: (deg: number) => void;
  onStateChange?: (state: { connected: boolean; bound: boolean; rateHz: number }) => void;
  /** Layout: 'compact' for a small badge, 'card' for a full panel. */
  variant?: 'compact' | 'card';
  /** Which fusion filter to use. Default 'device' — uses the firmware's
   *  pre-fused quaternion when present, otherwise falls back to a
   *  browser-side complementary filter. */
  filter?: 'complementary' | 'madgwick' | 'device';
};

export function ImuPanel({ jointKey, onAngle, onStateChange, variant = 'card', filter = 'device' }: Props) {
  const imu = useImu({ filter });
  const [showRaw, setShowRaw] = useState(false);
  // Tick a per-second counter so we can show "X bytes received from
  // the port" alongside the frame rate — separates "device isn't
  // sending anything" from "device is sending but we can't parse it".
  const [bytes, setBytes] = useState(0);
  useEffect(() => {
    if (imu.status !== 'streaming') return;
    const id = setInterval(() => setBytes(rawByteCounter.count), 500);
    return () => clearInterval(id);
  }, [imu.status]);

  // Stash the callbacks in refs so their (almost-certainly-inline) identities
  // don't make the downstream effects re-fire. Inline arrow props are a new
  // reference every parent render, so depending on them caused the effects
  // below to call back into the parent every tick, which called setState in
  // the parent, which re-rendered, which produced new arrows — an infinite
  // loop ("Maximum update depth exceeded" in the console).
  const onAngleRef = useRef(onAngle);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onAngleRef.current = onAngle;
  }, [onAngle]);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    if (imu.jointAngleDeg !== null) onAngleRef.current?.(imu.jointAngleDeg);
  }, [imu.jointAngleDeg]);

  useEffect(() => {
    onStateChangeRef.current?.({
      connected: imu.status === 'streaming',
      bound: imu.boundJoint !== null,
      rateHz: imu.rateHz,
    });
  }, [imu.status, imu.boundJoint, imu.rateHz]);

  const statusColor =
    imu.status === 'streaming' ? T.sage
    : imu.status === 'error'    ? T.coral
    : imu.status === 'connecting' || imu.status === 'requesting' ? T.amber
    : T.inkFaint;

  if (variant === 'compact') {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 9px',
          borderRadius: 999,
          background: T.paper,
          color: T.ink,
          border: `1px solid ${T.hairline}`,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 3, background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
        IMU · {imu.status === 'streaming' ? `${imu.rateHz}Hz` : imu.status}
        {imu.boundJoint && imu.jointAngleDeg !== null && (
          <span style={{ color: T.sage, marginLeft: 4 }}>
            {Math.round(imu.jointAngleDeg)}°
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: T.paper,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${T.hairline}`,
        color: T.ink,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: T.inkMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            IMU sensor
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {imu.status === 'streaming'
              ? `Live · ${imu.rateHz}Hz`
              : imu.status === 'error'
                ? 'Error'
                : imu.status === 'connecting'
                  ? 'Connecting…'
                  : imu.status === 'requesting'
                    ? 'Pick a port…'
                    : imu.status === 'closed'
                      ? 'Disconnected'
                      : 'Not paired'}
          </div>
          {imu.status === 'streaming' && (
            <div style={{ fontSize: 10, color: imu.rateHz === 0 && bytes === 0 ? T.coral : T.inkMute, marginTop: 2 }}>
              {bytes === 0
                ? '⚠ Port open but no bytes — firmware not streaming. Check flash + IMU wiring.'
                : imu.rateHz === 0
                  ? `${bytes} B received — bytes flowing but no parseable frames. Check baud + format.`
                  : `${bytes} B · parsing OK`}
            </div>
          )}
        </div>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />
      </div>

      {!imu.supported && (
        <div style={{ fontSize: 11, color: T.amber, marginBottom: 10 }}>
          Web Serial isn't available in this browser. Use Chrome or Edge on desktop.
        </div>
      )}
      {imu.error && (
        <div style={{ fontSize: 11, color: T.coral, marginBottom: 10 }}>{imu.error}</div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {imu.status !== 'streaming' ? (
          <button
            type="button"
            onClick={imu.connect}
            disabled={!imu.supported}
            style={btnPrimary(imu.supported)}
          >
            Pair sensor
          </button>
        ) : (
          <button type="button" onClick={imu.disconnect} style={btnSecondary}>
            Disconnect
          </button>
        )}
        {imu.status === 'streaming' && (
          imu.boundJoint ? (
            <button type="button" onClick={imu.clearCalibration} style={btnSecondary}>
              Unbind
            </button>
          ) : (
            <button type="button" onClick={() => imu.calibrate(jointKey)} style={btnSecondary}>
              Calibrate ({jointKey.replace('_', ' ')})
            </button>
          )
        )}
        <button type="button" onClick={() => setShowRaw((v) => !v)} style={btnGhost}>
          {showRaw ? 'Hide raw' : 'Show raw'}
        </button>
      </div>

      {imu.boundJoint && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(91,214,160,0.08)',
            border: '1px solid rgba(91,214,160,0.25)',
            marginBottom: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 10, color: T.inkMute, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Bound to {imu.boundJoint.replace('_', ' ')}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: T.sage, lineHeight: 1.1 }}>
              {imu.jointAngleDeg !== null ? `${Math.round(imu.jointAngleDeg)}°` : '—'}
            </div>
          </div>
          <div style={{ fontSize: 10, color: T.inkMute, textAlign: 'right' }}>
            tilt {imu.orientation ? Math.round(imu.orientation.tiltDeg) : '—'}°
          </div>
        </div>
      )}

      {showRaw && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: T.inkMute, lineHeight: 1.5 }}>
          <div>quat: {imu.orientation ? formatQuat(imu.orientation.quat) : '—'}</div>
          <div>euler: {imu.orientation ? formatEuler(imu.orientation.euler) : '—'}</div>
          <div>accel: {imu.lastFrameRef.current ? formatXYZ(imu.lastFrameRef.current.ax, imu.lastFrameRef.current.ay, imu.lastFrameRef.current.az) : '—'} g</div>
          <div>gyro:  {imu.lastFrameRef.current ? formatXYZ(imu.lastFrameRef.current.gx, imu.lastFrameRef.current.gy, imu.lastFrameRef.current.gz) : '—'} °/s</div>
        </div>
      )}
    </div>
  );
}

function formatXYZ(x: number, y: number, z: number): string {
  return `${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
}
function formatQuat(q: { w: number; x: number; y: number; z: number }): string {
  return `${q.w.toFixed(3)}, ${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}`;
}
function formatEuler(e: { roll: number; pitch: number; yaw: number }): string {
  return `r ${e.roll.toFixed(1)}°, p ${e.pitch.toFixed(1)}°, y ${e.yaw.toFixed(1)}°`;
}

function btnPrimary(enabled: boolean): React.CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 999,
    border: 'none',
    background: enabled ? T.teal : 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.6,
  };
}
const btnSecondary: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  border: `1px solid ${T.hairline}`,
  background: 'transparent',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  border: 'none',
  background: 'transparent',
  color: T.inkMute,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};
