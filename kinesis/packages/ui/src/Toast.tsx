'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { KINESIS_THEME as T } from './theme';

export type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: ToastKind; message: string; duration: number };

type ToastApi = {
  push: (message: string, kind?: ToastKind, durationMs?: number) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = 'info', duration = 3200) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message, duration }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const api: ToastApi = {
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 'max(env(safe-area-inset-bottom), 90px)',
          left: 16,
          right: 16,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setClosing(true), toast.duration - 220);
    return () => clearTimeout(t);
  }, [toast.duration]);

  const bgMap: Record<ToastKind, string> = {
    success: T.sage,
    error: T.coral,
    info: T.ink,
  };

  return (
    <div
      style={{
        background: bgMap[toast.kind],
        color: '#fff',
        padding: '11px 16px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        maxWidth: 380,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        animation: `${closing ? 'k-toast-out' : 'k-toast-in'} 220ms ease both`,
        pointerEvents: 'auto',
      }}
    >
      {toast.message}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // No-op fallback if used outside provider — keeps callers safe.
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
    };
  }
  return ctx;
}
