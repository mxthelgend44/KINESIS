'use client';

import { useState } from 'react';
import { logPainCheckin } from '@kinesis/db/queries/pain';

export function PainCheckIn({ patientId, lastPainScore }: { patientId: string; lastPainScore?: number }) {
  const [selected, setSelected] = useState<number | null>(lastPainScore ?? null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(n: number) {
    setSelected(n);
    setSaving(true);
    try {
      await logPainCheckin(patientId, n);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, border: '1px solid #E5E1D8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div className="k-serif" style={{ fontSize: 17, color: '#0E1822' }}>How's the pain today?</div>
          <span className="k-mono" style={{ fontSize: 10, color: '#9AA3AC' }}>
            {saved ? 'SAVED' : saving ? 'SAVING…' : '0–10'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          {[0, 2, 4, 6, 8, 10].map((n) => {
            const isSel = selected === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pick(n)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 12,
                  border: isSel ? '1.5px solid #0E1822' : '1px solid #E5E1D8',
                  background: isSel ? '#0E1822' : '#FFFFFF',
                  color: isSel ? '#fff' : '#0E1822',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
