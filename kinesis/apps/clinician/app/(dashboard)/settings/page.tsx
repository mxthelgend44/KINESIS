'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { getClinic } from '@kinesis/db/queries/clinics';
import type { Clinic } from '@kinesis/db';

export default function SettingsPage() {
  const { clinician } = useClinicianProfile();
  const [clinic, setClinic] = useState<Clinic | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cl = await getClinic(clinician.clinicId);
      if (cancelled) return;
      setClinic(cl);
    })();
    return () => {
      cancelled = true;
    };
  }, [clinician.clinicId]);

  return (
    <>
      <TopBar crumbs={['Settings']} />
      <div style={{ padding: '24px 28px', background: '#FAF8F4', minHeight: 'calc(100vh - 56px)' }}>
        <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 6 }}>ACCOUNT</div>
        <h1 className="k-serif" style={{ fontSize: 30, color: '#0E1822', letterSpacing: '-0.02em', marginBottom: 22 }}>
          Settings
        </h1>

        <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
          <Card>
            <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 8 }}>PROFILE</div>
            <Row label="Name" value={clinician.fullName} />
            <Row label="Email" value={clinician.email} />
            <Row label="Title" value={clinician.title ?? '—'} />
          </Card>

          <Card>
            <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 8 }}>CLINIC</div>
            <Row label="Name" value={clinic?.name ?? '—'} />
            <Row label="Invite code" value={clinic?.inviteCode ?? '—'} mono />
          </Card>

          <Card>
            <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 8 }}>AI MODEL</div>
            <Row label="Patient pose model" value="MediaPipe Pose Landmarker · Full" />
            <Row label="Quality classifier" value="Rule-based v0.2 (TFLite swap planned)" />
          </Card>
        </div>
      </div>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#FFFFFF', borderRadius: 14, border: '1px solid #E5E1D8', padding: 20 }}>{children}</div>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed #E5E1D8' }}>
      <span style={{ fontSize: 12, color: '#6B7785' }}>{label}</span>
      <span className={mono ? 'k-mono' : 'k-sans'} style={{ fontSize: mono ? 13 : 14, color: '#0E1822', fontWeight: mono ? 600 : 500 }}>
        {value}
      </span>
    </div>
  );
}
