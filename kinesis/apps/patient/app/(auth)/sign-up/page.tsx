'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KinesisWordmark } from '@kinesis/ui';
import { signUpWithPassword, useAuth } from '@kinesis/db';
import { getClinicByInviteCode } from '@kinesis/db/queries/clinics';
import { provisionPatient } from '@kinesis/db/queries/patients';

export default function PatientSignUpWrapper() {
  return (
    <Suspense>
      <PatientSignUp />
    </Suspense>
  );
}

function PatientSignUp() {
  const router = useRouter();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Only redirect already-signed-in users away from /sign-up.
  // Don't auto-redirect during an in-progress sign-up — Firebase Auth flips
  // to "authenticated" the instant createUserWithEmailAndPassword resolves,
  // racing the Firestore provisioning writes below.
  useEffect(() => {
    if (auth.status === 'authenticated' && !busy) router.replace('/');
  }, [auth.status, router, busy]);

  const params = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(params.get('clinic') ?? '');
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'O'>('M');
  const [condition, setCondition] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const code = inviteCode.trim();
    if (code.length < 3) {
      setClinicName(null);
      return;
    }
    const t = setTimeout(async () => {
      const c = await getClinicByInviteCode(code);
      setClinicName(c?.name ?? null);
    }, 300);
    return () => clearTimeout(t);
  }, [inviteCode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicName) {
      setErr('Invalid clinic invite code.');
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setErr(null);
    setStatus('Checking your clinic…');
    try {
      const clinic = await getClinicByInviteCode(inviteCode);
      if (!clinic) throw new Error('Invalid clinic invite code.');
      setStatus('Creating your account…');
      const user = await signUpWithPassword(email, password, fullName);
      setStatus('Setting up your profile…');
      await provisionPatient({
        uid: user.uid,
        clinicId: clinic.id,
        fullName,
        email: user.email ?? email,
        age: age ? Number(age) : null,
        sex,
        condition: condition || null,
      });
      router.replace('/');
    } catch (e: unknown) {
      setErr(prettyAuthError(e));
      setBusy(false);
    }
    // success path: navigating away, so don't reset busy
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bone px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <KinesisWordmark size={14} />
        </div>
        <div className="k-eyebrow text-ink-mute mb-2">PATIENT</div>
        <h1 className="k-serif text-3xl leading-tight tracking-tight">Create account</h1>
        <p className="text-sm text-ink-mute mt-1 mb-6">Enter the invite code your clinician gave you.</p>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            label="CLINIC INVITE CODE"
            value={inviteCode}
            onChange={setInviteCode}
            placeholder="KINESIS-DEMO"
            required
            mono
          />
          {inviteCode.length >= 3 && (
            <div className="text-[11px]">
              {clinicName ? (
                <span className="text-sage">✓ {clinicName}</span>
              ) : (
                <span className="text-coral">Code not found</span>
              )}
            </div>
          )}
          <Field label="FULL NAME" value={fullName} onChange={setFullName} placeholder="Your name" required autoComplete="name" />
          <Field
            label="EMAIL"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
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
          <div className="grid grid-cols-2 gap-2">
            <Field label="AGE" type="number" value={age} onChange={setAge} placeholder="42" />
            <div>
              <label className="k-eyebrow text-ink-mute block mb-1">SEX</label>
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as 'M' | 'F' | 'O')}
                className="w-full bg-paper border border-hairline rounded-xl px-4 py-3 text-sm outline-none focus:border-teal"
              >
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </div>
          </div>
          <Field
            label="CONDITION"
            value={condition}
            onChange={setCondition}
            placeholder="e.g. ACL · Right knee"
          />

          {err && <div className="text-xs text-coral">{err}</div>}
          {busy && status && <div className="text-xs text-ink-mute">{status}</div>}
          <button
            type="submit"
            disabled={busy || !clinicName}
            className="w-full bg-ink text-white rounded-full py-3 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="text-[11px] text-ink-mute pt-2">
            Already signed up?{' '}
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  mono,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  mono?: boolean;
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
        className={`w-full bg-paper border border-hairline rounded-xl px-4 py-3 text-sm outline-none focus:border-teal ${
          mono ? 'k-mono uppercase tracking-wider' : ''
        }`}
      />
    </div>
  );
}

function prettyAuthError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: string }).code;
    if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Try signing in.';
    if (code === 'auth/weak-password') return 'Password must be at least 8 characters.';
    if (code === 'auth/invalid-email') return 'Invalid email address.';
    if (code === 'auth/network-request-failed') return 'Network error — check your connection.';
  }
  return e instanceof Error ? e.message : 'Could not create account.';
}
