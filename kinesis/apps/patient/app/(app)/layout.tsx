'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState, Skeleton } from '@kinesis/ui';
import { useAuth, signOut, prettyFirestoreError, logRaw, type FriendlyError } from '@kinesis/db';
import { getPatient } from '@kinesis/db/queries/patients';
import { MobileTabBar } from '@/components/MobileTabBar';
import { PatientProfileProvider } from '@/components/PatientProfileProvider';
import type { Patient } from '@kinesis/db';

type State =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'no-profile' }
  | { kind: 'error'; err: FriendlyError }
  | { kind: 'ready'; patient: Patient };

export default function PatientAppLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (auth.status === 'unauthenticated') {
      const path = typeof window !== 'undefined' ? window.location.pathname : '/';
      router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
    }
  }, [auth.status, router]);

  // Stable key — Firebase Auth occasionally hands us a new User object on
  // token refresh; re-running the boot effect would blow away the layout
  // state for no reason.
  const uid = auth.status === 'authenticated' ? auth.user.uid : null;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        // Try once at the configured fast path. Only retry if the doc is
        // genuinely missing (the post-sign-up consistency window).
        let p = await getPatient(uid);
        if (cancelled) return;
        if (p) {
          setState({ kind: 'ready', patient: p });
          return;
        }
        for (let i = 0; i < 2 && !p; i++) {
          await sleep(200);
          if (cancelled) return;
          p = await getPatient(uid);
        }
        if (p) setState({ kind: 'ready', patient: p });
        else setState({ kind: 'no-profile' });
      } catch (e: unknown) {
        if (cancelled) return;
        logRaw('patient-boot', e);
        setState({ kind: 'error', err: prettyFirestoreError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  const onRetry = useCallback(() => setAttempt((a) => a + 1), []);
  const onSignOut = useCallback(async () => {
    await signOut();
    router.replace('/sign-in');
  }, [router]);

  if (auth.status === 'loading' || state.kind === 'loading') {
    return <PatientHomeSkeleton />;
  }
  if (auth.status === 'unauthenticated') return null;

  if (state.kind === 'no-profile') {
    return (
      <ErrorState
        title="Finish setting up your account"
        message="We couldn't find your patient profile. Sign back in or create it from the sign-up page."
        onRetry={onRetry}
        secondaryLabel="Sign out"
        onSecondary={onSignOut}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <ErrorState
        title={state.err.title}
        message={state.err.message}
        onRetry={state.err.retryable ? onRetry : undefined}
        secondaryLabel="Sign out"
        onSecondary={onSignOut}
      />
    );
  }

  // Narrow the union — every other kind already short-circuited above,
  // so the only path through here is 'ready'. The explicit guard tells
  // TypeScript that, and protects against future kinds being added.
  if (state.kind !== 'ready') return null;
  return (
    <PatientProfileProvider patient={state.patient} refresh={onRetry}>
      <div style={{ background: '#FAF8F4', minHeight: '100vh', position: 'relative' }} className="max-w-[440px] mx-auto">
        {children}
        <MobileTabBar />
      </div>
    </PatientProfileProvider>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function PatientHomeSkeleton() {
  return (
    <div style={{ background: '#FAF8F4', minHeight: '100vh' }} className="max-w-[440px] mx-auto">
      <div style={{ height: 54 }} />
      <div style={{ padding: '18px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton width={180} height={10} />
          <Skeleton width="80%" height={28} />
        </div>
        <Skeleton width={44} height={44} radius={22} />
      </div>
      <div style={{ padding: '12px 24px 4px' }}>
        <Skeleton width={140} height={10} style={{ marginBottom: 8 }} />
        <Skeleton width="100%" height={4} radius={2} />
      </div>
      <div style={{ padding: '20px 16px 0' }}>
        <Skeleton height={180} radius={22} />
      </div>
      <div style={{ padding: '20px 16px 0' }}>
        <Skeleton height={120} radius={18} />
      </div>
      <div style={{ padding: '14px 16px 0' }}>
        <Skeleton height={160} radius={18} />
      </div>
    </div>
  );
}
