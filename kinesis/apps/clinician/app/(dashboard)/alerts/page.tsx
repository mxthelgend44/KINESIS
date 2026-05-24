'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { useClinicianProfile } from '@/components/ClinicianProfileProvider';
import { listAlertsForClinic } from '@kinesis/db/queries/alerts';
import { listPatientsInClinic } from '@kinesis/db/queries/patients';
import type { Alert, Patient } from '@kinesis/db';

const W = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  amber: '#D4824A',
  coral: '#C44545',
  ink: '#0E1822',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
  inkSoft: '#3A4654',
};

const sevColor = (s: 'critical' | 'warning' | 'info') =>
  s === 'critical' ? W.coral : s === 'warning' ? W.amber : W.teal;

export default function AlertsPage() {
  const { clinician } = useClinicianProfile();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [patientMap, setPatientMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [a, ps] = await Promise.all([
        listAlertsForClinic(clinician.clinicId, 200),
        listPatientsInClinic(clinician.clinicId),
      ]);
      if (cancelled) return;
      setAlerts(a);
      setPatientMap(new Map(ps.map((p: Patient) => [p.id, p.fullName])));
    })();
    return () => {
      cancelled = true;
    };
  }, [clinician.clinicId]);

  return (
    <>
      <TopBar crumbs={['Alerts']} />
      <div style={{ padding: '24px 28px', background: W.bone, minHeight: 'calc(100vh - 56px)' }}>
        <div className="k-eyebrow" style={{ color: W.inkMute, marginBottom: 6 }}>ACTIVE</div>
        <div className="k-serif" style={{ fontSize: 30, color: W.ink, letterSpacing: '-0.02em', marginBottom: 22 }}>
          Alerts
        </div>

        {alerts.length === 0 ? (
          <div style={{ background: W.paper, borderRadius: 14, padding: 28, textAlign: 'center', color: W.inkMute, border: `1px solid ${W.hairline}` }}>
            No alerts yet. Alerts are auto-generated from session anomalies.
          </div>
        ) : (
          <div style={{ background: W.paper, borderRadius: 14, border: `1px solid ${W.hairline}`, overflow: 'hidden' }}>
            {alerts.map((a, i) => (
              <Link key={a.id} href={`/patients/view?id=${a.patientId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div
                  style={{
                    padding: '16px 22px',
                    borderBottom: i < alerts.length - 1 ? `1px solid ${W.hairline}` : 'none',
                    borderLeft: `3px solid ${sevColor(a.severity)}`,
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 20,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                      <span className="k-eyebrow" style={{ color: sevColor(a.severity) }}>{a.severity.toUpperCase()}</span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: a.status === 'resolved' ? '#DDE7E0' : a.status === 'acknowledged' ? '#F1EFE9' : '#F5DCDC',
                          color: a.status === 'resolved' ? '#5C8A6E' : a.status === 'acknowledged' ? W.inkMute : W.coral,
                          fontWeight: 600,
                        }}
                      >
                        {a.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="k-sans" style={{ fontSize: 14, color: W.ink, fontWeight: 600, marginBottom: 2 }}>{a.title}</div>
                    <div className="k-sans" style={{ fontSize: 12, color: W.inkSoft }}>{patientMap.get(a.patientId) ?? '—'}</div>
                    {a.description && <div className="k-sans" style={{ fontSize: 11, color: W.inkMute, marginTop: 2 }}>{a.description}</div>}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={W.inkFaint} strokeWidth="2" strokeLinecap="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
