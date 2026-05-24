'use client';

import { KINESIS_THEME as T } from './theme';

type Props = {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sub?: string;
  dark?: boolean;
};

export function ProgressRing({
  value,
  size = 96,
  stroke = 7,
  color = T.teal,
  label,
  sub,
  dark = false,
}: Props) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  const off = C * (1 - v / 100);
  const trackColor = dark ? 'rgba(255,255,255,0.08)' : T.hairline;
  const textColor = dark ? '#fff' : T.ink;
  const labelColor = dark ? 'rgba(255,255,255,0.6)' : T.inkMute;
  const subColor = dark ? 'rgba(255,255,255,0.5)' : T.inkMute;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2, 0.7, 0.2, 1)' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="k-serif"
            style={{
              fontSize: size * 0.3,
              lineHeight: 1,
              color: textColor,
              letterSpacing: '-0.02em',
            }}
          >
            {Math.round(v)}
            <span style={{ fontSize: size * 0.14, color: labelColor }}>%</span>
          </div>
        </div>
      </div>
      {label && (
        <div className="k-eyebrow" style={{ color: labelColor }}>
          {label}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 11, color: subColor }}>{sub}</div>
      )}
    </div>
  );
}
