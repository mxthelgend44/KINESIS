'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@kinesis/ui';
import { useAuth, prettyFirestoreError, logRaw, tsToDate } from '@kinesis/db';
import {
  listMedicationsForPatient,
  prescribeMedication,
  deactivateMedication,
} from '@kinesis/db/queries/medications';
import {
  listAppointmentsForPatient,
  createAppointment,
  cancelAppointment,
} from '@kinesis/db/queries/appointments';
import type {
  Appointment,
  AppointmentType,
  Medication,
  MedicationFrequency,
  Patient,
} from '@kinesis/db';

const T = {
  paper: '#FFFFFF',
  hairline: '#E5E1D8',
  mist: '#F1EFE9',
  teal: '#1A6B5A',
  tealLight: '#E6F0EC',
  tealDeep: '#114A3F',
  amber: '#D4824A',
  amberLight: '#F5E8DC',
  coral: '#C44545',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
};

type Tab = 'meds' | 'appts';

type Props = {
  patient: Patient;
  open: boolean;
  onClose: () => void;
};

export function CareSheet({ patient, open, onClose }: Props) {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('meds');
  const [meds, setMeds] = useState<Medication[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState(false);

  // Medication form
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [medFreq, setMedFreq] = useState<MedicationFrequency>('twice-daily');
  const [medTimes, setMedTimes] = useState('08:00, 20:00');
  const [medNotes, setMedNotes] = useState('');
  const [medEndDate, setMedEndDate] = useState('');

  // Appointment form
  const [apptDate, setApptDate] = useState(defaultApptDate());
  const [apptTime, setApptTime] = useState('10:00');
  const [apptDuration, setApptDuration] = useState(30);
  const [apptType, setApptType] = useState<AppointmentType>('in-person');
  const [apptNotes, setApptNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient.id]);

  async function reload() {
    try {
      const [m, a] = await Promise.all([
        listMedicationsForPatient(patient.id),
        listAppointmentsForPatient(patient.id),
      ]);
      setMeds(m);
      setAppts(a);
    } catch (e) {
      logRaw('care-list', e);
      toast.error(prettyFirestoreError(e).title);
    }
  }

  const onPrescribeMed = async () => {
    if (auth.status !== 'authenticated' || busy) return;
    if (!medName.trim() || !medDose.trim()) {
      toast.error('Name and dose are required.');
      return;
    }
    setBusy(true);
    try {
      const times = medTimes
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
      await prescribeMedication({
        patientId: patient.id,
        clinicId: patient.clinicId,
        prescribedBy: auth.user.uid,
        name: medName.trim(),
        dose: medDose.trim(),
        frequency: medFreq,
        times,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: medEndDate || null,
        notes: medNotes.trim() || null,
      });
      toast.success(`Prescribed ${medName}`);
      setMedName('');
      setMedDose('');
      setMedTimes('08:00, 20:00');
      setMedNotes('');
      setMedEndDate('');
      await reload();
    } catch (e) {
      logRaw('med-create', e);
      toast.error(prettyFirestoreError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const onDeactivateMed = async (id: string) => {
    try {
      await deactivateMedication(id);
      toast.success('Medication deactivated');
      await reload();
    } catch (e) {
      logRaw('med-deactivate', e);
      toast.error(prettyFirestoreError(e).title);
    }
  };

  const onScheduleAppt = async () => {
    if (auth.status !== 'authenticated' || busy) return;
    const [yyyy, mm, dd] = apptDate.split('-').map(Number);
    const [hh, mi] = apptTime.split(':').map(Number);
    if (!yyyy || !mm || !dd || hh === undefined || mi === undefined) {
      toast.error('Invalid date or time.');
      return;
    }
    const scheduledAt = new Date(yyyy, mm - 1, dd, hh, mi);
    if (scheduledAt.getTime() < Date.now() - 60_000) {
      toast.error('Appointment is in the past.');
      return;
    }
    setBusy(true);
    try {
      await createAppointment({
        patientId: patient.id,
        clinicId: patient.clinicId,
        clinicianId: auth.user.uid,
        scheduledAt,
        durationMinutes: apptDuration,
        type: apptType,
        notes: apptNotes.trim() || null,
      });
      toast.success('Appointment scheduled');
      setApptNotes('');
      await reload();
    } catch (e) {
      logRaw('appt-create', e);
      toast.error(prettyFirestoreError(e).title);
    } finally {
      setBusy(false);
    }
  };

  const onCancelAppt = async (id: string) => {
    try {
      await cancelAppointment(id);
      toast.success('Appointment cancelled');
      await reload();
    } catch (e) {
      logRaw('appt-cancel', e);
      toast.error(prettyFirestoreError(e).title);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.paper,
          borderRadius: 18,
          maxWidth: 720,
          width: '100%',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: 24,
          border: `1px solid ${T.hairline}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 4 }}>Care plan</div>
            <div className="k-serif" style={{ fontSize: 22, color: T.ink, letterSpacing: '-0.01em' }}>
              Meds &amp; appointments — {patient.fullName}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: T.inkMute, cursor: 'pointer', padding: 4 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['meds', 'appts'] as Tab[]).map((id) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: active ? `1px solid ${T.teal}` : `1px solid ${T.hairline}`,
                  background: active ? T.teal : T.paper,
                  color: active ? '#fff' : T.ink,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {id === 'meds' ? 'Medications' : 'Appointments'}
              </button>
            );
          })}
        </div>

        {tab === 'meds' ? (
          <>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
              Active prescriptions · {meds.filter((m) => m.active).length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {meds.filter((m) => m.active).length === 0 ? (
                <div style={{ fontSize: 13, color: T.inkMute }}>No active medications.</div>
              ) : (
                meds
                  .filter((m) => m.active)
                  .map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: T.tealLight,
                        border: `1px solid ${T.hairline}`,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>
                          {m.name} · {m.dose}
                        </div>
                        <div className="k-mono" style={{ fontSize: 10, color: T.inkMute, marginTop: 1 }}>
                          {m.frequency} · {m.times.join(', ')}
                          {m.endDate ? ` · until ${m.endDate}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => onDeactivateMed(m.id)}
                        style={{ background: 'transparent', border: 'none', color: T.coral, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Deactivate
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
              New prescription
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="DRUG NAME" value={medName} onChange={setMedName} placeholder="Ibuprofen" />
              <Field label="DOSE" value={medDose} onChange={setMedDose} placeholder="400mg" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>
                  FREQUENCY
                </label>
                <select
                  value={medFreq}
                  onChange={(e) => setMedFreq(e.target.value as MedicationFrequency)}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', background: T.paper }}
                >
                  <option value="once-daily">Once daily</option>
                  <option value="twice-daily">Twice daily</option>
                  <option value="three-times-daily">3× daily</option>
                  <option value="four-times-daily">4× daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="as-needed">As needed</option>
                </select>
              </div>
              <Field
                label="TIMES (HH:MM, COMMA-SEPARATED)"
                value={medTimes}
                onChange={setMedTimes}
                placeholder="08:00, 20:00"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>
                  END DATE (OPTIONAL)
                </label>
                <input
                  type="date"
                  value={medEndDate}
                  onChange={(e) => setMedEndDate(e.target.value)}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                />
              </div>
              <Field label="NOTES" value={medNotes} onChange={setMedNotes} placeholder="Take with food" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onPrescribeMed}
                disabled={busy}
                style={{ padding: '10px 20px', borderRadius: 999, border: 'none', background: T.ink, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
              >
                {busy ? 'Saving…' : 'Prescribe'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
              Upcoming · {appts.filter((a) => a.status === 'scheduled').length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {appts.filter((a) => a.status === 'scheduled').length === 0 ? (
                <div style={{ fontSize: 13, color: T.inkMute }}>No upcoming appointments.</div>
              ) : (
                appts
                  .filter((a) => a.status === 'scheduled')
                  .map((a) => {
                    const d = tsToDate(a.scheduledAt);
                    return (
                      <div
                        key={a.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: T.tealLight, border: `1px solid ${T.hairline}` }}
                      >
                        <div style={{ flex: 1 }}>
                          <div className="k-sans" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>
                            {d ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                          </div>
                          <div className="k-mono" style={{ fontSize: 10, color: T.inkMute, marginTop: 1 }}>
                            {a.type} · {a.durationMinutes} min
                          </div>
                        </div>
                        <button
                          onClick={() => onCancelAppt(a.id)}
                          style={{ background: 'transparent', border: 'none', color: T.coral, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  })
              )}
            </div>

            <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 8 }}>
              Schedule new
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>DATE</label>
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>TIME</label>
                <input
                  type="time"
                  value={apptTime}
                  onChange={(e) => setApptTime(e.target.value)}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>DURATION (MIN)</label>
                <input
                  type="number"
                  value={apptDuration}
                  min={5}
                  max={240}
                  onChange={(e) => setApptDuration(Math.max(5, Math.min(240, Number(e.target.value) || 30)))}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>TYPE</label>
                <select
                  value={apptType}
                  onChange={(e) => setApptType(e.target.value as AppointmentType)}
                  style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', background: T.paper }}
                >
                  <option value="in-person">In-person</option>
                  <option value="tele">Video call</option>
                  <option value="home-visit">Home visit</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <Field label="NOTES" value={apptNotes} onChange={setApptNotes} placeholder="Follow-up — knee ROM check" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onScheduleAppt}
                disabled={busy}
                style={{ padding: '10px 20px', borderRadius: 999, border: 'none', background: T.ink, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
              >
                {busy ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="k-eyebrow" style={{ color: T.inkMute, display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', border: `1px solid ${T.hairline}`, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' }}
      />
    </div>
  );
}

function defaultApptDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
