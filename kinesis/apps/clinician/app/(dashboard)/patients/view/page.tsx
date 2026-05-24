'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorState } from '@kinesis/ui';
import { prettyFirestoreError, logRaw, type FriendlyError } from '@kinesis/db';
import { TopBar } from '@/components/TopBar';
import { PatientDetailClient } from './detail-client';
import { getPatient } from '@kinesis/db/queries/patients';
import { subscribeSessionsForPatient } from '@kinesis/db/queries/sessions';
import { subscribeAlertsForPatient } from '@kinesis/db/queries/alerts';
import type { Alert, Patient, Session } from '@kinesis/db';

// Why a search-param URL instead of /patients/[id]? Dynamic route
// segments force Next.js to mark the route as server-rendered (even
// for `'use client'` files), which makes Firebase Hosting bundle
// it into a Cloud Function. Our pnpm workspace breaks that bundler.
// A query param keeps the URL clean and the entire route 100% static.

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; err: FriendlyError }
  | { kind: 'ready'; patient: Patient };

export default function PatientDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: '#6B7785' }}>Loading…</div>}>
      <PatientDetail />
    </Suspense>
  );
}

function PatientDetail() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const router = useRouter();

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) {
      setState({ kind: 'not-found' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const p = await getPatient(id);
        if (cancelled) return;
        if (!p) setState({ kind: 'not-found' });
        else setState({ kind: 'ready', patient: p });
      } catch (e: unknown) {
        if (cancelled) return;
        logRaw('patient-detail', e);
        setState({ kind: 'error', err: prettyFirestoreError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const unsubS = subscribeSessionsForPatient(state.patient.id, setSessions);
    const unsubA = subscribeAlertsForPatient(state.patient.id, setAlerts);
    return () => {
      unsubS();
      unsubA();
    };
  }, [state]);

  const onRetry = useCallback(() => setAttempt((a) => a + 1), []);

  if (state.kind === 'loading') {
    return (
      <div style={{ padding: 40, color: '#6B7785' }}>
        <div className="k-eyebrow">LOADING…</div>
      </div>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <ErrorState
        title="Patient not found"
        message="The patient you're looking for has been removed or isn't in your clinic."
        secondaryLabel="Back to cohort"
        onSecondary={() => router.push('/')}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <ErrorState
        title={state.err.title}
        message={state.err.message}
        onRetry={state.err.retryable ? onRetry : undefined}
        secondaryLabel="Back to cohort"
        onSecondary={() => router.push('/')}
      />
    );
  }

  return (
    <>
      <TopBar crumbs={['Patients', state.patient.fullName]} />
      <PatientDetailClient patient={state.patient} sessions={sessions} alerts={alerts} />
    </>
  );
}
