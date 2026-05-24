'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProgressRing, Sparkline, Pill } from '@kinesis/ui';
import { PainCheckIn } from './pain-checkin';
import { useAuth, tsToDate } from '@kinesis/db';
import { listSessionsForPatient } from '@kinesis/db/queries/sessions';
import { listPainCheckins } from '@kinesis/db/queries/pain';
import { usePatientProfile } from '@/components/PatientProfileProvider';
import type { PainCheckin, Session } from '@kinesis/db';

const T = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealDeep: '#114A3F',
  tealMint: '#D7E8E1',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  sage: '#5C8A6E',
  sageLight: '#DDE7E0',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

export default function PatientHome() {
  const auth = useAuth();
  // Patient profile already loaded by the (app) layout — read from context
  // instead of refetching. Saves a Firestore round-trip on every nav.
  const { patient } = usePatientProfile();
  const [recent, setRecent] = useState<Session[]>([]);
  const [lastPain, setLastPain] = useState<PainCheckin | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    let cancelled = false;
    (async () => {
      const [s, pn] = await Promise.all([
        listSessionsForPatient(auth.user.uid),
        listPainCheckins(auth.user.uid, 1),
      ]);
      if (cancelled) return;
      setRecent(s.slice(0, 12));
      setLastPain(pn[0] ?? null);
    })();
    return () => { cancelled = true; };
  }, [auth.status, auth.user]);

  const last = recent[0];
  const lastRom = last ? Math.max(0, ...(Object.values(last.peakRom) as number[])) : 0;
  const lastQuality = last?.avgQuality ?? 0;
  const lastReps = last?.reps ?? 0;
  const lastDur = last ? sessionDurationMin(last) : 0;

  const trajectory = recent.slice(0, 11).reverse().map((s) => Math.max(0, ...(Object.values(s.peakRom) as number[])));
  const weekProgress = (patient.weekNum / Math.max(1, patient.weekTotal)) * 100;
  const romPct = Math.min(100, (lastRom / 120) * 100);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const sessionsThisWeek = recent.filter((s) => {
    const d = tsToDate(s.startedAt);
    return d && d >= startOfWeek;
  }).length;
  const weeklyPct = Math.min(100, (sessionsThisWeek / 5) * 100);

  return (
    <div style={{ background: T.bone, minHeight: '100vh', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />

      <div style={{ padding: '18px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>
            {dateLabel(patient.weekNum, patient.weekTotal)}
          </div>
          <div className="k-serif" style={{ fontSize: 30, lineHeight: 1.05, color: T.ink, letterSpacing: '-0.02em' }}>
            {greeting()},<br />
            <em style={{ color: T.teal }}>{firstName(patient.fullName)}</em>
          </div>
        </div>
        <Link
          href="/profile"
          style={{ width: 44, height: 44, borderRadius: 22, background: T.tealMint, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.tealDeep, fontWeight: 600, fontSize: 14, border: `1px solid ${T.hairline}`, textDecoration: 'none' }}
        >
          {initials(patient.fullName)}
        </Link>
      </div>

      <div style={{ padding: '12px 24px 4px' }}>
        <div className="k-eyebrow" style={{ color: T.inkFaint, marginBottom: 8 }}>
          RECOVERY · {patient.condition?.toUpperCase() ?? 'PROGRAM'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {Array.from({ length: patient.weekTotal }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: i < patient.weekNum - 1 ? T.teal : i === patient.weekNum - 1 ? T.amber : T.hairline,
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span className="k-mono" style={{ fontSize: 10, color: T.inkMute }}>WK 0</span>
          <span className="k-mono" style={{ fontSize: 10, color: T.amber, fontWeight: 600 }}>YOU · WK {patient.weekNum}</span>
          <span className="k-mono" style={{ fontSize: 10, color: T.inkMute }}>WK {patient.weekTotal}</span>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ background: T.ink, borderRadius: 22, padding: 22, color: '#fff', position: 'relative', overflow: 'hidden' }}>
          <svg width="180" height="180" style={{ position: 'absolute', right: -30, bottom: -50, opacity: 0.15 }} viewBox="0 0 180 180">
            <path d="M10 150 Q 90 10, 170 150" stroke="#7AB89A" strokeWidth="1.5" fill="none" />
            <path d="M30 150 Q 90 50, 150 150" stroke="#7AB89A" strokeWidth="1" fill="none" />
            <path d="M50 150 Q 90 80, 130 150" stroke="#7AB89A" strokeWidth="0.6" fill="none" />
          </svg>
          <div className="k-eyebrow" style={{ color: '#7AB89A', marginBottom: 10 }}>
            TODAY · {sessionsThisWeek} OF 5 THIS WEEK
          </div>
          <div className="k-serif" style={{ fontSize: 26, lineHeight: 1.15, marginBottom: 6, letterSpacing: '-0.01em' }}>
            Your rehabilitation<br />session
          </div>
          <div className="k-sans" style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 18 }}>
            Tap to begin · Vision-tracked
          </div>
          <Link
            href="/session"
            style={{ background: T.amber, color: '#fff', borderRadius: 14, padding: '14px 18px', width: '100%', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}
          >
            <span>Begin session</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 18, padding: '20px 16px', border: `1px solid ${T.hairline}`, display: 'flex', justifyContent: 'space-around' }}>
          <ProgressRing value={Math.round(romPct)} color={T.teal} label="ROM" sub={lastRom ? `${Math.round(lastRom)}° / 120°` : '— / 120°'} />
          <ProgressRing value={lastQuality} color={T.sage} label="QUALITY" sub={last ? 'last session' : 'no sessions yet'} />
          <ProgressRing value={Math.round(weeklyPct)} color={T.amber} label="WEEKLY" sub={`${sessionsThisWeek} of 5`} />
        </div>
      </div>

      {last && (
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ background: T.paper, borderRadius: 18, padding: 18, border: `1px solid ${T.hairline}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>
                  LAST SESSION · {relativeTimeShort(tsToDate(last.endedAt))}
                </div>
                <div className="k-serif" style={{ fontSize: 18, color: T.ink }}>
                  Peak ROM <em style={{ color: T.teal }}>{Math.round(lastRom)}°</em>
                </div>
              </div>
              <Pill color={lastQuality >= 80 ? T.sage : T.amber} bg={lastQuality >= 80 ? T.sageLight : T.amberLight}>
                ● {lastQuality >= 80 ? 'Good' : 'Watch'}
              </Pill>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 14, borderTop: `1px dashed ${T.hairline}` }}>
              <Metric label="QUALITY" value={lastQuality} />
              <Metric label="REPS" value={lastReps} />
              <Metric label="DURATION" value={lastDur} unit="m" />
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${T.hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="k-mono" style={{ fontSize: 10, color: T.inkFaint, marginBottom: 4 }}>
                  ROM · LAST {trajectory.length} SESSIONS
                </div>
                {trajectory.length > 1 ? (
                  <Sparkline data={trajectory} width={140} height={28} color={T.teal} showDots />
                ) : (
                  <span className="text-xs text-ink-mute">Need more sessions for trend.</span>
                )}
              </div>
              <Link href="/progress" style={{ fontSize: 12, color: T.teal, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                Details
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.teal} strokeWidth="2.4" strokeLinecap="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '14px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: T.amberLight, borderRadius: 18, padding: 16, border: `1px solid ${T.hairline}` }}>
          <div className="k-eyebrow" style={{ color: T.amber, marginBottom: 6 }}>STREAK</div>
          <div className="k-serif" style={{ fontSize: 36, color: T.ink, lineHeight: 1, letterSpacing: '-0.03em' }}>
            {streakDays(recent)}
          </div>
          <div className="k-sans" style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>consecutive days</div>
        </div>
        <div style={{ background: T.paper, borderRadius: 18, padding: 16, border: `1px solid ${T.hairline}` }}>
          <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 6 }}>CLINICIAN</div>
          <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600, lineHeight: 1.2 }}>Care team</div>
          <Link href="/messages" className="k-sans" style={{ fontSize: 11, color: T.teal, fontWeight: 600, marginTop: 6, display: 'inline-block', textDecoration: 'none' }}>
            Open messages →
          </Link>
        </div>
      </div>

      <PainCheckIn patientId={patient.id} lastPainScore={lastPain?.score} />
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div>
      <div className="k-mono" style={{ fontSize: 10, color: T.inkFaint, marginBottom: 2 }}>{label}</div>
      <div className="k-serif" style={{ fontSize: 22, color: T.ink }}>
        {value}
        {unit && <span style={{ fontSize: 13, color: T.inkMute }}>{unit}</span>}
      </div>
    </div>
  );
}

function sessionDurationMin(s: Session): number {
  const start = tsToDate(s.startedAt);
  const end = tsToDate(s.endedAt);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function dateLabel(weekNum: number, weekTotal: number) {
  const d = new Date();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()} · WEEK ${weekNum} / ${weekTotal}`;
}

function firstName(s: string) {
  return s.split(/\s+/)[0] ?? '';
}

function initials(s: string) {
  return s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function relativeTimeShort(d: Date | null): string {
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'JUST NOW';
  if (m < 60) return `${m} MIN AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} H AGO`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'YESTERDAY' : `${days} D AGO`;
}

function streakDays(sessions: Session[]): number {
  if (!sessions.length) return 0;
  const dates = new Set(
    sessions
      .map((s) => tsToDate(s.startedAt))
      .filter((d): d is Date => d !== null)
      .map((d) => d.toDateString()),
  );
  let streak = 0;
  const day = new Date();
  while (dates.has(day.toDateString())) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}
