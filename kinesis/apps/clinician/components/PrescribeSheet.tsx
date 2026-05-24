'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@kinesis/ui';
import { useAuth, prettyFirestoreError, logRaw } from '@kinesis/db';
import {
  listExercises,
  createPrescription,
  deactivatePrescription,
  listPrescriptionsForPatient,
} from '@kinesis/db/queries/exercises';
import type { Exercise, Prescription } from '@kinesis/db';

const T = {
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  mist: '#F1EFE9',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  amber: '#D4824A',
  coral: '#C44545',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

type Props = {
  patientId: string;
  open: boolean;
  onClose: () => void;
};

export function PrescribeSheet({ patientId, open, onClose }: Props) {
  const auth = useAuth();
  const toast = useToast();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(15);
  const [freq, setFreq] = useState(5);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [ex, pr] = await Promise.all([
          listExercises(),
          listPrescriptionsForPatient(patientId),
        ]);
        setExercises(ex);
        setPrescriptions(pr);
      } catch (e) {
        logRaw('prescribe-list', e);
        toast.error(prettyFirestoreError(e).title);
      }
    })();
  }, [open, patientId, toast]);

  const activeIds = useMemo(() => new Set(prescriptions.map((p) => p.exerciseId)), [prescriptions]);

  const onPrescribe = async () => {
    if (!selectedId || auth.status !== 'authenticated') return;
    setBusy(true);
    try {
      await createPrescription({
        patientId,
        exerciseId: selectedId,
        prescribedBy: auth.user.uid,
        sets,
        reps,
        frequencyPerWeek: freq,
        notes: notes.trim() || null,
      });
      const pr = await listPrescriptionsForPatient(patientId);
      setPrescriptions(pr);
      const ex = exercises.find((e) => e.id === selectedId);
      toast.success(`Prescribed ${ex?.name ?? 'exercise'}`);
      setSelectedId(null);
      setNotes('');
    } catch (e) {
      logRaw('prescribe-create', e);
      toast.error(prettyFirestoreError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    try {
      await deactivatePrescription(id);
      const pr = await listPrescriptionsForPatient(patientId);
      setPrescriptions(pr);
      toast.success('Prescription removed');
    } catch (e) {
      logRaw('prescribe-remove', e);
      toast.error(prettyFirestoreError(e).title);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.paper,
          borderRadius: 18,
          maxWidth: 720,
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: 24,
          border: `1px solid ${T.hairline}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>PRESCRIBE</div>
            <div className="k-serif" style={{ fontSize: 22, color: T.ink, letterSpacing: '-0.01em' }}>
              Assign an exercise
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: T.inkMute,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        {/* Current prescriptions */}
        <div style={{ marginBottom: 18 }}>
          <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
            CURRENTLY PRESCRIBED · {prescriptions.length}
          </div>
          {prescriptions.length === 0 ? (
            <div className="text-sm" style={{ color: T.inkMute, padding: '8px 0' }}>
              No active prescriptions.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prescriptions.map((p) => {
                const ex = exercises.find((e) => e.id === p.exerciseId);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: T.tealLight,
                      border: `1px solid ${T.hairline}`,
                    }}
                  >
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: T.amber,
                        color: '#fff',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                      }}
                    >
                      RX
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>
                        {ex?.name ?? p.exerciseId}
                      </div>
                      <div className="k-mono" style={{ fontSize: 10, color: T.inkMute, marginTop: 1 }}>
                        {p.sets}×{p.reps} · {p.frequencyPerWeek}×/wk
                      </div>
                    </div>
                    <button
                      onClick={() => onRemove(p.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: T.coral,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Catalog */}
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
          EXERCISE CATALOG
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {exercises.map((ex) => {
            const active = selectedId === ex.id;
            const already = activeIds.has(ex.id);
            return (
              <button
                key={ex.id}
                onClick={() => setSelectedId(ex.id)}
                disabled={already}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: active ? `1.5px solid ${T.teal}` : `1px solid ${T.hairline}`,
                  background: active ? T.tealLight : already ? T.mist : T.paper,
                  cursor: already ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  opacity: already ? 0.5 : 1,
                }}
              >
                <div className="k-sans" style={{ fontSize: 12, color: T.ink, fontWeight: 600 }}>
                  {ex.name}
                </div>
                <div className="k-mono" style={{ fontSize: 9, color: T.inkMute, marginTop: 3, textTransform: 'uppercase' }}>
                  {ex.category} · {ex.difficulty}
                </div>
                {already && (
                  <div className="k-mono" style={{ fontSize: 9, color: T.amber, marginTop: 3, fontWeight: 700 }}>
                    PRESCRIBED
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Parameters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
          <NumField label="SETS" value={sets} onChange={setSets} min={1} max={10} />
          <NumField label="REPS / SET" value={reps} onChange={setReps} min={1} max={50} />
          <NumField label="× PER WEEK" value={freq} onChange={setFreq} min={1} max={7} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>
            NOTES (OPTIONAL)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. focus on slow eccentric, full range"
            rows={2}
            style={{
              width: '100%',
              border: `1px solid ${T.hairline}`,
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 16px',
              borderRadius: 999,
              border: `1px solid ${T.hairline}`,
              background: T.paper,
              color: T.ink,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onPrescribe}
            disabled={busy || !selectedId}
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              border: 'none',
              background: T.ink,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: busy || !selectedId ? 0.5 : 1,
            }}
          >
            {busy ? 'Prescribing…' : 'Prescribe'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        style={{
          width: '100%',
          border: `1px solid ${T.hairline}`,
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 14,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
    </div>
  );
}
