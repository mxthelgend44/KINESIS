'use client';

import { KINESIS_THEME as T } from './theme';

type Props = {
  title: string;
  message: string;
  /** If provided, shows a "Try again" button that calls this. */
  onRetry?: () => void;
  /** If provided, shows a secondary button. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** When true, renders dark on a dark background (for the patient session screen). */
  dark?: boolean;
};

export function ErrorState({ title, message, onRetry, secondaryLabel, onSecondary, dark = false }: Props) {
  const bg = dark ? T.night : T.bone;
  const card = dark ? T.nightCard : T.paper;
  const text = dark ? '#fff' : T.ink;
  const sub = dark ? 'rgba(255,255,255,0.6)' : T.inkMute;
  const border = dark ? 'rgba(255,255,255,0.08)' : T.hairline;

  return (
    <div
      style={{
        background: bg,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 380,
          width: '100%',
          background: card,
          border: `1px solid ${border}`,
          borderRadius: 18,
          padding: '28px 24px',
          textAlign: 'center',
        }}
      >
        <div
          className="k-eyebrow"
          style={{ color: T.coral, marginBottom: 12 }}
        >
          Something went wrong
        </div>
        <div
          className="k-serif"
          style={{ fontSize: 22, color: text, marginBottom: 8, letterSpacing: '-0.01em', lineHeight: 1.25 }}
        >
          {title}
        </div>
        <p style={{ fontSize: 13, color: sub, lineHeight: 1.5, marginBottom: 20 }}>{message}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                background: T.teal,
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          )}
          {onSecondary && secondaryLabel && (
            <button
              type="button"
              onClick={onSecondary}
              style={{
                background: 'transparent',
                color: dark ? 'rgba(255,255,255,0.6)' : T.inkMute,
                border: `1px solid ${border}`,
                borderRadius: 999,
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
