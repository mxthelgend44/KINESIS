'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Pill, useToast } from '@kinesis/ui';
import { TopBar } from '@/components/TopBar';
import { buildCohortRow, type CohortRow } from '@/lib/cohort-helpers';
import { tsToMillis } from '@kinesis/db';
import { subscribePatientsInClinic } from '@kinesis/db/queries/patients';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import {
  subscribeLiveSessionsInClinic,
  listRecentSessionsInClinic,
} from '@kinesis/db/queries/sessions';
import { subscribeOpenAlertsForClinic } from '@kinesis/db/queries/alerts';
import { hasSampleData, seedSampleData, clearSampleData } from '@kinesis/db/queries/sample-data';
import type { Alert, Patient, Session } from '@kinesis/db';

const W = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealMint: '#D7E8E1',
  tealDeep: '#114A3F',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  coral: '#C44545',
  coralLight: '#F5DCDC',
  sage: '#5C8A6E',
  sageLight: '#DDE7E0',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
} as const;

type CohortFilter = 'all' | 'active' | 'flagged' | 'discharged';

export default function CommandCentre() {
  const toast = useToast();
  // Clinician profile already loaded by the (dashboard) layout — read
  // from context instead of refetching.
  const { clinician } = useClinicianProfile();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [liveSessions, setLiveSessions] = useState<Session[]>([]);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<CohortFilter>('all');
  const [sampleOn, setSampleOn] = useState<boolean | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Detect whether sample data is already loaded so the toggle starts in
  // the right state.
  useEffect(() => {
    if (!clinician) return;
    let cancelled = false;
    (async () => {
      try {
        const present = await hasSampleData(clinician.id, clinician.clinicId);
        if (!cancelled) setSampleOn(present);
      } catch {
        if (!cancelled) setSampleOn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinician, refreshNonce]);

  useEffect(() => {
    if (!clinician) return;
    const unsubP = subscribePatientsInClinic(clinician.clinicId, setPatients);
    const unsubL = subscribeLiveSessionsInClinic(clinician.clinicId, setLiveSessions);
    const unsubA = subscribeOpenAlertsForClinic(clinician.clinicId, setAlerts);
    (async () => {
      try {
        const recent = await listRecentSessionsInClinic(clinician.clinicId, 200);
        setRecentSessions(recent);
      } catch (e) {
        // Permission errors here (most often a stale firestore.rules deploy)
        // would otherwise crash the page as an unhandled promise rejection.
        // Degrade silently — the dashboard just shows fewer historical
        // sessions until the rules catch up.
        // eslint-disable-next-line no-console
        console.warn('[dashboard:recentSessions]', e);
        setRecentSessions([]);
      }
    })();
    return () => {
      unsubP();
      unsubL();
      unsubA();
    };
  }, [clinician, refreshNonce]);

  const onToggleSample = async () => {
    if (!clinician || sampleBusy) return;
    setSampleBusy(true);
    try {
      if (sampleOn) {
        const { removed, skipped } = await clearSampleData({ uid: clinician.id, clinicId: clinician.clinicId });
        if (skipped.length > 0) {
          toast.error(`Removed ${removed} docs but some were blocked — deploy rules first. Skipped: ${skipped.join(', ')}.`);
        } else {
          toast.success(`Removed ${removed} sample document${removed === 1 ? '' : 's'}.`);
        }
        setSampleOn(false);
      } else {
        const r = await seedSampleData({
          uid: clinician.id,
          clinicId: clinician.clinicId,
        });
        const parts = [
          `${r.patients} patients`,
          `${r.sessions} sessions`,
          `${r.alerts} alerts`,
          `${r.messages} messages`,
          `${r.medications} meds`,
          `${r.appointments} appts`,
        ].join(', ');
        if (r.skipped.length > 0) {
          toast.error(
            `Loaded ${parts}. Blocked by the deployed Firestore rules: ${r.skipped.join(', ')}. Run \`firebase deploy --only firestore:rules\` then toggle off+on.`,
          );
        } else if (r.patients === 0) {
          toast.error('Could not create sample patients — deploy the new firestore.rules first.');
        } else {
          toast.success(`Loaded ${parts}.`);
        }
        setSampleOn(true);
      }
      setRefreshNonce((n) => n + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not toggle sample data.';
      toast.error(msg);
    } finally {
      setSampleBusy(false);
    }
  };

  const cohort = useMemo(() => {
    const liveIds = new Set(liveSessions.map((s) => s.patientId));
    const lastByPatient = new Map<string, Session>();
    for (const s of recentSessions) {
      if (!lastByPatient.has(s.patientId)) lastByPatient.set(s.patientId, s);
    }
    const counts = new Map<string, number>();
    for (const a of alerts) counts.set(a.patientId, (counts.get(a.patientId) ?? 0) + 1);

    const rows = patients.map((p) => buildCohortRow(p, liveIds, lastByPatient, counts));
    rows.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.alerts - a.alerts;
    });
    return rows;
  }, [patients, liveSessions, recentSessions, alerts]);

  const filteredCohort = useMemo(() => {
    if (filter === 'all') return cohort;
    if (filter === 'flagged') return cohort.filter((r) => r.alerts > 0 || r.compliance === 'red');
    if (filter === 'discharged') return cohort.filter((r) => r.weekNum >= r.weekTotal);
    return cohort.filter((r) => r.weekNum < r.weekTotal && r.compliance !== 'red');
  }, [cohort, filter]);

  const filterCounts = useMemo(
    () => ({
      all: cohort.length,
      active: cohort.filter((r) => r.weekNum < r.weekTotal && r.compliance !== 'red').length,
      flagged: cohort.filter((r) => r.alerts > 0 || r.compliance === 'red').length,
      discharged: cohort.filter((r) => r.weekNum >= r.weekTotal).length,
    }),
    [cohort],
  );

  if (!clinician) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sessionsToday = recentSessions.filter((s) => {
    const ms = tsToMillis(s.startedAt);
    return ms !== null && ms >= today.getTime();
  }).length;
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const cohortRomAvg =
    cohort.length === 0 ? 0 : Math.round(cohort.reduce((s, r) => s + r.romPct, 0) / cohort.length);

  const stats = [
    { label: 'PATIENTS', value: cohort.length, delta: '', deltaColor: W.sage },
    { label: 'SESSIONS · TODAY', value: sessionsToday, delta: `${liveSessions.length} active`, deltaColor: W.teal },
    {
      label: 'ACTIVE ALERTS',
      value: alerts.length,
      delta: criticalCount > 0 ? `${criticalCount} critical` : 'none critical',
      deltaColor: criticalCount > 0 ? W.coral : W.sage,
    },
    { label: 'COHORT ROM AVG', value: `${cohortRomAvg}%`, delta: '', deltaColor: W.sage },
  ];

  return (
    <>
      <TopBar crumbs={['Command Centre']} />
      <div style={{ background: W.bone, minHeight: 'calc(100vh - 56px)', padding: '24px 28px' }}>
        <div style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 6 }}>{dateString()}</div>
            <div className="k-serif" style={{ fontSize: 30, color: W.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Command centre{' '}
              <span style={{ color: W.inkMute, fontStyle: 'italic' }}>
                — good morning, {firstName(clinician.fullName)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onToggleSample}
              disabled={sampleBusy || sampleOn === null}
              title={
                sampleOn
                  ? 'Remove the sample sessions, alerts, and messages.'
                  : 'Load demo sessions, alerts, and messages so the dashboard has something to show.'
              }
              style={{
                padding: '9px 14px',
                borderRadius: 9,
                border: `1px solid ${sampleOn ? W.amber : W.hairline}`,
                background: sampleOn ? W.amberLight : W.paper,
                color: sampleOn ? W.amber : W.inkMute,
                fontSize: 12,
                fontWeight: 600,
                cursor: sampleBusy ? 'wait' : 'pointer',
                opacity: sampleOn === null || sampleBusy ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 14,
                  borderRadius: 7,
                  background: sampleOn ? W.amber : W.hairline,
                  position: 'relative',
                  display: 'inline-block',
                  transition: 'background 0.15s',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 1,
                    left: sampleOn ? 13 : 1,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: '#fff',
                    transition: 'left 0.15s',
                  }}
                />
              </span>
              {sampleBusy
                ? sampleOn ? 'Clearing…' : 'Loading…'
                : sampleOn ? 'Sample data ON' : 'Sample data OFF'}
            </button>
            <Link href="/patients/new" style={{ padding: '9px 14px', borderRadius: 9, border: `1px solid ${W.hairline}`, background: W.paper, color: W.ink, fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={W.ink} strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Invite patient
            </Link>
            <Link href="/reports" style={{ padding: '9px 14px', borderRadius: 9, border: 'none', background: W.ink, color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
              Generate cohort report
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ background: W.paper, borderRadius: 14, padding: '16px 18px', border: `1px solid ${W.hairline}` }}>
              <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 10 }}>{s.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="k-serif" style={{ fontSize: 36, color: W.ink, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</span>
                {s.delta && <span className="k-sans" style={{ fontSize: 11, color: s.deltaColor, fontWeight: 600 }}>{s.delta}</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
          <CohortTable
            rows={filteredCohort}
            totalRows={cohort.length}
            filter={filter}
            setFilter={setFilter}
            filterCounts={filterCounts}
          />
          <AlertsPanel alerts={alerts.slice(0, 5)} totalOpen={alerts.length} />
        </div>
      </div>
    </>
  );
}

function CohortTable({
  rows,
  totalRows,
  filter,
  setFilter,
  filterCounts,
}: {
  rows: CohortRow[];
  totalRows: number;
  filter: CohortFilter;
  setFilter: (f: CohortFilter) => void;
  filterCounts: Record<CohortFilter, number>;
}) {
  const filters: { id: CohortFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'flagged', label: 'Flagged' },
    { id: 'discharged', label: 'Discharged' },
  ];
  return (
    <div style={{ background: W.paper, borderRadius: 14, border: `1px solid ${W.hairline}`, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${W.hairline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="k-serif" style={{ fontSize: 18, color: W.ink, letterSpacing: '-0.01em' }}>Patient cohort</div>
          <div className="k-sans" style={{ fontSize: 11, color: W.inkMute, marginTop: 2 }}>
            {rows.length === totalRows
              ? `${totalRows} ${totalRows === 1 ? 'patient' : 'patients'} · live sessions surfaced`
              : `${rows.length} of ${totalRows} shown`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {filters.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: active ? W.ink : 'transparent',
                  color: active ? '#fff' : W.inkMute,
                  border: active ? 'none' : `1px solid ${W.hairline}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {f.label}
                <span className="k-mono" style={{ fontSize: 10, opacity: 0.7 }}>{filterCounts[f.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.6fr 0.7fr 1.2fr 1.6fr 0.9fr 0.7fr', padding: '10px 18px', borderBottom: `1px solid ${W.hairline}`, background: W.bone }}>
        {['PATIENT', 'CONDITION', 'WK', 'LAST SESSION', 'ROM PROGRESS', 'QUALITY', 'ALERTS'].map((h) => (
          <div key={h} className="k-eyebrow" style={{ color: W.inkMute }}>{h}</div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: W.inkMute }}>
          <div className="k-serif" style={{ fontSize: 18, color: W.ink, marginBottom: 4 }}>No patients yet</div>
          <p className="text-sm">Invite a patient from the top-right to start.</p>
        </div>
      ) : (
        rows.map((p, i) => {
          const qcMap = { sage: { fg: W.sage, bg: W.sageLight }, amber: { fg: W.amber, bg: W.amberLight }, coral: { fg: W.coral, bg: W.coralLight } } as const;
          const qc = qcMap[p.qC];
          return (
            <Link key={p.id} href={`/patients/view?id=${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.6fr 0.7fr 1.2fr 1.6fr 0.9fr 0.7fr', padding: '12px 18px', alignItems: 'center', borderBottom: i < rows.length - 1 ? `1px solid ${W.hairline}` : 'none', cursor: 'pointer', background: p.isLive ? W.tealLight : W.paper }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: p.compliance === 'green' ? W.sage : p.compliance === 'amber' ? W.amber : W.coral }} />
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: W.tealMint, color: W.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>{p.initials}</div>
                  <div>
                    <div className="k-sans" style={{ fontSize: 13, color: W.ink, fontWeight: 600 }}>{p.fullName}</div>
                    {p.isLive && (
                      <div className="k-mono" style={{ fontSize: 9, color: W.teal, fontWeight: 600, marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="k-pulse" style={{ width: 5, height: 5, borderRadius: 3, background: W.teal }} />
                        LIVE SESSION
                      </div>
                    )}
                  </div>
                </div>
                <div className="k-sans" style={{ fontSize: 12, color: W.inkSoft }}>{p.condition ?? '—'}</div>
                <div className="k-mono" style={{ fontSize: 11, color: W.inkMute }}>{p.wk}</div>
                <div className="k-sans" style={{ fontSize: 11, color: W.inkMute }}>{p.last}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: W.mist, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${p.romPct}%`, height: '100%', background: p.compliance === 'green' ? W.teal : p.compliance === 'amber' ? W.amber : W.coral, borderRadius: 2 }} />
                  </div>
                  <span className="k-mono" style={{ fontSize: 10, color: W.inkSoft, minWidth: 32 }}>{Math.round(p.rom)}°</span>
                </div>
                <div>{p.q > 0 ? <Pill color={qc.fg} bg={qc.bg}>{p.q}</Pill> : <span className="k-mono" style={{ fontSize: 10, color: W.inkFaint }}>—</span>}</div>
                <div>
                  {p.alerts > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, fontSize: 11, background: W.coralLight, color: W.coral, fontWeight: 600 }}>● {p.alerts}</span>
                  ) : (
                    <span className="k-mono" style={{ fontSize: 10, color: W.inkFaint }}>—</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}

function AlertsPanel({ alerts, totalOpen }: { alerts: Alert[]; totalOpen: number }) {
  const sevColor = (s: 'critical' | 'warning' | 'info') =>
    s === 'critical' ? W.coral : s === 'warning' ? W.amber : W.teal;
  return (
    <div style={{ background: W.paper, borderRadius: 14, border: `1px solid ${W.hairline}`, overflow: 'hidden', alignSelf: 'start' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${W.hairline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="k-serif" style={{ fontSize: 17, color: W.ink, letterSpacing: '-0.01em' }}>Active alerts</div>
        <span className="k-mono" style={{ fontSize: 10, color: totalOpen > 0 ? W.coral : W.inkFaint, fontWeight: 600 }}>{totalOpen} OPEN</span>
      </div>
      {alerts.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div className="k-sans" style={{ color: W.inkMute, fontSize: 13 }}>No active alerts.</div>
        </div>
      ) : (
        alerts.map((a, i) => (
          <Link key={a.id} href={`/patients/view?id=${a.patientId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ padding: '14px 18px', borderBottom: i < alerts.length - 1 ? `1px solid ${W.hairline}` : 'none', borderLeft: `3px solid ${sevColor(a.severity)}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="k-eyebrow" style={{ color: sevColor(a.severity) }}>{a.severity.toUpperCase()}</span>
              </div>
              <div className="k-sans" style={{ fontSize: 13, color: W.ink, fontWeight: 600, marginBottom: 2 }}>{a.title}</div>
              {a.description && <div className="k-sans" style={{ fontSize: 11, color: W.inkMute }}>{a.description}</div>}
            </div>
          </Link>
        ))
      )}
      <Link href="/alerts" style={{ display: 'block', padding: '12px 18px', textAlign: 'center', textDecoration: 'none' }}>
        <span className="k-sans" style={{ fontSize: 12, color: W.teal, fontWeight: 600 }}>View all alerts →</span>
      </Link>
    </div>
  );
}

function firstName(s: string) {
  return s.split(/\s+/)[0] ?? '';
}

function dateString() {
  const d = new Date();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${days[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
