'use client';

import { useEffect, useMemo, useState } from 'react';
import { ROMGauge, Pill } from '@kinesis/ui';
import { subscribeSessionSamples } from '@kinesis/db/queries/sessions';
import { subscribePrescriptionsForPatient, deactivatePrescription, listExercises } from '@kinesis/db/queries/exercises';
import { subscribeMessages, sendMessage } from '@kinesis/db/queries/messages';
import { tsToDate, useAuth } from '@kinesis/db';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { PrescribeSheet } from '@/components/PrescribeSheet';
import { CareSheet } from '@/components/CareSheet';
import type { Alert, Exercise, Message, Patient, Prescription, Session } from '@kinesis/db';

type TabKey = 'Overview' | 'Sessions' | 'Exercises' | 'Messages' | 'Notes';
const TABS: TabKey[] = ['Overview', 'Sessions', 'Exercises', 'Messages', 'Notes'];

const W = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealDeep: '#114A3F',
  tealLight: '#E6F0EC',
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
};

type Props = {
  patient: Patient;
  sessions: Session[];
  alerts: Alert[];
};

export function PatientDetailClient({ patient, sessions, alerts }: Props) {
  const liveSession = sessions.find((s) => s.isLive);
  const [liveAngles, setLiveAngles] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!liveSession) {
      setLiveAngles({});
      return;
    }
    const unsub = subscribeSessionSamples(liveSession.id, (sample) => {
      setLiveAngles(sample.joints);
    });
    return unsub;
  }, [liveSession?.id]);

  const trajectory = useMemo(() => {
    return sessions
      .filter((s) => !s.isLive)
      .map((s) => Math.max(0, ...(Object.values(s.peakRom) as number[])));
  }, [sessions]);
  const currentRom = trajectory[trajectory.length - 1] ?? 0;
  const priorRom = trajectory[trajectory.length - 2] ?? currentRom;
  const delta = Math.round(currentRom - priorRom);

  const qualityData = useMemo(() => {
    return sessions
      .filter((s) => !s.isLive)
      .slice(-20)
      .map((s) => {
        const score = s.avgQuality;
        const normal = Math.min(100, score);
        const comp = Math.max(0, 30 - score / 4 + (s.classification === 'compensatory' ? 25 : 0));
        const guard = Math.max(0, 20 - score / 5 + (s.classification === 'guarded' ? 25 : 0));
        return { normal, comp, guard };
      });
  }, [sessions]);

  const primary = liveSession?.jointKeys?.[0];
  const liveValue = primary ? liveAngles[primary] ?? 0 : 0;

  const [prescribeOpen, setPrescribeOpen] = useState(false);
  const [careOpen, setCareOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('Overview');

  return (
    <>
      <PatientHeader
        patient={patient}
        onPrescribe={() => setPrescribeOpen(true)}
        onCare={() => setCareOpen(true)}
      />
      <PrescribeSheet patientId={patient.id} open={prescribeOpen} onClose={() => setPrescribeOpen(false)} />
      <CareSheet patient={patient} open={careOpen} onClose={() => setCareOpen(false)} />
      {liveSession && <LiveBanner session={liveSession} primary={primary ?? 'right_knee'} liveValue={liveValue} />}

      <div style={{ padding: '20px 28px 0', borderBottom: `1px solid ${W.hairline}` }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  padding: '10px 0',
                  fontSize: 13,
                  fontWeight: 600,
                  color: active ? W.ink : W.inkMute,
                  borderBottom: active ? `2px solid ${W.teal}` : '2px solid transparent',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  borderBottomWidth: 2,
                  borderBottomStyle: 'solid',
                  borderBottomColor: active ? W.teal : 'transparent',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'Overview' && (
        <>
          <div style={{ padding: 28, display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
            <RomChart trajectory={trajectory} currentRom={currentRom} delta={delta} />
            <SidePanel patient={patient} alerts={alerts} sessions={sessions} />
          </div>
          <div style={{ padding: '0 28px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <QualityCard data={qualityData} />
            <RecentSessionsCard sessions={sessions.filter((s) => !s.isLive).slice(-5).reverse()} />
          </div>
        </>
      )}
      {tab === 'Sessions' && (
        <div style={{ padding: 28 }}>
          <SessionsTab sessions={sessions.filter((s) => !s.isLive).reverse()} />
        </div>
      )}
      {tab === 'Exercises' && (
        <div style={{ padding: 28 }}>
          <ExercisesTab patientId={patient.id} onPrescribe={() => setPrescribeOpen(true)} />
        </div>
      )}
      {tab === 'Messages' && (
        <div style={{ padding: 28 }}>
          <MessagesTab patient={patient} />
        </div>
      )}
      {tab === 'Notes' && (
        <div style={{ padding: 28 }}>
          <NotesTab patient={patient} sessions={sessions} />
        </div>
      )}
    </>
  );
}

function PatientHeader({ patient, onPrescribe, onCare }: { patient: Patient; onPrescribe: () => void; onCare: () => void }) {
  const initials = patient.fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      style={{
        background: W.paper,
        padding: '20px 28px',
        borderBottom: `1px solid ${W.hairline}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: W.tealMint, color: W.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600 }}>{initials}</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span className="k-serif" style={{ fontSize: 26, color: W.ink, letterSpacing: '-0.02em' }}>{patient.fullName}</span>
            <Pill color={W.tealDeep} bg={W.tealMint}>{patient.id.slice(0, 8)}</Pill>
          </div>
          <div className="k-sans" style={{ fontSize: 13, color: W.inkMute, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {patient.age && (
              <>
                <span>{patient.age} yrs · {patient.sex ?? '—'}</span>
                <span style={{ color: W.inkFaint }}>·</span>
              </>
            )}
            <span>{patient.condition ?? 'Pending condition'}</span>
            <span style={{ color: W.inkFaint }}>·</span>
            <span>Week <strong style={{ color: W.ink }}>{patient.weekNum} of {patient.weekTotal}</strong></span>
            {patient.surgeryDate && (
              <>
                <span style={{ color: W.inkFaint }}>·</span>
                <span>Surgery {new Date(patient.surgeryDate).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {['Message', 'Prescribe', 'Care plan', 'Notes', 'Generate report'].map((b, i, arr) => (
          <button
            key={b}
            onClick={b === 'Prescribe' ? onPrescribe : b === 'Care plan' ? onCare : undefined}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: i === arr.length - 1 ? 'none' : `1px solid ${W.hairline}`,
              background: i === arr.length - 1 ? W.ink : W.paper,
              color: i === arr.length - 1 ? '#fff' : W.ink,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}

function LiveBanner({ session, primary, liveValue }: { session: Session; primary: string; liveValue: number }) {
  const startedAt = tsToDate(session.startedAt);
  const elapsedSec = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)) : 0;
  const min = Math.floor(elapsedSec / 60);
  const sec = (elapsedSec % 60).toString().padStart(2, '0');
  return (
    <div style={{ padding: '16px 28px 0' }}>
      <div style={{ background: W.ink, borderRadius: 14, padding: '18px 22px', color: '#fff', display: 'flex', alignItems: 'center', gap: 24, position: 'relative', overflow: 'hidden' }}>
        <svg width="200" height="120" style={{ position: 'absolute', right: 20, top: 8, opacity: 0.1 }} viewBox="0 0 200 120">
          <path d="M10 100 Q 100 0, 190 100" stroke="#7AB89A" strokeWidth="1" fill="none" />
        </svg>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="k-pulse" style={{ width: 7, height: 7, borderRadius: 4, background: '#5BD6A0', boxShadow: '0 0 8px #5BD6A0' }} />
            <span className="k-eyebrow" style={{ color: '#5BD6A0' }}>
              SESSION IN PROGRESS · {min.toString().padStart(2, '0')}:{sec}
            </span>
          </div>
          <div className="k-serif" style={{ fontSize: 18, color: '#fff' }}>
            {primary.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </div>
          <div className="k-sans" style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
            Streaming · Vision tracking · realtime
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 28 }}>
          <ROMGauge current={liveValue} targetMin={80} targetMax={120} size={140} dark showTicks={false} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>REPS</div>
              <div className="k-serif" style={{ fontSize: 28, color: '#fff', lineHeight: 1 }}>{session.reps}</div>
            </div>
            <div>
              <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>QUALITY</div>
              <div className="k-serif" style={{ fontSize: 28, color: '#7AB89A', lineHeight: 1 }}>{session.avgQuality}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RomChart({ trajectory, currentRom, delta }: { trajectory: number[]; currentRom: number; delta: number }) {
  const W_C = 720;
  const H_C = 220;
  if (trajectory.length === 0) {
    return (
      <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}`, textAlign: 'center', color: W.inkMute }}>
        <div className="k-serif" style={{ fontSize: 20, color: W.ink }}>No completed sessions yet</div>
        <p className="text-sm" style={{ marginTop: 6 }}>The ROM trajectory will appear after the patient's first session.</p>
      </div>
    );
  }
  const xStep = W_C / Math.max(1, trajectory.length - 1);
  const yMin = 30;
  const yMax = Math.max(140, Math.ceil((Math.max(...trajectory) + 10) / 10) * 10);
  const toY = (v: number) => H_C - ((v - yMin) / (yMax - yMin)) * (H_C - 30) - 15;

  const pts = trajectory.map((v, i) => [i * xStep, toY(v)] as const);
  const linePath = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');

  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>RANGE OF MOTION · PEAK PER SESSION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="k-serif" style={{ fontSize: 38, color: W.ink, letterSpacing: '-0.03em', lineHeight: 1 }}>{Math.round(currentRom)}°</span>
            {delta !== 0 && (
              <span className="k-sans" style={{ fontSize: 12, color: delta > 0 ? W.sage : W.coral, fontWeight: 600 }}>
                {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}° vs prior
              </span>
            )}
          </div>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W_C} ${H_C + 22}`} style={{ display: 'block' }}>
        {[40, 80, 120].map((v) => (
          <g key={v}>
            <line x1="0" x2={W_C} y1={toY(v)} y2={toY(v)} stroke={W.hairline} strokeWidth="0.5" strokeDasharray="2 4" />
            <text x="0" y={toY(v) - 3} className="k-mono" style={{ fontSize: 9, fill: W.inkFaint }}>{v}°</text>
          </g>
        ))}
        <path d={linePath} stroke={W.teal} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 1.8} fill={i === pts.length - 1 ? W.amber : W.teal} stroke={i === pts.length - 1 ? W.paper : 'none'} strokeWidth="2" />
        ))}
        <text x="0" y={H_C + 18} className="k-mono" style={{ fontSize: 9, fill: W.inkFaint }}>SESSION 1</text>
        <text x={W_C} y={H_C + 18} textAnchor="end" className="k-mono" style={{ fontSize: 9, fill: W.inkFaint }}>SESSION {trajectory.length}</text>
      </svg>
    </div>
  );
}

function SidePanel({
  patient,
  alerts,
  sessions,
}: {
  patient: Patient;
  alerts: Alert[];
  sessions: Session[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: W.tealLight, borderRadius: 14, padding: 20, border: `1px solid ${W.tealMint}` }}>
        <div className="k-eyebrow" style={{ color: W.tealDeep, marginBottom: 10 }}>◆ AI INSIGHT</div>
        <div className="k-serif" style={{ fontSize: 15, color: W.ink, lineHeight: 1.45, letterSpacing: '-0.005em' }}>
          {(() => {
            const withSummary = [...sessions].reverse().find(
              (s) => !s.isLive && s.aiSummary && s.aiSummary.trim().length > 0,
            );
            if (withSummary?.aiSummary) return withSummary.aiSummary;
            return `${patient.fullName.split(' ')[0]} is in week ${patient.weekNum} of ${patient.weekTotal}. AI commentary will surface once the patient has logged a few sessions.`;
          })()}
        </div>
      </div>

      <div style={{ background: W.paper, borderRadius: 14, padding: 18, border: `1px solid ${W.hairline}` }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 12 }}>RECENT ALERTS</div>
        {alerts.length === 0 ? (
          <div className="text-sm" style={{ color: W.inkMute }}>No alerts on file.</div>
        ) : (
          alerts.slice(0, 4).map((a) => (
            <div key={a.id} style={{ padding: '8px 0', borderBottom: `1px dashed ${W.hairline}` }}>
              <div className="k-eyebrow" style={{ color: a.severity === 'critical' ? W.coral : a.severity === 'warning' ? W.amber : W.teal }}>{a.severity.toUpperCase()}</div>
              <div className="k-sans" style={{ fontSize: 12, color: W.ink, fontWeight: 600 }}>{a.title}</div>
              {a.description && <div className="k-sans" style={{ fontSize: 11, color: W.inkMute, marginTop: 1 }}>{a.description}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function QualityCard({ data }: { data: Array<{ normal: number; comp: number; guard: number }> }) {
  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
      <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>MOVEMENT CLASSIFICATION · LAST 20 SESSIONS</div>
      <div className="k-serif" style={{ fontSize: 22, color: W.ink, marginBottom: 16 }}>Quality trend</div>
      {data.length === 0 ? (
        <div className="text-sm" style={{ color: W.inkMute, textAlign: 'center', padding: 20 }}>No sessions yet.</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 130 }}>
            {data.map((q, i) => {
              const total = q.normal + q.comp + q.guard || 1;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%' }}>
                  <div style={{ height: `${(q.normal / total) * 100}%`, background: W.sage }} />
                  <div style={{ height: `${(q.comp / total) * 100}%`, background: W.amber }} />
                  <div style={{ height: `${(q.guard / total) * 100}%`, background: W.coral }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${W.hairline}`, flexWrap: 'wrap' }}>
            <LegendDot color={W.sage} label="Normal" />
            <LegendDot color={W.amber} label="Compensatory" />
            <LegendDot color={W.coral} label="Guarded" />
          </div>
        </>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 10, height: 10, background: color }} />
      <span className="k-sans" style={{ fontSize: 11, color: W.inkSoft }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Tab content
// ─────────────────────────────────────────────────────────────────────

function SessionsTab({ sessions }: { sessions: Session[] }) {
  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
      <div style={{ marginBottom: 14 }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>ALL SESSIONS</div>
        <div className="k-serif" style={{ fontSize: 22, color: W.ink }}>{sessions.length} recorded</div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-sm" style={{ color: W.inkMute, textAlign: 'center', padding: 20 }}>No sessions yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, padding: '8px 0', borderBottom: `1px solid ${W.hairline}`, fontSize: 10, color: W.inkFaint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <div>Session</div><div>Peak ROM</div><div>Quality</div><div>Reps</div><div>Classification</div>
        </div>
      )}
      {sessions.map((s, i, arr) => {
        const peak = Math.max(0, ...(Object.values(s.peakRom) as number[]));
        const startedAt = tsToDate(s.startedAt);
        return (
          <div
            key={s.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
              gap: 8,
              padding: '12px 0',
              alignItems: 'center',
              borderBottom: i < arr.length - 1 ? `1px solid ${W.hairline}` : 'none',
            }}
          >
            <div>
              <div className="k-sans" style={{ fontSize: 13, color: W.ink, fontWeight: 600 }}>S-{s.id.slice(0, 6)}</div>
              <div className="k-sans" style={{ fontSize: 11, color: W.inkMute }}>
                {startedAt ? startedAt.toLocaleString() : '—'}
              </div>
            </div>
            <div className="k-mono" style={{ fontSize: 13, color: W.ink }}>{Math.round(peak)}°</div>
            <Pill color={s.avgQuality >= 80 ? W.sage : W.amber} bg={s.avgQuality >= 80 ? W.sageLight : W.amberLight}>{s.avgQuality}</Pill>
            <span className="k-mono" style={{ fontSize: 12, color: W.inkSoft }}>{s.reps}</span>
            <span className="k-mono" style={{ fontSize: 11, color: W.inkMute, textTransform: 'capitalize' }}>{s.classification ?? '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExercisesTab({ patientId, onPrescribe }: { patientId: string; onPrescribe: () => void }) {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);

  useEffect(() => {
    const unsub = subscribePrescriptionsForPatient(patientId, setPrescriptions);
    return () => unsub();
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    listExercises().then((ex) => {
      if (!cancelled) setExercises(ex);
    });
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => {
    const m: Record<string, Exercise> = {};
    for (const e of exercises) m[e.id] = e;
    return m;
  }, [exercises]);

  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>ACTIVE PRESCRIPTIONS</div>
          <div className="k-serif" style={{ fontSize: 22, color: W.ink }}>{prescriptions.length} on plan</div>
        </div>
        <button
          type="button"
          onClick={onPrescribe}
          style={{ background: W.ink, color: W.paper, padding: '8px 14px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          + Prescribe
        </button>
      </div>
      {prescriptions.length === 0 ? (
        <div style={{ color: W.inkMute, textAlign: 'center', padding: 20, fontSize: 13 }}>
          No active prescriptions. Click Prescribe to assign an exercise.
        </div>
      ) : prescriptions.map((p, i, arr) => {
        const ex = byId[p.exerciseId];
        return (
          <div
            key={p.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 0.8fr 0.8fr 0.8fr auto',
              gap: 12,
              padding: '14px 0',
              alignItems: 'center',
              borderBottom: i < arr.length - 1 ? `1px solid ${W.hairline}` : 'none',
            }}
          >
            <div>
              <div className="k-sans" style={{ fontSize: 14, color: W.ink, fontWeight: 600 }}>{ex?.name ?? p.exerciseId}</div>
              {p.notes && <div style={{ fontSize: 11, color: W.inkMute, marginTop: 2 }}>{p.notes}</div>}
            </div>
            <div className="k-mono" style={{ fontSize: 12, color: W.inkSoft }}>{p.sets}×{p.reps}</div>
            <div className="k-mono" style={{ fontSize: 12, color: W.inkSoft }}>{p.frequencyPerWeek}/wk</div>
            <Pill color={W.tealDeep} bg={W.tealMint}>{ex?.difficulty ?? '—'}</Pill>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Remove "${ex?.name ?? p.exerciseId}" from this patient's plan?`)) {
                  void deactivatePrescription(p.id);
                }
              }}
              style={{ background: 'transparent', border: `1px solid ${W.hairline}`, color: W.inkMute, padding: '6px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer' }}
            >
              Remove
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MessagesTab({ patient }: { patient: Patient }) {
  const auth = useAuth();
  const { clinician } = useClinicianProfile();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const unsub = subscribeMessages(patient.id, setMessages);
    return () => unsub();
  }, [patient.id]);

  const send = async () => {
    if (!draft.trim() || auth.status !== 'authenticated') return;
    setSending(true);
    try {
      await sendMessage({
        patientId: patient.id,
        clinicianId: clinician.id,
        clinicId: patient.clinicId,
        senderRole: 'clinician',
        body: draft.trim(),
      });
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}`, display: 'flex', flexDirection: 'column', minHeight: 480 }}>
      <div style={{ marginBottom: 14 }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>MESSAGES</div>
        <div className="k-serif" style={{ fontSize: 22, color: W.ink }}>Direct thread</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12 }}>
        {messages.length === 0 ? (
          <div style={{ color: W.inkMute, textAlign: 'center', padding: 40, fontSize: 13 }}>
            No messages yet. Send the first one below.
          </div>
        ) : messages.map((m) => {
          const mine = m.senderRole === 'clinician';
          const ts = tsToDate(m.createdAt);
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{
                background: mine ? W.tealMint : W.mist,
                color: W.ink,
                padding: '10px 14px',
                borderRadius: 14,
                maxWidth: '70%',
                fontSize: 13,
                lineHeight: 1.4,
              }}>
                <div>{m.body}</div>
                <div style={{ fontSize: 10, color: W.inkMute, marginTop: 4 }}>
                  {ts ? ts.toLocaleString() : '—'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: `1px solid ${W.hairline}` }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={`Message ${patient.fullName.split(' ')[0]}…`}
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${W.hairline}`, fontSize: 13, background: W.bone, color: W.ink, outline: 'none' }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          style={{
            background: draft.trim() ? W.teal : W.mist,
            color: draft.trim() ? W.paper : W.inkMute,
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function NotesTab({ patient, sessions }: { patient: Patient; sessions: Session[] }) {
  const withNotes = sessions
    .filter((s) => !s.isLive && (s.notes || s.aiSummary))
    .reverse();
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>CONDITION</div>
        <div className="k-serif" style={{ fontSize: 22, color: W.ink, marginBottom: 8 }}>
          {patient.condition ?? 'No condition recorded'}
        </div>
        <div style={{ fontSize: 13, color: W.inkMute }}>
          Week {patient.weekNum} of {patient.weekTotal} · Compliance{' '}
          <strong style={{ color: patient.compliance === 'green' ? W.sage : patient.compliance === 'amber' ? W.amber : W.coral }}>
            {patient.compliance}
          </strong>
        </div>
      </div>
      <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>SESSION NOTES</div>
        <div className="k-serif" style={{ fontSize: 18, color: W.ink, marginBottom: 14 }}>
          {withNotes.length} sessions with notes
        </div>
        {withNotes.length === 0 ? (
          <div style={{ color: W.inkMute, textAlign: 'center', padding: 20, fontSize: 13 }}>
            No notes on any sessions yet.
          </div>
        ) : withNotes.map((s, i, arr) => {
          const ts = tsToDate(s.startedAt);
          return (
            <div
              key={s.id}
              style={{ padding: '14px 0', borderBottom: i < arr.length - 1 ? `1px solid ${W.hairline}` : 'none' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div className="k-sans" style={{ fontSize: 12, color: W.ink, fontWeight: 600 }}>
                  S-{s.id.slice(0, 6)}
                </div>
                <div className="k-mono" style={{ fontSize: 10, color: W.inkMute }}>
                  {ts ? ts.toLocaleString() : '—'}
                </div>
              </div>
              {s.aiSummary && (
                <div style={{ background: W.mist, padding: '8px 10px', borderRadius: 8, fontSize: 12, color: W.inkSoft, marginBottom: 6, fontStyle: 'italic' }}>
                  AI summary — {s.aiSummary}
                </div>
              )}
              {s.notes && (
                <div style={{ fontSize: 13, color: W.ink, lineHeight: 1.5 }}>{s.notes}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentSessionsCard({ sessions }: { sessions: Session[] }) {
  return (
    <div style={{ background: W.paper, borderRadius: 14, padding: 22, border: `1px solid ${W.hairline}` }}>
      <div style={{ marginBottom: 14 }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 4 }}>RECENT SESSIONS</div>
        <div className="k-serif" style={{ fontSize: 22, color: W.ink }}>Last 5 sessions</div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-sm" style={{ color: W.inkMute, textAlign: 'center', padding: 20 }}>No sessions yet.</div>
      ) : (
        sessions.map((s, i, arr) => {
          const peak = Math.max(0, ...(Object.values(s.peakRom) as number[]));
          const startedAt = tsToDate(s.startedAt);
          return (
            <div
              key={s.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 0.7fr 0.5fr 0.5fr',
                gap: 8,
                padding: '10px 0',
                alignItems: 'center',
                borderBottom: i < arr.length - 1 ? `1px solid ${W.hairline}` : 'none',
              }}
            >
              <div>
                <div className="k-sans" style={{ fontSize: 12, color: W.ink, fontWeight: 600 }}>S-{s.id.slice(0, 6)}</div>
                <div className="k-sans" style={{ fontSize: 10, color: W.inkMute }}>
                  {startedAt ? startedAt.toLocaleString() : '—'}
                </div>
              </div>
              <div className="k-mono" style={{ fontSize: 12, color: W.ink }}>{Math.round(peak)}°</div>
              <Pill color={s.avgQuality >= 80 ? W.sage : W.amber} bg={s.avgQuality >= 80 ? W.sageLight : W.amberLight}>{s.avgQuality}</Pill>
              <span className="k-mono" style={{ fontSize: 11, color: W.inkSoft }}>{s.reps}r</span>
            </div>
          );
        })
      )}
    </div>
  );
}
