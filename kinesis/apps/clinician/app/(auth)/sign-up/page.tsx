'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KinesisWordmark } from '@kinesis/ui';
import {
  signUpWithPassword,
  useAuth,
  prettyAuthError,
  prettyFirestoreError,
  logRaw,
} from '@kinesis/db';
import { createClinic } from '@kinesis/db/queries/clinics';
import { provisionClinician } from '@kinesis/db/queries/clinicians';

export default function SignUp() {
  const router = useRouter();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  // Only redirect existing users who arrive at /sign-up. Do not auto-redirect
  // during an in-progress sign-up — Firebase Auth flips to "authenticated" the
  // moment createUserWithEmailAndPassword resolves, which races the Firestore
  // provisioning writes below and lands the user on the dashboard before
  // their clinician doc exists.
  useEffect(() => {
    if (auth.status === 'authenticated' && !busy) router.replace('/');
  }, [auth.status, router, busy]);

  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setErr(null);
    setStatus('Creating your account…');
    try {
      // 1. Create the auth user. After this resolves, the user is signed in
      //    and request.auth.uid is set, which Firestore rules require for
      //    the next two writes.
      const user = await signUpWithPassword(email, password, fullName);

      setStatus('Setting up your clinic…');
      try {
        // 2. Create a clinic for this clinician.
        const clinic = await createClinic(clinicName || `${lastName(fullName)} Clinic`);

        setStatus('Finishing your profile…');
        // 3. Provision the clinician profile pointing at that clinic.
        await provisionClinician({
          uid: user.uid,
          clinicId: clinic.id,
          fullName,
          email: user.email ?? email,
          title: title || null,
        });
        router.replace('/');
      } catch (firestoreErr: unknown) {
        logRaw('signup-provision', firestoreErr);
        const f = prettyFirestoreError(firestoreErr);
        setErr(`${f.title}. ${f.message}`);
        setBusy(false);
      }
    } catch (authErr: unknown) {
      logRaw('signup-auth', authErr);
      const f = prettyAuthError(authErr);
      setErr(`${f.title}. ${f.message}`);
      setBusy(false);
    }
    // Note: don't setBusy(false) on the success path — we're navigating away.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bone px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <KinesisWordmark size={14} />
        </div>
        <div className="k-eyebrow text-ink-mute mb-2">CLINICIAN</div>
        <h1 className="k-serif text-3xl leading-tight tracking-tight">Create account</h1>
        <p className="text-sm text-ink-mute mt-1 mb-6">
          We'll set up a clinic for you. You can invite patients afterward.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="FULL NAME" value={fullName} onChange={setFullName} placeholder="Dr. Chen" required autoComplete="name" />
          <Field label="TITLE" value={title} onChange={setTitle} placeholder="PT, DPT" />
          <Field
            label="CLINIC NAME (OPTIONAL)"
            value={clinicName}
            onChange={setClinicName}
            placeholder="e.g. Sunrise Physiotherapy"
          />
          <Field
            label="EMAIL"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@clinic.health"
            required
            autoComplete="email"
          />
          <Field
            label="PASSWORD (8+ CHARS)"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            required
            autoComplete="new-password"
          />
          {err && <div className="text-xs text-coral">{err}</div>}
          {busy && status && <div className="text-xs text-ink-mute">{status}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ink text-white rounded-full py-3 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="text-[11px] text-ink-mute pt-2">
            Already have an account?{' '}
            <a href="/sign-in" className="text-teal font-medium">
              Sign in
            </a>
            .
          </p>
        </form>
      </div>
    </div>
  );
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || 'Your';
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="k-eyebrow text-ink-mute block mb-1">{label}</label>
      <input
        type={type}
        required={required}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-paper border border-hairline rounded-xl px-4 py-3 text-sm outline-none focus:border-teal"
      />
    </div>
  );
}
