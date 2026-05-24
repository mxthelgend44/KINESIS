'use client';

import { KINESIS_THEME } from './theme';

export function KinesisMark({
  size = 22,
  color = KINESIS_THEME.teal,
  stroke = 1.8,
}: {
  size?: number;
  color?: string;
  stroke?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 19 Q 12 4, 21 19" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <circle cx="3" cy="19" r="1.6" fill={color} />
      <circle cx="21" cy="19" r="1.6" fill={color} />
      <circle cx="12" cy="6.5" r="2.2" fill={color} />
    </svg>
  );
}

export function KinesisWordmark({
  color = KINESIS_THEME.ink,
  size = 14,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <KinesisMark size={size + 6} color={color === KINESIS_THEME.ink ? KINESIS_THEME.teal : color} />
      <span
        className="k-sans"
        style={{
          fontWeight: 700,
          fontSize: size,
          letterSpacing: '0.18em',
          color,
          textTransform: 'uppercase',
        }}
      >
        KINESIS
      </span>
    </div>
  );
}
