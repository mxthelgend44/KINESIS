'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '@kinesis/ui';

export function InvitePatientForm({
  clinicName,
  inviteCode,
}: {
  clinicName: string;
  inviteCode: string;
}) {
  const toast = useToast();

  const patientUrl = (() => {
    if (typeof window === 'undefined') return `https://app.kinesis.health/sign-up?clinic=${inviteCode}`;
    const explicit = process.env.NEXT_PUBLIC_PATIENT_URL;
    if (explicit) return `${explicit.replace(/\/$/, '')}/sign-up?clinic=${inviteCode}`;
    const origin = window.location.origin;
    const swapped = origin
      .replace('://clinician.', '://app.')
      .replace(':3000', ':3001');
    return `${swapped}/sign-up?clinic=${inviteCode}`;
  })();

  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — please copy manually");
    }
  };

  const onShare = async () => {
    const shareData = {
      title: `Join ${clinicName} on KINESIS`,
      text: `Hi! Use this link to set up your KINESIS patient account. Clinic invite code: ${inviteCode}`,
      url: patientUrl,
    };
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled — no-op
      }
    } else {
      await copy('share', patientUrl);
    }
  };

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E5E1D8', borderRadius: 14, padding: 20 }}>
      <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 4 }}>CLINIC</div>
      <div className="k-serif" style={{ fontSize: 20, color: '#0E1822' }}>{clinicName}</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 22,
          alignItems: 'center',
          marginTop: 20,
          padding: 18,
          borderRadius: 12,
          background: '#FAF8F4',
          border: '1px solid #E5E1D8',
        }}
      >
        <div
          style={{
            background: '#fff',
            padding: 10,
            borderRadius: 10,
            border: '1px solid #E5E1D8',
            display: 'inline-flex',
          }}
        >
          <QRCodeSVG
            value={patientUrl}
            size={144}
            level="M"
            fgColor="#0E1822"
            bgColor="#FFFFFF"
          />
        </div>
        <div>
          <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 6 }}>
            INVITE CODE
          </div>
          <code
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 22,
              fontWeight: 700,
              color: '#0E1822',
              letterSpacing: '0.05em',
              display: 'block',
              marginBottom: 12,
            }}
          >
            {inviteCode}
          </code>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => copy('code', inviteCode)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #E5E1D8',
                background: '#FFFFFF',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {copied === 'code' ? '✓ Copied' : 'Copy code'}
            </button>
            <button
              onClick={() => copy('link', patientUrl)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #E5E1D8',
                background: '#FFFFFF',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {copied === 'link' ? '✓ Copied' : 'Copy link'}
            </button>
            <button
              onClick={onShare}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#0E1822',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share
            </button>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#6B7785', marginTop: 16, lineHeight: 1.5 }}>
        Have the patient scan the QR code with their phone camera, tap the link you share, or type
        the invite code on the patient app sign-up page. They'll show up on your cohort table as
        soon as they finish onboarding.
      </p>
    </div>
  );
}
