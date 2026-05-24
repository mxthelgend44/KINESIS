'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, tsToDate } from '@kinesis/db';
import { getClinician, listCliniciansInClinic } from '@kinesis/db/queries/clinicians';
import { subscribeMessages, sendMessage, markMessagesRead } from '@kinesis/db/queries/messages';
import { usePatientProfile } from '@/components/PatientProfileProvider';
import type { Clinician, Message } from '@kinesis/db';

const T = {
  bone: '#FAF8F4',
  paper: '#FFFFFF',
  mist: '#F1EFE9',
  hairline: '#E5E1D8',
  teal: '#1A6B5A',
  tealMint: '#D7E8E1',
  tealDeep: '#114A3F',
  ink: '#0E1822',
  inkSoft: '#3A4654',
  inkMute: '#6B7785',
  inkFaint: '#9AA3AC',
  sage: '#5C8A6E',
};

export default function PatientMessages() {
  const auth = useAuth();
  const { patient } = usePatientProfile();
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let c: Clinician | null = null;
      if (patient.primaryClinicianId) {
        c = await getClinician(patient.primaryClinicianId);
      }
      if (!c) {
        const arr = await listCliniciansInClinic(patient.clinicId);
        c = arr[0] ?? null;
      }
      if (!cancelled) setClinician(c);
    })();
    return () => { cancelled = true; };
  }, [patient.clinicId, patient.primaryClinicianId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const unsub = subscribeMessages(auth.user.uid, setMessages);
    return unsub;
  }, [auth.status, auth.user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    const unread = messages.filter((m) => m.senderRole === 'clinician' && !m.readAt).map((m) => m.id);
    if (unread.length) {
      void markMessagesRead(unread);
    }
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !clinician || auth.status !== 'authenticated') return;
    setSending(true);
    try {
      await sendMessage({
        patientId: auth.user.uid,
        clinicianId: clinician.id,
        clinicId: clinician.clinicId,
        senderRole: 'patient',
        body: draft.trim(),
      });
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  if (!clinician) {
    return (
      <div style={{ background: T.bone, minHeight: '100vh', padding: 24, paddingTop: 80 }}>
        <div className="k-eyebrow" style={{ color: T.inkMute, marginBottom: 6 }}>MESSAGES</div>
        <h1 className="k-serif" style={{ fontSize: 24, marginBottom: 16 }}>
          No clinician assigned yet
        </h1>
        <p className="text-sm" style={{ color: T.inkMute }}>
          Once your clinic assigns a clinician to your care team, your conversation will appear here.
        </p>
      </div>
    );
  }

  const initials = clinician.fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ background: T.bone, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 54 }} />
      <div style={{ padding: '14px 24px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="k-sans" style={{ fontSize: 16, color: T.ink, fontWeight: 600 }}>
            {clinician.fullName}
          </div>
          <div className="k-mono" style={{ fontSize: 10, color: T.sage, marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: T.sage }} />
            CLINICIAN · {clinician.title ?? 'CARE TEAM'}
          </div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: T.tealMint, color: T.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
          {initials}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '0 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: T.inkMute, marginTop: 40 }}>
            <div className="k-serif" style={{ fontSize: 18, color: T.ink, marginBottom: 4 }}>
              Say hi 👋
            </div>
            <p className="text-sm">Send the first message to your care team.</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.senderRole === 'patient';
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
              {!mine && (
                <div style={{ width: 28, height: 28, borderRadius: 14, background: T.tealMint, color: T.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                  {initials}
                </div>
              )}
              <div
                style={{
                  maxWidth: '78%',
                  background: mine ? T.ink : T.paper,
                  color: mine ? '#fff' : T.ink,
                  padding: '10px 14px',
                  borderRadius: mine ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                  border: mine ? 'none' : `1px solid ${T.hairline}`,
                }}
              >
                <div className="k-sans" style={{ fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>
                <div className="k-mono" style={{ fontSize: 9, color: mine ? 'rgba(255,255,255,0.5)' : T.inkFaint, marginTop: 4, textAlign: 'right' }}>
                  {timeLabel(tsToDate(m.createdAt))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 80,
          left: 16,
          right: 16,
          maxWidth: 408,
          margin: '0 auto',
          background: T.paper,
          borderRadius: 24,
          padding: 6,
          border: `1px solid ${T.hairline}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Message ${clinician.fullName.split(' ')[0]}…`}
          disabled={sending}
          className="k-sans"
          style={{
            flex: 1,
            fontSize: 13,
            color: T.ink,
            padding: '0 12px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: T.teal,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !draft.trim() ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function timeLabel(d: Date | null): string {
  if (!d) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return d.toLocaleDateString();
}
