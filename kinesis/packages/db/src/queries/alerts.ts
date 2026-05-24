'use client';

import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Alert } from '../types';

function mapAlert(d: QueryDocumentSnapshot): Alert {
  return { id: d.id, ...(d.data() as Omit<Alert, 'id'>) };
}

export async function listAlertsForClinic(clinicId: string, n = 200): Promise<Alert[]> {
  const q = query(
    collection(getDb(), 'alerts'),
    where('clinicId', '==', clinicId),
    orderBy('createdAt', 'desc'),
    fsLimit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapAlert);
}

export async function listOpenAlertsForClinic(clinicId: string): Promise<Alert[]> {
  const q = query(
    collection(getDb(), 'alerts'),
    where('clinicId', '==', clinicId),
    where('status', '==', 'open'),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapAlert);
}

export function subscribeOpenAlertsForClinic(
  clinicId: string,
  callback: (alerts: Alert[]) => void,
) {
  const q = query(
    collection(getDb(), 'alerts'),
    where('clinicId', '==', clinicId),
    where('status', '==', 'open'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapAlert)),
    (err) => {
      // Permission errors from a stale rules deploy / missing index would
      // otherwise surface as an unhandled error. Log and degrade to empty.
      // eslint-disable-next-line no-console
      console.warn('[alerts:subscribe]', err);
      callback([]);
    },
  );
}

export function subscribeAlertsForPatient(patientId: string, callback: (alerts: Alert[]) => void) {
  const q = query(
    collection(getDb(), 'alerts'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    fsLimit(20),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapAlert)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[alerts:subscribe]', err);
      callback([]);
    },
  );
}
