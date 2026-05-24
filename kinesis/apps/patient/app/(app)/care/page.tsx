'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@kinesis/ui';
import { useAuth, tsToDate } from '@kinesis/db';
import {
  subscribeMedicationsForPatient,
  logMedicationDose,
  listMedicationLogs,
} from '@kinesis/db/queries/medications';
import {
  subscribeAppointmentsForPatient,
  cancelAppointment,
} from '@kinesis/db/queries/appointments';
import type { Appointment, Medication, MedicationLog } from '@kinesis/db';

const T = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealDeep: '#114A3F',
  tealMint: '#D7E8E1',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  coral: '#C44545',
  sage: '#5C8A6E',
  sageLight: '#DDE7E0',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

type Tab = 'meds' | 'appts';

export default function CarePage() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('meds');
  const [meds, setMeds] = useState<Medication[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [logs, setLogs] = useState<MedicationLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const unsubM = subscribeMedicationsForPatient(auth.user.uid, setMeds);
    const unsubA = subscribeAppointmentsForPatient(auth.user.uid, setAppts);
    return () => {
      unsubM();
      unsubA();
    };
  }, [auth.status, auth.user]);

  const reloadLogs = useCallback(async () => {
    if (auth.status !== 'authenticated') return;
    try {
      const l = await listMedicationLogs(auth.user.uid);
      setLogs(l);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[care:logs]', e);
    }
  }, [auth.status, auth.user]);

  useEffect(() => {
    void reloadLogs();
  }, [reloadLogs, meds.length]);

  const onMarkTaken = async (m: Medication) => {
    if (auth.status !== 'authenticated' || busy) return;
    setBusy(m.id);
    try {
      await logMedicationDose({ medicationId: m.id, patientId: auth.user.uid });
      toast.success(`Marked ${m.name} as taken.`);
      await reloadLogs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not log dose.';
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const onCancelAppt = async (a: Appointment) => {
    if (busy) return;
    setBusy(a.id);
    try {
      await cancelAppointment(a.id);
      toast.success('Appointment cancelled.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not cancel.';
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ background: T.bone, minHeight: '100vh', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />

      <div style={{ padding: '18px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>Care plan</div>
          <div className="k-serif" style={{ fontSize: 30, lineHeight: 1.05, color: T.ink, letterSpacing: '-0.02em' }}>
            Meds &amp; appointments
          </div>
        </div>
        <Link
          href="/"
          style={{ color: T.inkMute, fontSize: 13, textDecoration: 'none', padding: '6px 10px', border: `1px solid ${T.hairline}`, borderRadius: 8, background: T.paper }}
        >
          ← Home
        </Link>
      </div>

      <div style={{ padding: '12px 24px 0', display: 'flex', gap: 8 }}>
        {(['meds', 'appts'] as Tab[]).map((id) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: active ? `1px solid ${T.teal}` : `1px solid ${T.hairline}`,
                background: active ? T.teal : T.paper,
                color: active ? '#fff' : T.ink,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {id === 'meds' ? `Medications · ${meds.filter((m) => m.active).length}` : `Appointments · ${appts.filter((a) => a.status === 'scheduled').length}`}
            </button>
          );
        })}
      </div>

      {tab === 'meds' ? (
        <MedicationsList meds={meds} logs={logs} onMarkTaken={onMarkTaken} busyId={busy} />
      ) : (
        <AppointmentsList appts={appts} onCancel={onCancelAppt} busyId={busy} />
      )}
    </div>
  );
}

function MedicationsList({
  meds,
  logs,
  onMarkTaken,
  busyId,
}: {
  meds: Medication[];
  logs: MedicationLog[];
  onMarkTaken: (m: Medication) => void;
  busyId: string | null;
}) {
  const active = meds.filter((m) => m.active);
  const inactive = meds.filter((m) => !m.active);

  const todayLogsByMed = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const map = new Map<string, number>();
    for (const l of logs) {
      const d = tsToDate(l.takenAt);
      if (!d) continue;
      if (d >= start) map.set(l.medicationId, (map.get(l.medicationId) ?? 0) + 1);
    }
    return map;
  }, [logs]);

  if (active.length === 0 && inactive.length === 0) {
    return (
      <div style={{ padding: '24px 24px 40px', textAlign: 'center', color: T.inkMute }}>
        <div className="k-serif" style={{ fontSize: 18, color: T.ink, marginBottom: 6 }}>
          No medications yet.
        </div>
        <div style={{ fontSize: 13 }}>
          When your clinician prescribes meds, you'll see them here with reminders.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 16px 0' }}>
      {active.map((m) => {
        const takenToday = todayLogsByMed.get(m.id) ?? 0;
        const expected = expectedDosesPerDay(m);
        const next = nextDoseTime(m, takenToday);
        return (
          <div
            key={m.id}
            style={{
              background: T.paper,
              borderRadius: 16,
              padding: '14px 16px',
              border: `1px solid ${T.hairline}`,
              marginBottom: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="k-serif" style={{ fontSize: 18, color: T.ink, lineHeight: 1.2 }}>
                  {m.name} <span style={{ color: T.inkMute, fontStyle: 'italic' }}>· {m.dose}</span>
                </div>
                <div className="k-sans" style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>
                  {frequencyLabel(m.frequency)} · {m.times.join(' · ')}
                </div>
                {m.notes && (
                  <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6, lineHeight: 1.4 }}>
                    {m.notes}
                  </div>
                )}
                <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 6 }}>
                  Today: {takenToday}/{expected} {next ? `· next ${next}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onMarkTaken(m)}
                disabled={busyId !== null}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: 'none',
                  background: takenToday >= expected ? T.sageLight : T.teal,
                  color: takenToday >= expected ? T.sage : '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busyId === m.id ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                  opacity: busyId === m.id ? 0.6 : 1,
                }}
              >
                {busyId === m.id ? 'Logging…' : takenToday >= expected ? 'Done ✓' : 'Mark taken'}
              </button>
            </div>
          </div>
        );
      })}

      {inactive.length > 0 && (
        <>
          <div className="k-eyebrow" style={{ color: T.inkFaint, margin: '20px 8px 8px' }}>
            Past prescriptions
          </div>
          {inactive.map((m) => (
            <div
              key={m.id}
              style={{
                background: T.paper,
                borderRadius: 14,
                padding: '10px 14px',
                border: `1px solid ${T.hairline}`,
                marginBottom: 8,
                opacity: 0.7,
              }}
            >
              <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>
                {m.name} · {m.dose}
              </div>
              <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2 }}>
                {m.startDate} – {m.endDate ?? '—'}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AppointmentsList({
  appts,
  onCancel,
  busyId,
}: {
  appts: Appointment[];
  onCancel: (a: Appointment) => void;
  busyId: string | null;
}) {
  const now = Date.now();
  const upcoming = appts.filter(
    (a) => a.status === 'scheduled' && (tsToDate(a.scheduledAt)?.getTime() ?? 0) >= now,
  );
  const past = appts
    .filter((a) => a.status !== 'scheduled' || (tsToDate(a.scheduledAt)?.getTime() ?? 0) < now)
    .reverse();

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <div style={{ padding: '24px 24px 40px', textAlign: 'center', color: T.inkMute }}>
        <div className="k-serif" style={{ fontSize: 18, color: T.ink, marginBottom: 6 }}>
          No appointments yet.
        </div>
        <div style={{ fontSize: 13 }}>
          Your clinician will schedule check-ins here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 16px 0' }}>
      {upcoming.length > 0 && (
        <>
          <div className="k-eyebrow" style={{ color: T.inkFaint, margin: '0 8px 8px' }}>
            Upcoming
          </div>
          {upcoming.map((a) => (
            <ApptCard key={a.id} a={a} onCancel={onCancel} busyId={busyId} />
          ))}
        </>
      )}
      {past.length > 0 && (
        <>
          <div className="k-eyebrow" style={{ color: T.inkFaint, margin: '20px 8px 8px' }}>
            Past
          </div>
          {past.map((a) => (
            <ApptCard key={a.id} a={a} past />
          ))}
        </>
      )}
    </div>
  );
}

function ApptCard({
  a,
  onCancel,
  busyId,
  past,
}: {
  a: Appointment;
  onCancel?: (a: Appointment) => void;
  busyId?: string | null;
  past?: boolean;
}) {
  const d = tsToDate(a.scheduledAt);
  const dateLabel = d
    ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : '—';
  const timeLabel = d
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '—';
  return (
    <div
      style={{
        background: T.paper,
        borderRadius: 16,
        padding: '14px 16px',
        border: `1px solid ${T.hairline}`,
        marginBottom: 10,
        opacity: past ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k-serif" style={{ fontSize: 17, color: T.ink, lineHeight: 1.2 }}>
            {dateLabel}, {timeLabel}
          </div>
          <div className="k-sans" style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>
            {apptTypeLabel(a.type)} · {a.durationMinutes} min
            {a.status !== 'scheduled' && ` · ${a.status}`}
          </div>
          {a.notes && (
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6, lineHeight: 1.4 }}>
              {a.notes}
            </div>
          )}
        </div>
        {!past && onCancel && a.status === 'scheduled' && (
          <button
            type="button"
            onClick={() => onCancel(a)}
            disabled={busyId !== null}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: `1px solid ${T.hairline}`,
              background: T.paper,
              color: T.coral,
              fontSize: 12,
              fontWeight: 600,
              cursor: busyId === a.id ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {busyId === a.id ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}

function frequencyLabel(f: Medication['frequency']): string {
  switch (f) {
    case 'once-daily': return 'Once daily';
    case 'twice-daily': return 'Twice daily';
    case 'three-times-daily': return '3× daily';
    case 'four-times-daily': return '4× daily';
    case 'weekly': return 'Weekly';
    case 'as-needed': return 'As needed';
    default: return f;
  }
}

function expectedDosesPerDay(m: Medication): number {
  switch (m.frequency) {
    case 'once-daily': return 1;
    case 'twice-daily': return 2;
    case 'three-times-daily': return 3;
    case 'four-times-daily': return 4;
    case 'weekly': return 0;
    case 'as-needed': return m.times.length || 1;
    default: return m.times.length || 1;
  }
}

function nextDoseTime(m: Medication, takenToday: number): string | null {
  const remaining = m.times.slice(takenToday);
  return remaining[0] ?? null;
}

function apptTypeLabel(t: Appointment['type']): string {
  switch (t) {
    case 'in-person': return 'In-person';
    case 'tele': return 'Video call';
    case 'home-visit': return 'Home visit';
    default: return 'Other';
  }
}
