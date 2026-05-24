'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@kinesis/db';
import { getClinic } from '@kinesis/db/queries/clinics';
import { getClinician } from '@kinesis/db/queries/clinicians';
import { usePatientProfile } from '@/components/PatientProfileProvider';
import type { Clinic, Clinician } from '@kinesis/db';

const T = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  tealMint: '#D7E8E1',
  amber: '#D4824A',
  coral: '#C44545',
  coralLight: '#F5DCDC',
  sage: '#5C8A6E',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

export default function PatientProfile() {
  const router = useRouter();
  const { patient } = usePatientProfile();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [clinician, setClinician] = useState<Clinician | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cl, cn] = await Promise.all([
        getClinic(patient.clinicId),
        patient.primaryClinicianId ? getClinician(patient.primaryClinicianId) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setClinic(cl);
      setClinician(cn);
    })();
    return () => { cancelled = true; };
  }, [patient.clinicId, patient.primaryClinicianId]);

  const onSignOut = async () => {
    await signOut();
    router.replace('/sign-in');
  };

  const initials = patient.fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ background: T.bone, minHeight: '100vh', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />

      <div style={{ padding: '14px 24px 6px' }}>
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>YOUR ACCOUNT</div>
        <div className="k-serif" style={{ fontSize: 32, color: T.ink, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          Profile &amp; <em style={{ color: T.teal }}>settings</em>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 18, padding: 18, border: `1px solid ${T.hairline}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 60, height: 60, borderRadius: 30, background: T.tealMint, color: T.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600 }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div className="k-sans" style={{ fontSize: 17, color: T.ink, fontWeight: 600 }}>{patient.fullName}</div>
            <div className="k-sans" style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>
              {patient.condition ?? 'No condition set'} · Week {patient.weekNum} / {patient.weekTotal}
            </div>
            <div className="k-mono" style={{ fontSize: 10, color: T.inkFaint, marginTop: 4 }}>
              PATIENT · {patient.id.slice(0, 8)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 18, padding: 18, border: `1px solid ${T.hairline}` }}>
          <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 10 }}>CARE TEAM</div>
          {clinician ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 19, background: T.tealMint, color: T.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
                {clinician.fullName.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>{clinician.fullName}</div>
                <div className="k-sans" style={{ fontSize: 11, color: T.inkMute }}>
                  {clinician.title ?? 'Clinician'} · {clinic?.name ?? '—'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm" style={{ color: T.inkMute }}>
              No clinician assigned yet. Your clinic will assign one shortly.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ background: T.paper, borderRadius: 18, padding: 4, border: `1px solid ${T.hairline}` }}>
          {[
            { icon: '◆', label: 'Tracking model', sub: 'MediaPipe Pose Landmarker · Full' },
            { icon: '◇', label: 'Privacy', sub: 'Pose runs on-device; only summaries leave your phone' },
            { icon: '↑', label: 'Pain check-in', sub: 'After every session' },
          ].map((row, i, a) => (
            <div key={row.label} style={{ padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: i < a.length - 1 ? `1px solid ${T.hairline}` : 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: T.mist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink, fontSize: 14, fontWeight: 600 }}>
                {row.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>{row.label}</div>
                <div className="k-sans" style={{ fontSize: 11, color: T.inkMute, marginTop: 1 }}>{row.sub}</div>
              </div>
            </div>
          ))}
          <button
            onClick={onSignOut}
            style={{ width: '100%', padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: T.coralLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.coral, fontSize: 14, fontWeight: 600 }}>
              ⊘
            </div>
            <div style={{ flex: 1 }}>
              <div className="k-sans" style={{ fontSize: 13, color: T.coral, fontWeight: 600 }}>Sign out</div>
              <div className="k-sans" style={{ fontSize: 11, color: T.inkMute, marginTop: 1 }}>
                You'll need to tap a new magic link to come back
              </div>
            </div>
          </button>
        </div>
      </div>

      <div style={{ padding: '14px 24px' }}>
        <div className="k-mono" style={{ fontSize: 10, color: T.inkFaint, textAlign: 'center' }}>
          KINESIS · v0.3 · Khalifa University
        </div>
      </div>
    </div>
  );
}
