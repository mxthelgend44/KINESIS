'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where,
  orderBy,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Patient } from '../types';

function mapPatient(d: QueryDocumentSnapshot): Patient {
  return { id: d.id, ...(d.data() as Omit<Patient, 'id'>) };
}

export async function getPatient(patientId: string): Promise<Patient | null> {
  const ref = doc(getDb(), 'patients', patientId);
  const snap = await getDoc(ref);
  return snap.exists() ? mapPatient(snap as QueryDocumentSnapshot) : null;
}

export async function listPatientsInClinic(clinicId: string): Promise<Patient[]> {
  const q = query(
    collection(getDb(), 'patients'),
    where('clinicId', '==', clinicId),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapPatient);
}

/**
 * Subscribe to all patients in a clinic. Returns the unsubscribe fn.
 */
export function subscribePatientsInClinic(
  clinicId: string,
  callback: (patients: Patient[]) => void,
) {
  const q = query(
    collection(getDb(), 'patients'),
    where('clinicId', '==', clinicId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapPatient)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[patients:subscribe]', err);
      callback([]);
    },
  );
}

/** Provision a patient row on first sign-in (idempotent — uses set with merge). */
export async function provisionPatient(input: {
  uid: string;
  clinicId: string;
  fullName: string;
  email: string;
  age?: number | null;
  sex?: 'M' | 'F' | 'O' | null;
  condition?: string | null;
}) {
  const ref = doc(getDb(), 'patients', input.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, {
    clinicId: input.clinicId,
    primaryClinicianId: null,
    fullName: input.fullName,
    email: input.email,
    age: input.age ?? null,
    sex: input.sex ?? null,
    condition: input.condition ?? null,
    surgeryDate: null,
    weekNum: 1,
    weekTotal: 12,
    compliance: 'green',
    avatarUrl: null,
    createdAt: serverTimestamp(),
  });
}
