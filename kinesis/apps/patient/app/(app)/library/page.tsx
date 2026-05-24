'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@kinesis/db';
import { listExercises, subscribePrescriptionsForPatient } from '@kinesis/db/queries/exercises';
import type { Exercise, Prescription } from '@kinesis/db';

const T = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  tealMint: '#D7E8E1',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  coral: '#C44545',
  sage: '#5C8A6E',
  ink: '#0E1822',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

export default function PatientLibrary() {
  const auth = useAuth();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [prescribedIds, setPrescribedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    listExercises().then(setExercises);
    const unsub = subscribePrescriptionsForPatient(auth.user.uid, (pr) => {
      setPrescribedIds(new Set((pr as Prescription[]).map((p) => p.exerciseId)));
    });
    return unsub;
  }, [auth.status, auth.user]);

  return (
    <div style={{ background: T.bone, minHeight: '100vh', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />
      <div style={{ padding: '14px 24px 0' }}>
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>
          {prescribedIds.size > 0 ? `${prescribedIds.size} PRESCRIBED` : 'CATALOG'}
        </div>
        <div className="k-serif" style={{ fontSize: 32, color: T.ink, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          Exercise <em style={{ color: T.teal }}>library</em>
        </div>
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        {exercises.map((e) => {
          const isRx = prescribedIds.has(e.id);
          const tag = e.category === 'leg' ? 'KNEE' : e.category === 'arm' ? 'ARM' : 'ALL';
          const tagColors = {
            KNEE: { bg: T.tealLight, fg: T.tealDeep },
            ARM: { bg: T.tealMint, fg: T.tealDeep },
            ALL: { bg: T.amberLight, fg: T.amber },
          }[tag];
          return (
            <Link key={e.id} href={`/session?exercise=${e.id}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: T.paper,
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 8,
                  border: `1px solid ${T.hairline}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    flexShrink: 0,
                    background: `repeating-linear-gradient(45deg, ${tagColors.bg}, ${tagColors.bg} 6px, ${T.paper} 6px, ${T.paper} 8px)`,
                    border: `1px solid ${T.hairline}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      background: tagColors.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={tagColors.fg}>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.name}
                    </div>
                    {isRx && (
                      <span style={{ padding: '2px 6px', borderRadius: 4, background: T.amber, color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>
                        RX
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <DifficultyPill diff={e.difficulty} />
                    {e.durationMin && <span className="k-mono" style={{ fontSize: 10, color: T.inkMute }}>{e.durationMin} min</span>}
                    {e.targetRom && <span className="k-mono" style={{ fontSize: 10, color: T.inkMute }}>0–{e.targetRom}°</span>}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.inkFaint} strokeWidth="2" strokeLinecap="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DifficultyPill({ diff }: { diff: 'beginner' | 'intermediate' | 'advanced' }) {
  const c = diff === 'beginner' ? T.sage : diff === 'intermediate' ? T.amber : T.coral;
  const count = diff === 'beginner' ? 1 : diff === 'intermediate' ? 2 : 3;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{ width: 4, height: 8, borderRadius: 1, background: i <= count ? c : T.hairline }}
        />
      ))}
      <span className="k-sans" style={{ fontSize: 10, color: c, fontWeight: 600, marginLeft: 2, textTransform: 'capitalize' }}>
        {diff}
      </span>
    </span>
  );
}
