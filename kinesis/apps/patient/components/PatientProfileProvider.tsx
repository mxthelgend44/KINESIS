'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Patient } from '@kinesis/db';

/**
 * Lightweight context that exposes the *already-loaded* patient profile
 * to every page under `(app)/`. The patient layout fetches the profile
 * once on mount; every page underneath reads from this context via
 * `usePatientProfile()` instead of re-running `getPatient(uid)` on its
 * own.
 *
 * Why this matters: each page-component used to fire its own Firestore
 * round-trip on first render, which adds ~150–300ms of pure latency
 * to every navigation. With the shared context, navigation between
 * /, /care, /progress, /profile, /messages, /session is instant from
 * the data side — the only remaining cost is Next.js compile time in
 * dev (production builds avoid that entirely).
 */

type ProfileValue = {
  patient: Patient;
  /** Bump to force the layout to refetch. */
  refresh: () => void;
};

const PatientProfileContext = createContext<ProfileValue | null>(null);

export function PatientProfileProvider({
  patient,
  refresh,
  children,
}: {
  patient: Patient;
  refresh: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ patient, refresh }), [patient, refresh]);
  return <PatientProfileContext.Provider value={value}>{children}</PatientProfileContext.Provider>;
}

/**
 * Read the current patient profile. Throws if called outside the
 * provider — that would mean a page is rendering without the layout's
 * profile load completing, which should never happen given the
 * layout's loading-state gate.
 */
export function usePatientProfile(): ProfileValue {
  const ctx = useContext(PatientProfileContext);
  if (!ctx) {
    throw new Error('usePatientProfile must be used inside the (app) layout.');
  }
  return ctx;
}

/**
 * Optional variant for components that want to render gracefully when
 * not wrapped in the provider (e.g. sign-in / sign-up pages that aren't
 * under (app)/).
 */
export function useOptionalPatientProfile(): ProfileValue | null {
  return useContext(PatientProfileContext);
}
