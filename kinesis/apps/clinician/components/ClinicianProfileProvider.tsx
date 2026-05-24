'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Clinician } from '@kinesis/db';

/**
 * Shares the loaded clinician profile with every page under `(dashboard)/`.
 *
 * The dashboard layout already fetches `getClinician(uid)` once on mount.
 * Each page used to re-fetch the same doc independently, which added a
 * Firestore round-trip (≈150–300 ms) to every navigation. With this
 * provider, every page reads from context instead — navigation is
 * instant from the data side and dev-mode latency drops to whatever
 * Next.js spends compiling the route.
 */

type ClinicianValue = {
  clinician: Clinician;
};

const ClinicianProfileContext = createContext<ClinicianValue | null>(null);

export function ClinicianProfileProvider({
  clinician,
  children,
}: {
  clinician: Clinician;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ clinician }), [clinician]);
  return <ClinicianProfileContext.Provider value={value}>{children}</ClinicianProfileContext.Provider>;
}

export function useClinicianProfile(): ClinicianValue {
  const ctx = useContext(ClinicianProfileContext);
  if (!ctx) {
    throw new Error('useClinicianProfile must be used inside the (dashboard) layout.');
  }
  return ctx;
}

/** For places that may render outside the dashboard layout. */
export function useOptionalClinicianProfile(): ClinicianValue | null {
  return useContext(ClinicianProfileContext);
}
