'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState, Skeleton } from '@kinesis/ui';
import {
  useAuth,
  signOut,
  prettyFirestoreError,
  logRaw,
  type FriendlyError,
} from '@kinesis/db';
import { getClinician } from '@kinesis/db/queries/clinicians';
import { listPatientsInClinic } from '@kinesis/db/queries/patients';
import { subscribeOpenAlertsForClinic } from '@kinesis/db/queries/alerts';
import { subscribeLiveSessionsInClinic } from '@kinesis/db/queries/sessions';
import { Sidebar } from '@/components/Sidebar';
import { ClinicianProfileProvider } from '@/components/ClinicianProfileProvider';
import type { Clinician } from '@kinesis/db';

type BootState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'no-profile' }
  | { kind: 'error'; err: FriendlyError }
  | { kind: 'ready'; clinician: Clinician; patientCount: number };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const auth = useAuth();
  const [state, setState] = useState<BootState>({ kind: 'loading' });
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const [liveSessionCount, setLiveSessionCount] = useState(0);
  const [attempt, setAttempt] = useState(0);

  // Redirect when unauthenticated.
  useEffect(() => {
    if (auth.status === 'unauthenticated') {
      const path = typeof window !== 'undefined' ? window.location.pathname : '/';
      router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
    }
  }, [auth.status, router]);

  // Load clinician profile + patient count.
  // Key on the stable uid string so a token refresh that hands us a new
  // User reference doesn't blow away the boot state.
  const uid = auth.status === 'authenticated' ? auth.user.uid : null;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      // Doc is usually present on first try. Only retry if it's *missing*
      // (eventually-consistent window right after sign-up) — and keep the
      // retry cheap so a returning user doesn't pay the cost.
      try {
        let clinician = await getClinician(uid);
        if (cancelled) return;
        if (!clinician) {
          for (let i = 0; i < 2 && !clinician; i++) {
            await sleep(200);
            if (cancelled) return;
            clinician = await getClinician(uid);
          }
        }
        if (!clinician) {
          if (!cancelled) setState({ kind: 'no-profile' });
          return;
        }
        let patients: { id: string }[] = [];
        try {
          patients = await listPatientsInClinic(clinician.clinicId);
        } catch (inner: unknown) {
          const code = (inner as { code?: string })?.code;
          if (code === 'permission-denied') {
            // One quick retry — typically clears in <400ms once the
            // clinician doc write fully propagates.
            await sleep(300);
            if (!cancelled) patients = await listPatientsInClinic(clinician.clinicId);
          } else {
            throw inner;
          }
        }
        if (cancelled) return;
        setState({ kind: 'ready', clinician, patientCount: patients.length });
      } catch (e: unknown) {
        if (cancelled) return;
        logRaw('clinician-boot', e);
        setState({ kind: 'error', err: prettyFirestoreError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, attempt]);

  // Live counters once we have a clinician.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const unsubA = subscribeOpenAlertsForClinic(state.clinician.clinicId, (alerts) => {
      setOpenAlertCount(alerts.length);
    });
    const unsubS = subscribeLiveSessionsInClinic(state.clinician.clinicId, (sessions) => {
      setLiveSessionCount(sessions.length);
    });
    return () => {
      unsubA();
      unsubS();
    };
  }, [state]);

  const onRetry = useCallback(() => setAttempt((a) => a + 1), []);
  const onSignOut = useCallback(async () => {
    await signOut();
    router.replace('/sign-in');
  }, [router]);

  if (auth.status === 'loading' || state.kind === 'loading') {
    return <DashboardSkeleton />;
  }

  if (auth.status === 'unauthenticated') return null;

  if (state.kind === 'no-profile') {
    return (
      <ErrorState
        title="Finish setting up your account"
        message="Your sign-in worked but we couldn't find your clinician profile. Sign back in or create the account from the sign-up page."
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

  if (state.kind !== 'ready') return null;

  const { clinician, patientCount } = state;
  const initials = clinician.fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ClinicianProfileProvider clinician={clinician}>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#FAF8F4' }}>
        <Sidebar
          initial={{
            full_name: clinician.fullName,
            email: clinician.email,
            initials,
            patientCount,
            openAlertCount,
            liveSessionCount,
          }}
        />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </ClinicianProfileProvider>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#FAF8F4' }}>
      <aside
        style={{
          width: 232,
          background: '#0E1822',
          padding: '20px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <Skeleton width={110} height={14} dark />
        <Skeleton width="100%" height={48} radius={10} dark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} width="100%" height={28} radius={8} dark />
          ))}
        </div>
      </aside>
      <main style={{ flex: 1, padding: '24px 28px' }}>
        <Skeleton width={180} height={12} style={{ marginBottom: 12 }} />
        <Skeleton width={420} height={28} style={{ marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={92} radius={14} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
          <Skeleton height={420} radius={14} />
          <Skeleton height={420} radius={14} />
        </div>
      </main>
    </div>
  );
}
