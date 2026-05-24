'use client';

import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { tsToDate } from '@kinesis/db';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { listPatientsInClinic } from '@kinesis/db/queries/patients';
import { listRecentSessionsInClinic } from '@kinesis/db/queries/sessions';
import { listAlertsForClinic } from '@kinesis/db/queries/alerts';
import type { Alert, Clinic, Patient, Session } from '@kinesis/db';
import { getClinic } from '@kinesis/db/queries/clinics';

const W = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  amber: '#D4824A',
  coral: '#C44545',
  sage: '#5C8A6E',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
} as const;

type Scope = 'cohort' | 'patient';
type Range = 7 | 14 | 30 | 90;

export default function ReportsPage() {
  const { clinician } = useClinicianProfile();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [scope, setScope] = useState<Scope>('cohort');
  const [range, setRange] = useState<Range>(30);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clinicDoc = await getClinic(clinician.clinicId);
        if (cancelled) return;
        setClinic(clinicDoc);
        const [ps, ss, al] = await Promise.all([
          listPatientsInClinic(clinician.clinicId),
          listRecentSessionsInClinic(clinician.clinicId, 1000),
          listAlertsForClinic(clinician.clinicId, 300).catch(() => [] as Alert[]),
        ]);
        if (cancelled) return;
        setPatients(ps);
        setSessions(ss);
        setAlerts(al);
        if (ps.length > 0) setSelectedPatient(ps[0]!.id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinician.clinicId]);

  const cutoff = Date.now() - range * 24 * 60 * 60 * 1000;
  const windowSessions = useMemo(
    () => sessions.filter((s) => !s.isLive && (tsToDate(s.startedAt)?.getTime() ?? 0) >= cutoff),
    [sessions, cutoff],
  );
  const windowAlerts = useMemo(
    () => alerts.filter((a) => (tsToDate(a.createdAt)?.getTime() ?? 0) >= cutoff),
    [alerts, cutoff],
  );

  const patient = patients.find((p) => p.id === selectedPatient) ?? null;
  const patientSessions = patient
    ? windowSessions.filter((s) => s.patientId === patient.id)
    : [];
  const patientAlerts = patient
    ? windowAlerts.filter((a) => a.patientId === patient.id)
    : [];

  const onPrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <>
      <TopBar crumbs={['Reports']} />
      <div style={{ padding: '24px 28px 80px', background: W.bone, minHeight: 'calc(100vh - 56px)' }}>
        {/* Controls — hidden on print */}
        <div className="report-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 6 }}>Export</div>
            <h1 className="k-serif" style={{ fontSize: 28, color: W.ink, letterSpacing: '-0.02em' }}>Reports</h1>
            <div style={{ fontSize: 12, color: W.inkMute, marginTop: 4 }}>
              Print or save as PDF straight from the browser.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['cohort', 'patient'] as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  style={pill(scope === s)}
                >
                  {s === 'cohort' ? 'Cohort' : 'Single patient'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([7, 14, 30, 90] as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  style={pill(range === r)}
                >
                  {r}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onPrint}
              style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: W.ink, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Print / Save as PDF
            </button>
          </div>
        </div>

        {scope === 'patient' && (
          <div className="report-controls" style={{ background: W.paper, border: `1px solid ${W.hairline}`, borderRadius: 12, padding: 10, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="k-eyebrow" style={{ color: W.inkMute }}>Patient</span>
            <select
              value={selectedPatient ?? ''}
              onChange={(e) => setSelectedPatient(e.target.value || null)}
              style={{ flex: 1, border: `1px solid ${W.hairline}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, background: W.paper, color: W.ink, outline: 'none' }}
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName} {p.condition ? `· ${p.condition}` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* Printable area */}
        <div className="report-sheet" style={{ background: W.paper, border: `1px solid ${W.hairline}`, borderRadius: 14, padding: '36px 40px', maxWidth: 900, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${W.hairline}`, paddingBottom: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.18em', color: W.inkMute, marginBottom: 4 }}>
                KINESIS · {scope === 'cohort' ? 'COHORT REPORT' : 'PATIENT REPORT'}
              </div>
              <div className="k-serif" style={{ fontSize: 28, color: W.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {scope === 'cohort' ? (clinic?.name ?? 'Clinic') : patient?.fullName ?? 'Patient'}
              </div>
              <div style={{ fontSize: 12, color: W.inkMute, marginTop: 4 }}>
                {scope === 'patient' && patient
                  ? `${patient.condition ?? 'No condition'} · Week ${patient.weekNum} of ${patient.weekTotal}`
                  : `${patients.length} patients · last ${range} days`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: W.inkMute }}>Prepared by</div>
              <div style={{ fontSize: 13, color: W.ink, fontWeight: 600 }}>{clinician.fullName}</div>
              {clinician.title && <div style={{ fontSize: 11, color: W.inkMute }}>{clinician.title}</div>}
              <div style={{ fontSize: 11, color: W.inkFaint, marginTop: 4 }}>{new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
            </div>
          </div>

          {loading ? (
            <div style={{ fontSize: 13, color: W.inkMute, padding: 20, textAlign: 'center' }}>Building report…</div>
          ) : scope === 'cohort' ? (
            <CohortReport
              patients={patients}
              sessions={windowSessions}
              alerts={windowAlerts}
              days={range}
            />
          ) : patient ? (
            <PatientReport
              patient={patient}
              sessions={patientSessions}
              alerts={patientAlerts}
              days={range}
            />
          ) : (
            <div style={{ fontSize: 13, color: W.inkMute, padding: 20, textAlign: 'center' }}>
              No patients available to report on.
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop: `1px solid ${W.hairline}`, marginTop: 28, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: W.inkFaint }}>
            <span>Generated from KINESIS data — review before clinical use.</span>
            <span>Page 1</span>
          </div>
        </div>
      </div>

      {/* Print-only styles: hide all chrome, expand the sheet to the page. */}
      <style jsx global>{`
        @media print {
          .report-controls, header, aside, nav, [role="navigation"] { display: none !important; }
          body { background: white !important; }
          .report-sheet {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 24px !important;
            margin: 0 !important;
            max-width: none !important;
          }
          @page { margin: 18mm; }
        }
      `}</style>
    </>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 999,
    border: active ? `1px solid ${W.teal}` : `1px solid ${W.hairline}`,
    background: active ? W.tealLight : W.paper,
    color: active ? W.tealDeep : W.inkMute,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function CohortReport({ patients, sessions, alerts, days }: {
  patients: Patient[];
  sessions: Session[];
  alerts: Alert[];
  days: number;
}) {
  const active = patients.filter((p) => p.weekNum < p.weekTotal);
  const totalReps = sessions.reduce((s, x) => s + (x.reps ?? 0), 0);
  const avgQ = sessions.length > 0
    ? Math.round(avg(sessions.map((s) => s.avgQuality ?? 0)))
    : 0;
  const sessionsByPatient = new Map<string, number>();
  for (const s of sessions) sessionsByPatient.set(s.patientId, (sessionsByPatient.get(s.patientId) ?? 0) + 1);
  const ranking = patients
    .map((p) => ({
      patient: p,
      sessions: sessionsByPatient.get(p.id) ?? 0,
      alerts: alerts.filter((a) => a.patientId === p.id).length,
      lastSession: sessions
        .filter((s) => s.patientId === p.id)
        .map((s) => tsToDate(s.startedAt)?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return (
    <>
      <section style={{ marginBottom: 22 }}>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8, letterSpacing: '-0.01em' }}>Summary</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 12 }}>
          <KV label="Active cohort" value={String(active.length)} />
          <KV label="Sessions" value={String(sessions.length)} />
          <KV label="Reps logged" value={totalReps.toLocaleString()} />
          <KV label="Avg quality" value={`${avgQ}/100`} />
          <KV label="Open alerts" value={String(alerts.filter((a) => a.status === 'open').length)} />
          <KV label="Critical" value={String(alerts.filter((a) => a.severity === 'critical').length)} />
          <KV label="Window" value={`Last ${days} days`} />
          <KV label="Patients in clinic" value={String(patients.length)} />
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8, letterSpacing: '-0.01em' }}>Patient activity</h2>
        {ranking.length === 0 ? (
          <p style={{ fontSize: 12, color: W.inkMute }}>No patients in this clinic.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: W.inkMute, borderBottom: `1px solid ${W.hairline}` }}>
                <th style={{ padding: '8px 4px' }}>Patient</th>
                <th style={{ padding: '8px 4px' }}>Condition</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Week</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Sessions</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Alerts</th>
                <th style={{ padding: '8px 4px' }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.patient.id} style={{ borderBottom: `1px solid ${W.hairline}` }}>
                  <td style={{ padding: '10px 4px', color: W.ink, fontWeight: 600 }}>{r.patient.fullName}</td>
                  <td style={{ padding: '10px 4px', color: W.inkSoft }}>{r.patient.condition ?? '—'}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', color: W.inkSoft }}>{r.patient.weekNum}/{r.patient.weekTotal}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', color: W.inkSoft }}>{r.sessions}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', color: r.alerts > 0 ? W.coral : W.inkSoft, fontWeight: r.alerts > 0 ? 600 : 400 }}>{r.alerts}</td>
                  <td style={{ padding: '10px 4px', color: W.inkSoft }}>{r.lastSession ? new Date(r.lastSession).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8, letterSpacing: '-0.01em' }}>Open alerts</h2>
        {alerts.filter((a) => a.status === 'open').length === 0 ? (
          <p style={{ fontSize: 12, color: W.inkMute }}>No open alerts in the window. Cohort is on track.</p>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 12, color: W.inkSoft, lineHeight: 1.6 }}>
            {alerts.filter((a) => a.status === 'open').slice(0, 12).map((a) => {
              const p = patients.find((x) => x.id === a.patientId);
              return (
                <li key={a.id} style={{ marginBottom: 4 }}>
                  <strong style={{ color: a.severity === 'critical' ? W.coral : a.severity === 'warning' ? W.amber : W.ink }}>
                    [{a.severity.toUpperCase()}]
                  </strong>{' '}
                  {p?.fullName ?? '—'} — {a.title}
                  {a.description && <span style={{ color: W.inkMute }}> · {a.description}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function PatientReport({ patient, sessions, alerts, days }: {
  patient: Patient;
  sessions: Session[];
  alerts: Alert[];
  days: number;
}) {
  const sorted = [...sessions].sort(
    (a, b) => (tsToDate(a.startedAt)?.getTime() ?? 0) - (tsToDate(b.startedAt)?.getTime() ?? 0),
  );
  const totalReps = sessions.reduce((s, x) => s + (x.reps ?? 0), 0);
  const avgQ = sessions.length > 0 ? Math.round(avg(sessions.map((s) => s.avgQuality ?? 0))) : 0;
  const peakRom = sessions.reduce((mx, s) => Math.max(mx, ...(Object.values(s.peakRom) as number[])), 0);
  const classCounts: Record<string, number> = { normal: 0, compensatory: 0, guarded: 0, abnormal: 0 };
  for (const s of sessions) classCounts[s.classification ?? 'normal'] = (classCounts[s.classification ?? 'normal'] ?? 0) + 1;

  return (
    <>
      <section style={{ marginBottom: 22 }}>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8 }}>Snapshot</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 12 }}>
          <KV label="Compliance" value={patient.compliance} />
          <KV label="Sessions" value={String(sessions.length)} />
          <KV label="Reps logged" value={totalReps.toLocaleString()} />
          <KV label="Avg quality" value={`${avgQ}/100`} />
          <KV label="Peak ROM" value={`${Math.round(peakRom)}°`} />
          <KV label="Open alerts" value={String(alerts.filter((a) => a.status === 'open').length)} />
          <KV label="Age" value={patient.age != null ? String(patient.age) : '—'} />
          <KV label="Window" value={`Last ${days} days`} />
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8 }}>Movement classification</h2>
        <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
          {Object.entries(classCounts).map(([k, v]) => (
            <div key={k} style={{ flex: 1, padding: '10px 12px', border: `1px solid ${W.hairline}`, borderRadius: 10 }}>
              <div style={{ color: W.inkMute, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
              <div style={{ fontSize: 22, color: W.ink, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8 }}>Session log</h2>
        {sorted.length === 0 ? (
          <p style={{ fontSize: 12, color: W.inkMute }}>No sessions in the window.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: W.inkMute, borderBottom: `1px solid ${W.hairline}` }}>
                <th style={{ padding: '8px 4px' }}>Date</th>
                <th style={{ padding: '8px 4px' }}>Exercise</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Reps</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Quality</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Peak ROM</th>
                <th style={{ padding: '8px 4px' }}>Classification</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(-20).reverse().map((s) => {
                const peakRom = Math.max(0, ...(Object.values(s.peakRom) as number[]));
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${W.hairline}` }}>
                    <td style={{ padding: '8px 4px', color: W.inkSoft }}>{tsToDate(s.startedAt)?.toLocaleDateString() ?? '—'}</td>
                    <td style={{ padding: '8px 4px', color: W.ink }}>{(s.exerciseId ?? '—').replace(/-/g, ' ')}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: W.inkSoft }}>{s.reps ?? 0}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: (s.avgQuality ?? 0) >= 75 ? W.sage : (s.avgQuality ?? 0) >= 55 ? W.amber : W.coral, fontWeight: 600 }}>{s.avgQuality ?? 0}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: W.inkSoft }}>{Math.round(peakRom)}°</td>
                    <td style={{ padding: '8px 4px', color: W.inkSoft, textTransform: 'capitalize' }}>{s.classification ?? 'normal'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="k-serif" style={{ fontSize: 16, color: W.ink, marginBottom: 8 }}>Alerts</h2>
        {alerts.length === 0 ? (
          <p style={{ fontSize: 12, color: W.inkMute }}>No alerts in the window.</p>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 12, color: W.inkSoft, lineHeight: 1.6 }}>
            {alerts.slice(0, 12).map((a) => (
              <li key={a.id} style={{ marginBottom: 4 }}>
                <strong style={{ color: a.severity === 'critical' ? W.coral : a.severity === 'warning' ? W.amber : W.ink }}>
                  [{a.severity.toUpperCase()}]
                </strong>{' '}
                {a.title}
                {a.description && <span style={{ color: W.inkMute }}> · {a.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: W.bone, border: `1px solid ${W.hairline}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 9, color: W.inkMute, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 16, color: W.ink, marginTop: 2, textTransform: 'capitalize', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
