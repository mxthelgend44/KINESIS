'use client';

import type { CSSProperties } from 'react';
import { KINESIS_THEME as T } from './theme';

type Props = {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  /** When true, renders for a dark backdrop. */
  dark?: boolean;
};

/**
 * Pulsing rectangle placeholder. Use anywhere you used to show "LOADING…".
 * Compose a few of these to mirror the final layout's shape.
 */
export function Skeleton({ width = '100%', height = 14, radius = 6, className, style, dark }: Props) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius: radius,
        background: dark ? 'rgba(255,255,255,0.06)' : T.mist,
        animation: 'k-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

export function SkeletonText({ lines = 2, dark }: { lines?: number; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === lines - 1 ? '70%' : '100%'}
          dark={dark}
        />
      ))}
    </div>
  );
}
