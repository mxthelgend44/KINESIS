'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { getClinic } from '@kinesis/db/queries/clinics';
import { InvitePatientForm } from './invite-form';
import type { Clinic } from '@kinesis/db';

export default function InvitePatient() {
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
      <TopBar crumbs={['Patients', 'Invite']} />
      <div style={{ background: '#FAF8F4', minHeight: 'calc(100vh - 56px)', padding: '24px 28px' }}>
        <div style={{ maxWidth: 560 }}>
          <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 6 }}>NEW PATIENT</div>
          <h1 className="k-serif" style={{ fontSize: 30, color: '#0E1822', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Invite a patient
          </h1>
          <p style={{ fontSize: 13, color: '#6B7785', marginBottom: 20 }}>
            Share your clinic invite code so the patient can sign up on their phone. You'll see them on
            the cohort once they complete onboarding.
          </p>

          {clinic ? (
            <InvitePatientForm clinicName={clinic.name} inviteCode={clinic.inviteCode} />
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E5E1D8', borderRadius: 12, padding: 16, color: '#6B7785' }}>
              Loading clinic…
            </div>
          )}
        </div>
      </div>
    </>
  );
}
