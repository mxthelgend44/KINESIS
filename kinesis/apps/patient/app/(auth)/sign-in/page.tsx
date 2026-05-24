'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KinesisWordmark } from '@kinesis/ui';
import { signInWithPassword, sendPasswordResetEmail, useAuth } from '@kinesis/db';

export default function PatientSignInWrapper() {
  return (
    <Suspense>
      <PatientSignIn />
    </Suspense>
  );
}

function PatientSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace(next);
  }, [auth.status, next, router]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signInWithPassword(email, password);
      router.replace(next);
    } catch (e: unknown) {
      setErr(prettyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot() {
    if (!email) {
      setErr('Enter your email above first.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await sendPasswordResetEmail(email);
      setResetSent(true);
    } catch (e: unknown) {
      setErr(prettyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bone px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <KinesisWordmark size={14} />
        </div>
        <div className="k-eyebrow text-ink-mute mb-2">PATIENT</div>
        <h1 className="k-serif text-3xl leading-tight tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-mute mt-1 mb-6">Enter your email and password.</p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="k-eyebrow text-ink-mute block mb-1">EMAIL</label>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-paper border border-hairline rounded-xl px-4 py-3 text-sm outline-none focus:border-teal"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="k-eyebrow text-ink-mute">PASSWORD</label>
              <button
                type="button"
                onClick={onForgot}
                className="text-[11px] text-teal font-medium"
                disabled={busy}
              >
                Forgot?
              </button>
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-paper border border-hairline rounded-xl px-4 py-3 text-sm outline-none focus:border-teal"
            />
          </div>

          {resetSent && <div className="text-xs text-sage">Password reset email sent — check your inbox.</div>}
          {err && <div className="text-xs text-coral">{err}</div>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full bg-ink text-white rounded-full py-3 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-[11px] text-ink-mute pt-2">
            New here?{' '}
            <a href="/sign-up" className="text-teal font-medium">
              Create a patient account
            </a>
            .
          </p>
        </form>
      </div>
    </div>
  );
}

function prettyAuthError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: string }).code;
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Email or password is incorrect.';
    }
    if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
    if (code === 'auth/invalid-email') return 'Invalid email address.';
    if (code === 'auth/network-request-failed') return 'Network error — check your connection.';
  }
  return e instanceof Error ? e.message : 'Sign in failed.';
}
