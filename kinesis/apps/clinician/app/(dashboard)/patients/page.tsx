'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { Pill } from '@kinesis/ui';
import { tsToDate } from '@kinesis/db';
import { subscribePatientsInClinic } from '@kinesis/db/queries/patients';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import {
  subscribeLiveSessionsInClinic,
  listRecentSessionsInClinic,
} from '@kinesis/db/queries/sessions';
import { subscribeOpenAlertsForClinic } from '@kinesis/db/queries/alerts';
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

type Sort = 'name' | 'recent' | 'risk';
type Compliance = Patient['compliance'];

export default function PatientsPage() {
  const { clinician } = useClinicianProfile();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [liveSessions, setLiveSessions] = useState<Session[]>([]);
  const [recent, setRecent] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const unsubP = subscribePatientsInClinic(clinician.clinicId, setPatients);
    const unsubL = subscribeLiveSessionsInClinic(clinician.clinicId, setLiveSessions);
    const unsubA = subscribeOpenAlertsForClinic(clinician.clinicId, setAlerts);
    (async () => {
      try {
        const r = await listRecentSessionsInClinic(clinician.clinicId, 400);
        setRecent(r);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[patients:recent]', e);
        setRecent([]);
      }
    })();
    return () => {
      unsubP();
      unsubL();
      unsubA();
    };
  }, [clinician]);

  const rows = useMemo(() => {
    const liveBy = new Set(liveSessions.map((s) => s.patientId));
    const lastSessionBy = new Map<string, Session>();
    for (const s of recent) {
      const cur = lastSessionBy.get(s.patientId);
      if (!cur) lastSessionBy.set(s.patientId, s);
    }
    const alertsBy = new Map<string, number>();
    for (const a of alerts) alertsBy.set(a.patientId, (alertsBy.get(a.patientId) ?? 0) + 1);

    const q = search.trim().toLowerCase();
    let filtered = patients;
    if (q) {
      filtered = patients.filter(
        (p) =>
          p.fullName.toLowerCase().includes(q) ||
          (p.condition ?? '').toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q),
      );
    }
    if (!showAll) {
      filtered = filtered.filter((p) => p.weekNum < p.weekTotal);
    }

    const built = filtered.map((p) => ({
      patient: p,
      isLive: liveBy.has(p.id),
      last: lastSessionBy.get(p.id) ?? null,
      alerts: alertsBy.get(p.id) ?? 0,
    }));

    built.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      if (sort === 'name') return a.patient.fullName.localeCompare(b.patient.fullName);
      if (sort === 'risk') {
        const score = (r: typeof a) =>
          (r.alerts * 10) +
          (r.patient.compliance === 'red' ? 30 : r.patient.compliance === 'amber' ? 15 : 0);
        return score(b) - score(a);
      }
      // recent
      const at = tsToMs(a.last?.startedAt) ?? 0;
      const bt = tsToMs(b.last?.startedAt) ?? 0;
      return bt - at;
    });
    return built;
  }, [patients, recent, alerts, liveSessions, search, showAll, sort]);

  if (!clinician) return null;

  return (
    <>
      <TopBar crumbs={['Patients']} />
      <div style={{ background: W.bone, minHeight: 'calc(100vh - 56px)', padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 6 }}>Roster</div>
            <div className="k-serif" style={{ fontSize: 28, color: W.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              All patients in this clinic
            </div>
          </div>
          <Link
            href="/patients/new"
            style={{
              padding: '9px 14px',
              borderRadius: 9,
              border: 'none',
              background: W.ink,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Invite patient
          </Link>
        </div>

        <div
          style={{
            background: W.paper,
            border: `1px solid ${W.hairline}`,
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={W.inkMute} strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, condition, or email"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: 14,
              background: 'transparent',
              fontFamily: 'inherit',
              color: W.ink,
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            {(['recent', 'name', 'risk'] as Sort[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: sort === s ? `1px solid ${W.teal}` : `1px solid ${W.hairline}`,
                  background: sort === s ? W.tealLight : W.paper,
                  color: sort === s ? W.tealDeep : W.inkMute,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {s === 'recent' ? 'Most recent' : s === 'name' ? 'A → Z' : 'Risk'}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: W.inkMute, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              style={{ accentColor: W.teal }}
            />
            Include discharged
          </label>
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              background: W.paper,
              border: `1px dashed ${W.hairline}`,
              borderRadius: 14,
              padding: 40,
              textAlign: 'center',
              color: W.inkMute,
            }}
          >
            <div className="k-serif" style={{ fontSize: 18, color: W.ink, marginBottom: 6 }}>
              {patients.length === 0 ? 'No patients yet.' : 'No patients match that filter.'}
            </div>
            <div style={{ fontSize: 13 }}>
              {patients.length === 0
                ? 'Use “Invite patient” to send your first clinic invite code.'
                : 'Try clearing the search or including discharged patients.'}
            </div>
          </div>
        ) : (
          <div
            style={{
              background: W.paper,
              border: `1px solid ${W.hairline}`,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 1.2fr 0.9fr 0.9fr 0.7fr 0.5fr',
                padding: '10px 16px',
                background: W.mist,
                borderBottom: `1px solid ${W.hairline}`,
              }}
            >
              {['Patient', 'Condition', 'Week', 'Last session', 'Alerts', ''].map((h) => (
                <div key={h} className="k-eyebrow" style={{ color: W.inkMute }}>
                  {h}
                </div>
              ))}
            </div>
            {rows.map(({ patient, isLive, last, alerts: a }) => {
              const lastMs = tsToMs(last?.startedAt);
              return (
                <Link
                  key={patient.id}
                  href={`/patients/view?id=${patient.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.6fr 1.2fr 0.9fr 0.9fr 0.7fr 0.5fr',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: `1px solid ${W.hairline}`,
                    textDecoration: 'none',
                    color: 'inherit',
                    background: isLive ? 'linear-gradient(90deg, rgba(91,214,160,0.06), transparent 40%)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        background: W.tealMint,
                        color: W.tealDeep,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {initials(patient.fullName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="k-sans"
                        style={{ fontSize: 13, color: W.ink, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {patient.fullName}
                      </div>
                      <div className="k-mono" style={{ fontSize: 10, color: W.inkFaint }}>
                        {patient.email}
                      </div>
                    </div>
                  </div>
                  <div className="k-sans" style={{ fontSize: 12, color: W.inkSoft }}>
                    {patient.condition ?? <span style={{ color: W.inkFaint, fontStyle: 'italic' }}>not set</span>}
                  </div>
                  <div className="k-mono k-tabnums" style={{ fontSize: 12, color: W.ink }}>
                    {patient.weekNum}/{patient.weekTotal}
                  </div>
                  <div className="k-sans" style={{ fontSize: 12, color: lastMs ? W.inkSoft : W.inkFaint }}>
                    {lastMs ? relativeLabel(lastMs) : '—'}
                  </div>
                  <div>
                    {a > 0 ? (
                      <Pill color="#fff" bg={W.coral}>{a}</Pill>
                    ) : (
                      <span style={{ color: W.inkFaint, fontSize: 12 }}>0</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {isLive ? <ComplianceBadge value="live" /> : <ComplianceBadge value={patient.compliance} />}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ComplianceBadge({ value }: { value: Compliance | 'live' }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    live:  { bg: '#D7F4E5', fg: '#0E5C3E', label: 'Live' },
    green: { bg: W.sageLight, fg: '#3F6B4F', label: 'On track' },
    amber: { bg: W.amberLight, fg: '#7A4A1F', label: 'Watch' },
    red:   { bg: W.coralLight, fg: '#7A2A2A', label: 'Off plan' },
  };
  const m = map[value] ?? map.green!;
  return <Pill color={m.fg} bg={m.bg}>{m.label}</Pill>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function tsToMs(t: unknown): number | null {
  if (!t) return null;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'object' && t !== null && 'toMillis' in t && typeof (t as { toMillis: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  return null;
}

function relativeLabel(ms: number): string {
  const dt = Date.now() - ms;
  const sec = Math.floor(dt / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ms).toLocaleDateString();
}
