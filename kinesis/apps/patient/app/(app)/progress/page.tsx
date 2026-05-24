'use client';

import { useEffect, useState } from 'react';
import { Pill } from '@kinesis/ui';
import { useAuth, tsToDate } from '@kinesis/db';
import { listSessionsForPatient } from '@kinesis/db/queries/sessions';
import { listPainCheckins } from '@kinesis/db/queries/pain';
import type { PainCheckin, Session } from '@kinesis/db';

const T = {
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
};

const TABS = ['ROM', 'Quality', 'Pain', 'History'] as const;

export default function PatientProgress() {
  const auth = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pain, setPain] = useState<PainCheckin[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>('ROM');

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    (async () => {
      const [s, p] = await Promise.all([
        listSessionsForPatient(auth.user.uid, { live: false }),
        listPainCheckins(auth.user.uid, 28),
      ]);
      setSessions(s.slice().reverse()); // oldest → newest for trajectory
      setPain(p);
    })();
  }, [auth.status, auth.user]);

  const rom = sessions.map((s) => Math.max(0, ...(Object.values(s.peakRom) as number[])));

  return (
    <div style={{ background: T.bone, minHeight: '100vh', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />
      <div style={{ padding: '14px 24px 6px' }}>
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>RECOVERY ANALYTICS</div>
        <div className="k-serif" style={{ fontSize: 32, color: T.ink, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          Your <em style={{ color: T.teal }}>trajectory</em>
        </div>
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: T.mist, borderRadius: 12 }}>
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 9,
                  border: 'none',
                  background: active ? T.paper : 'transparent',
                  color: active ? T.ink : T.inkMute,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'ROM' && <RomCard rom={rom} />}
      {tab === 'Quality' && <QualityCard sessions={sessions} />}
      {tab === 'Pain' && <PainHeatmap pain={pain} />}
      {tab === 'History' && <SessionList sessions={sessions.slice().reverse()} />}
    </div>
  );
}

function RomCard({ rom }: { rom: number[] }) {
  if (rom.length === 0) {
    return (
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 20, padding: 24, border: `1px solid ${T.hairline}`, textAlign: 'center' }}>
          <div className="k-serif" style={{ fontSize: 18, color: T.ink, marginBottom: 4 }}>
            No completed sessions yet
          </div>
          <p style={{ fontSize: 12, color: T.inkMute }}>Your ROM trajectory will appear once you complete a session.</p>
        </div>
      </div>
    );
  }
  const W = 340;
  const H = 180;
  const xStep = W / Math.max(1, rom.length - 1);
  const yMin = 30;
  const yMax = Math.max(140, Math.ceil((Math.max(...rom) + 10) / 10) * 10);
  const toY = (v: number) => H - ((v - yMin) / (yMax - yMin)) * (H - 20) - 10;
  const pts = rom.map((v, i) => [i * xStep, toY(v)] as const);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');

  const current = rom[rom.length - 1] ?? 0;
  const prev = rom[rom.length - 2] ?? current;
  const delta = Math.round(current - prev);

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ background: T.paper, borderRadius: 20, padding: 20, border: `1px solid ${T.hairline}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 6 }}>RANGE OF MOTION · DEGREES</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="k-serif" style={{ fontSize: 44, color: T.ink, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {Math.round(current)}°
              </span>
              {delta !== 0 && (
                <span className="k-sans" style={{ fontSize: 13, color: delta > 0 ? T.sage : T.coral, fontWeight: 600 }}>
                  {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}°
                </span>
              )}
            </div>
            <div className="k-sans" style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>vs. previous · target 120°</div>
          </div>
        </div>

        <svg width="100%" viewBox={`0 0 ${W} ${H + 30}`} style={{ display: 'block' }}>
          {[60, 80, 100, 120].map((v) => (
            <g key={v}>
              <line x1="0" x2={W} y1={toY(v)} y2={toY(v)} stroke={T.hairline} strokeWidth="0.5" strokeDasharray="2 3" />
              <text x={W - 2} y={toY(v) - 2} textAnchor="end" className="k-mono" style={{ fontSize: 8, fill: T.inkFaint }}>{v}°</text>
            </g>
          ))}
          <path d={path} stroke={T.teal} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2} fill={i === pts.length - 1 ? T.amber : T.teal} />
          ))}
          <text x={pts[pts.length - 1]![0] - 4} y={pts[pts.length - 1]![1] - 8} textAnchor="end" className="k-mono" style={{ fontSize: 9, fill: T.amber, fontWeight: 600 }}>
            TODAY
          </text>
          <text x="0" y={H + 14} className="k-mono" style={{ fontSize: 8, fill: T.inkFaint }}>S1</text>
          <text x={W} y={H + 14} textAnchor="end" className="k-mono" style={{ fontSize: 8, fill: T.inkFaint }}>S{rom.length}</text>
        </svg>
      </div>
    </div>
  );
}

function QualityCard({ sessions }: { sessions: Session[] }) {
  const scores = sessions.slice(-20).map((s) => s.avgQuality);
  if (!scores.length) {
    return (
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 20, padding: 24, border: `1px solid ${T.hairline}`, textAlign: 'center', color: T.inkMute }}>
          No quality data yet.
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ background: T.paper, borderRadius: 20, padding: 20, border: `1px solid ${T.hairline}` }}>
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>QUALITY · LAST 20 SESSIONS</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
          {scores.map((q, i) => {
            const c = q >= 80 ? T.sage : q >= 60 ? T.amber : T.coral;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${q}%`,
                  background: c,
                  borderRadius: 2,
                  minHeight: 4,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PainHeatmap({ pain }: { pain: PainCheckin[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const grid: { score: number | null; date: Date }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const hit = pain.find((p) => {
      const pd = tsToDate(p.createdAt);
      if (!pd) return false;
      pd.setHours(0, 0, 0, 0);
      return pd.getTime() === d.getTime();
    });
    grid.push({ score: hit?.score ?? null, date: d });
  }
  const painColor = (v: number | null) => {
    if (v === null) return T.mist;
    if (v <= 3) return T.sageLight;
    if (v <= 5) return '#F5E2C9';
    if (v <= 7) return T.amberLight;
    return T.coralLight;
  };
  const valid = grid.filter((g) => g.score !== null).map((g) => g.score as number);
  const avg = valid.length ? (valid.reduce((s, x) => s + x, 0) / valid.length).toFixed(1) : '—';

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div style={{ background: T.paper, borderRadius: 20, padding: 18, border: `1px solid ${T.hairline}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>PAIN LOG · 4 WEEKS</div>
            <div className="k-serif" style={{ fontSize: 18, color: T.ink }}>{valid.length} check-ins</div>
          </div>
          <span className="k-sans" style={{ fontSize: 11, color: T.sage, fontWeight: 600 }}>avg {avg}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {grid.map(({ score }, i) => (
            <div
              key={i}
              style={{
                aspectRatio: 1,
                borderRadius: 4,
                background: painColor(score),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                color: score && score > 6 ? T.ink : T.inkFaint,
                fontFamily: 'JetBrains Mono, monospace',
                border: `1px solid ${T.hairline}`,
              }}
            >
              {score ?? ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionList({ sessions }: { sessions: Session[] }) {
  return (
    <div style={{ padding: '14px 16px 0' }}>
      {sessions.length === 0 ? (
        <div style={{ background: T.paper, borderRadius: 20, padding: 24, border: `1px solid ${T.hairline}`, textAlign: 'center', color: T.inkMute }}>
          <div className="k-serif" style={{ fontSize: 18, color: T.ink, marginBottom: 4 }}>No sessions yet</div>
          <p style={{ fontSize: 12 }}>Run a session and your history will appear here.</p>
        </div>
      ) : (
        sessions.map((s) => {
          const peakROM = Math.max(0, ...(Object.values(s.peakRom) as number[]));
          const start = tsToDate(s.startedAt);
          const end = tsToDate(s.endedAt);
          const dur = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0;
          return (
            <div
              key={s.id}
              style={{
                background: T.paper,
                borderRadius: 16,
                padding: 14,
                marginBottom: 8,
                border: `1px solid ${T.hairline}`,
                display: 'grid',
                gridTemplateColumns: '1fr 0.7fr 0.5fr 0.5fr',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <div>
                <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>S-{s.id.slice(0, 6)}</div>
                <div className="k-sans" style={{ fontSize: 10, color: T.inkMute }}>{start?.toLocaleString() ?? '—'}</div>
              </div>
              <div className="k-mono" style={{ fontSize: 12, color: T.ink }}>{Math.round(peakROM)}°</div>
              <Pill color={s.avgQuality >= 80 ? T.sage : T.amber} bg={s.avgQuality >= 80 ? T.sageLight : T.amberLight}>
                {s.avgQuality}
              </Pill>
              <span className="k-mono" style={{ fontSize: 11, color: T.inkSoft }}>{dur}m</span>
            </div>
          );
        })
      )}
    </div>
  );
}
