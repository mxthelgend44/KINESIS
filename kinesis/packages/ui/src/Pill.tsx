import type { CSSProperties, ReactNode } from 'react';
import { KINESIS_THEME as T } from './theme';

type Props = {
  children: ReactNode;
  color?: string;
  bg?: string;
  style?: CSSProperties;
};

export function Pill({ children, color = T.ink, bg = T.mist, style }: Props) {
  return (
    <span
      className="k-sans"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        color,
        background: bg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
