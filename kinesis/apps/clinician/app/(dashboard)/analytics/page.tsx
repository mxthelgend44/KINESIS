'use client';

import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { Sparkline } from '@kinesis/ui';
import { tsToDate } from '@kinesis/db';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { listPatientsInClinic } from '@kinesis/db/queries/patients';
import { listRecentSessionsInClinic } from '@kinesis/db/queries/sessions';
import { listAlertsForClinic } from '@kinesis/db/queries/alerts';
import type { Alert, Patient, Session } from '@kinesis/db';

const W = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  tealMint: '#D7E8E1',
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

type Window = 7 | 14 | 30 | 90;

export default function AnalyticsPage() {
  const { clinician } = useClinicianProfile();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [windowDays, setWindowDays] = useState<Window>(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ps, ss, al] = await Promise.all([
          listPatientsInClinic(clinician.clinicId),
          listRecentSessionsInClinic(clinician.clinicId, 1000),
          listAlertsForClinic(clinician.clinicId, 300).catch(() => [] as Alert[]),
        ]);
        if (cancelled) return;
        setPatients(ps);
        setSessions(ss);
        setAlerts(al);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinician.clinicId]);

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const windowSessions = useMemo(
    () => sessions.filter((s) => !s.isLive && (tsToDate(s.startedAt)?.getTime() ?? 0) >= cutoff),
    [sessions, cutoff],
  );
  const windowAlerts = useMemo(
    () => alerts.filter((a) => (tsToDate(a.createdAt)?.getTime() ?? 0) >= cutoff),
    [alerts, cutoff],
  );

  // ── Adherence: target = 5 sessions / week / patient.
  // We compute it as the % of patient-weeks where at least 3 sessions happened.
  const adherence = useMemo(() => {
    if (patients.length === 0) return { pct: 0, hit: 0, total: 0 };
    const weeks = Math.max(1, Math.round(windowDays / 7));
    let hit = 0;
    let total = 0;
    for (const p of patients) {
      for (let w = 0; w < weeks; w++) {
        total += 1;
        const wkStart = Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000;
        const wkEnd = Date.now() - w * 7 * 24 * 60 * 60 * 1000;
        const count = windowSessions.filter(
          (s) =>
            s.patientId === p.id &&
            ((tsToDate(s.startedAt)?.getTime() ?? 0) >= wkStart) &&
            ((tsToDate(s.startedAt)?.getTime() ?? 0) < wkEnd),
        ).length;
        if (count >= 3) hit += 1;
      }
    }
    return { pct: total > 0 ? Math.round((hit / total) * 100) : 0, hit, total };
  }, [patients, windowSessions, windowDays]);

  // ── Quality distribution by classification
  const classDist = useMemo(() => {
    const map: Record<string, number> = { normal: 0, compensatory: 0, guarded: 0, abnormal: 0 };
    for (const s of windowSessions) {
      const c = s.classification ?? 'normal';
      map[c] = (map[c] ?? 0) + 1;
    }
    const total = windowSessions.length;
    return Object.entries(map).map(([k, v]) => ({
      key: k,
      count: v,
      pct: total > 0 ? Math.round((v / total) * 100) : 0,
    }));
  }, [windowSessions]);

  // ── Recovery slope by condition: change in peakROM per week
  const slopeByCondition = useMemo(() => {
    const groups = new Map<string, Patient[]>();
    for (const p of patients) {
      const key = (p.condition ?? 'Unspecified').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const rows: Array<{
      condition: string;
      n: number;
      slopeDegPerWeek: number;
      avgQuality: number;
      adherencePct: number;
    }> = [];
    for (const [cond, members] of groups) {
      const slopes: number[] = [];
      const quals: number[] = [];
      let sessHit = 0;
      for (const p of members) {
        const ps = windowSessions
          .filter((s) => s.patientId === p.id)
          .sort(
            (a, b) =>
              (tsToDate(a.startedAt)?.getTime() ?? 0) - (tsToDate(b.startedAt)?.getTime() ?? 0),
          );
        if (ps.length === 0) continue;
        // Slope: regress peakRom (max across joints) against day index.
        const points = ps.map((s) => ({
          day: ((tsToDate(s.startedAt)?.getTime() ?? 0) - cutoff) / (24 * 60 * 60 * 1000),
          rom: Math.max(0, ...(Object.values(s.peakRom) as number[])),
        }));
        const slope = linearSlope(points.map((p) => p.day), points.map((p) => p.rom));
        if (isFinite(slope)) slopes.push(slope * 7); // convert per-day → per-week
        for (const s of ps) quals.push(s.avgQuality ?? 0);
        sessHit += ps.length;
      }
      if (sessHit === 0) continue;
      rows.push({
        condition: cond,
        n: members.length,
        slopeDegPerWeek: slopes.length > 0 ? avg(slopes) : 0,
        avgQuality: quals.length > 0 ? avg(quals) : 0,
        adherencePct: Math.round(
          (sessHit / Math.max(1, members.length * Math.max(1, windowDays / 7))) * 20,
        ),
      });
    }
    rows.sort((a, b) => b.n - a.n);
    return rows;
  }, [patients, windowSessions, cutoff, windowDays]);

  // ── Outliers: patients with ≥2 alerts OR avg quality < 55 OR ROM regression
  const outliers = useMemo(() => {
    const alertCount = new Map<string, number>();
    for (const a of windowAlerts) alertCount.set(a.patientId, (alertCount.get(a.patientId) ?? 0) + 1);
    return patients
      .map((p) => {
        const ps = windowSessions
          .filter((s) => s.patientId === p.id)
          .sort(
            (a, b) =>
              (tsToDate(a.startedAt)?.getTime() ?? 0) - (tsToDate(b.startedAt)?.getTime() ?? 0),
          );
        const quals = ps.map((s) => s.avgQuality ?? 0);
        const avgQ = quals.length > 0 ? avg(quals) : 0;
        const slope = ps.length >= 3
          ? linearSlope(
              ps.map((s, i) => i),
              ps.map((s) => Math.max(0, ...(Object.values(s.peakRom) as number[]))),
            )
          : 0;
        return {
          patient: p,
          alerts: alertCount.get(p.id) ?? 0,
          avgQuality: avgQ,
          slope,
          sessions: ps.length,
        };
      })
      .filter((r) => r.alerts >= 2 || (r.avgQuality > 0 && r.avgQuality < 55) || r.slope < -1)
      .sort((a, b) => (b.alerts - a.alerts) || (a.avgQuality - b.avgQuality));
  }, [patients, windowSessions, windowAlerts]);

  // ── Top tracked joints
  const jointMix = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of windowSessions) {
      for (const j of s.jointKeys ?? []) map[j] = (map[j] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => ({ joint: k, count: v }));
  }, [windowSessions]);

  // ── Sessions per day series (sparkline)
  const sessionsPerDay = useMemo(() => {
    const days: number[] = new Array(windowDays).fill(0);
    for (const s of windowSessions) {
      const t = tsToDate(s.startedAt)?.getTime() ?? 0;
      const dayIdx = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
      const i = windowDays - 1 - dayIdx;
      if (i >= 0 && i < windowDays) days[i] += 1;
    }
    return days;
  }, [windowSessions, windowDays]);

  const liveCohort = patients.filter((p) => p.weekNum < p.weekTotal).length;
  const totalReps = windowSessions.reduce((s, x) => s + (x.reps ?? 0), 0);
  const avgQuality = windowSessions.length > 0
    ? Math.round(avg(windowSessions.map((s) => s.avgQuality ?? 0)))
    : 0;

  return (
    <>
      <TopBar crumbs={['Analytics']} />
      <div style={{ padding: '24px 28px', background: W.bone, minHeight: 'calc(100vh - 56px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 6 }}>Cohort</div>
            <h1 className="k-serif" style={{ fontSize: 28, color: W.ink, letterSpacing: '-0.02em', marginBottom: 4 }}>
              Analytics
            </h1>
            <div style={{ fontSize: 12, color: W.inkMute }}>
              {patients.length} patients · {windowSessions.length} sessions · {windowAlerts.length} alerts in the last {windowDays} days
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([7, 14, 30, 90] as Window[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowDays(w)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 999,
                  border: windowDays === w ? `1px solid ${W.teal}` : `1px solid ${W.hairline}`,
                  background: windowDays === w ? W.tealLight : W.paper,
                  color: windowDays === w ? W.tealDeep : W.inkMute,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ background: W.paper, border: `1px dashed ${W.hairline}`, padding: 40, borderRadius: 14, textAlign: 'center', color: W.inkMute }}>
            Crunching numbers…
          </div>
        ) : patients.length === 0 ? (
          <div style={{ background: W.paper, border: `1px dashed ${W.hairline}`, padding: 40, borderRadius: 14, textAlign: 'center', color: W.inkMute }}>
            No patients in this clinic yet. Use <strong>Sample data ON</strong> on the dashboard to populate analytics with realistic demo numbers.
          </div>
        ) : (
          <>
            {/* Headline stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              <Stat label="Adherence" value={`${adherence.pct}%`} sub={`${adherence.hit} of ${adherence.total} patient-weeks ≥ 3 sessions`} color={adherence.pct >= 70 ? W.sage : adherence.pct >= 40 ? W.amber : W.coral} />
              <Stat label="Active cohort" value={String(liveCohort)} sub={`${patients.length - liveCohort} discharged`} color={W.ink} />
              <Stat label="Avg movement quality" value={String(avgQuality)} sub="across all sessions in window" color={avgQuality >= 75 ? W.sage : avgQuality >= 55 ? W.amber : W.coral} />
              <Stat label="Reps logged" value={totalReps.toLocaleString()} sub={`${windowSessions.length} sessions`} color={W.ink} />
            </div>

            {/* Sessions over time */}
            <Card title="Sessions per day" right={`peak ${Math.max(0, ...sessionsPerDay)}`}>
              <Sparkline data={sessionsPerDay} color={W.teal} width={760} height={64} />
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
              {/* Class distribution */}
              <Card title="Movement classification">
                {classDist.map((c) => (
                  <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 110, fontSize: 12, color: W.inkSoft, fontWeight: 500, textTransform: 'capitalize' }}>{c.key}</div>
                    <div style={{ flex: 1, height: 8, background: W.mist, borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${c.pct}%`,
                          height: '100%',
                          background:
                            c.key === 'normal'        ? W.sage  :
                            c.key === 'compensatory'  ? W.amber :
                            c.key === 'guarded'       ? '#A06B3F' :
                            W.coral,
                        }}
                      />
                    </div>
                    <div className="k-mono" style={{ width: 56, textAlign: 'right', fontSize: 11, color: W.inkMute }}>
                      {c.count} · {c.pct}%
                    </div>
                  </div>
                ))}
              </Card>

              {/* Most-tracked joints */}
              <Card title="Tracked joints">
                {jointMix.length === 0 ? (
                  <div style={{ fontSize: 12, color: W.inkMute }}>No sessions logged in window.</div>
                ) : jointMix.map((j) => (
                  <div key={j.joint} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 130, fontSize: 12, color: W.inkSoft, fontWeight: 500, textTransform: 'capitalize' }}>
                      {j.joint.replace('_', ' ')}
                    </div>
                    <div style={{ flex: 1, height: 8, background: W.mist, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(j.count / jointMix[0]!.count) * 100}%`, height: '100%', background: W.teal }} />
                    </div>
                    <div className="k-mono" style={{ width: 36, textAlign: 'right', fontSize: 11, color: W.inkMute }}>
                      {j.count}
                    </div>
                  </div>
                ))}
              </Card>
            </div>

            {/* Recovery slopes table */}
            <Card title="Recovery slopes by condition" right="ROM change per week (higher = faster recovery)" style={{ marginTop: 16 }}>
              {slopeByCondition.length === 0 ? (
                <div style={{ fontSize: 12, color: W.inkMute }}>Need more sessions to compute trends.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr 1fr 1fr', gap: 0, fontSize: 12 }}>
                  <div style={{ padding: '8px 0', color: W.inkMute, fontWeight: 600, borderBottom: `1px solid ${W.hairline}` }}>Condition</div>
                  <div style={{ padding: '8px 0', color: W.inkMute, fontWeight: 600, borderBottom: `1px solid ${W.hairline}`, textAlign: 'right' }}>n</div>
                  <div style={{ padding: '8px 0', color: W.inkMute, fontWeight: 600, borderBottom: `1px solid ${W.hairline}`, textAlign: 'right' }}>ROM/wk</div>
                  <div style={{ padding: '8px 0', color: W.inkMute, fontWeight: 600, borderBottom: `1px solid ${W.hairline}`, textAlign: 'right' }}>Quality</div>
                  <div style={{ padding: '8px 0', color: W.inkMute, fontWeight: 600, borderBottom: `1px solid ${W.hairline}`, textAlign: 'right' }}>Adherence</div>
                  {slopeByCondition.map((r) => (
                    <div key={r.condition} style={{ display: 'contents' }}>
                      <div style={{ padding: '10px 0', borderBottom: `1px solid ${W.hairline}`, color: W.ink }}>{r.condition}</div>
                      <div style={{ padding: '10px 0', borderBottom: `1px solid ${W.hairline}`, textAlign: 'right', color: W.inkSoft }}>{r.n}</div>
                      <div style={{ padding: '10px 0', borderBottom: `1px solid ${W.hairline}`, textAlign: 'right', color: r.slopeDegPerWeek >= 1 ? W.sage : r.slopeDegPerWeek >= 0 ? W.amber : W.coral, fontWeight: 600 }}>
                        {r.slopeDegPerWeek >= 0 ? '+' : ''}{r.slopeDegPerWeek.toFixed(1)}°
                      </div>
                      <div style={{ padding: '10px 0', borderBottom: `1px solid ${W.hairline}`, textAlign: 'right', color: W.inkSoft }}>{Math.round(r.avgQuality)}</div>
                      <div style={{ padding: '10px 0', borderBottom: `1px solid ${W.hairline}`, textAlign: 'right', color: W.inkSoft }}>{r.adherencePct}%</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Outliers */}
            <Card title="Outliers needing attention" right={`${outliers.length} flagged`} style={{ marginTop: 16 }}>
              {outliers.length === 0 ? (
                <div style={{ fontSize: 12, color: W.sage }}>No outliers in window. Cohort is on track.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {outliers.slice(0, 10).map((o) => (
                    <a
                      key={o.patient.id}
                      href={`/patients/view?id=${o.patient.id}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.8fr 0.6fr',
                        gap: 10,
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: `1px solid ${W.hairline}`,
                        background: W.paper,
                        textDecoration: 'none',
                        color: W.ink,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{o.patient.fullName}</div>
                        <div style={{ fontSize: 11, color: W.inkMute }}>{o.patient.condition ?? 'No condition'}</div>
                      </div>
                      <Badge label={`${o.alerts} alert${o.alerts === 1 ? '' : 's'}`} kind={o.alerts >= 2 ? 'coral' : 'amber'} />
                      <Badge label={`Quality ${Math.round(o.avgQuality)}`} kind={o.avgQuality < 55 ? 'coral' : 'amber'} />
                      <Badge label={`ROM ${o.slope >= 0 ? '+' : ''}${o.slope.toFixed(1)}/sess`} kind={o.slope < -1 ? 'coral' : o.slope < 0 ? 'amber' : 'sage'} />
                      <div style={{ fontSize: 11, color: W.inkMute, textAlign: 'right' }}>{o.sessions} sess</div>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: W.paper, border: `1px solid ${W.hairline}`, borderRadius: 14, padding: '16px 18px' }}>
      <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 8 }}>{label}</div>
      <div className="k-serif" style={{ fontSize: 30, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: W.inkMute, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Card({ title, right, children, style }: { title: string; right?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: W.paper, border: `1px solid ${W.hairline}`, borderRadius: 14, padding: '14px 18px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="k-eyebrow" style={{ color: W.inkMute }}>{title}</div>
        {right && <div style={{ fontSize: 10, color: W.inkFaint }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Badge({ label, kind }: { label: string; kind: 'sage' | 'amber' | 'coral' }) {
  const bg = kind === 'sage' ? W.sageLight : kind === 'amber' ? W.amberLight : W.coralLight;
  const fg = kind === 'sage' ? '#3F6B4F' : kind === 'amber' ? '#7A4A1F' : '#7A2A2A';
  return (
    <span style={{ padding: '3px 8px', borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 600, textAlign: 'center' }}>
      {label}
    </span>
  );
}

// ── numeric helpers ──────────────────────────────────────────────────────
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function linearSlope(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const xMean = avg(xs);
  const yMean = avg(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - xMean) * (ys[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
