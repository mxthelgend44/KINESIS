'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Clinician } from '../types';

function mapClinician(d: QueryDocumentSnapshot): Clinician {
  return { id: d.id, ...(d.data() as Omit<Clinician, 'id'>) };
}

export async function getClinician(uid: string): Promise<Clinician | null> {
  const ref = doc(getDb(), 'clinicians', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? mapClinician(snap as QueryDocumentSnapshot) : null;
}

export async function listCliniciansInClinic(clinicId: string): Promise<Clinician[]> {
  const q = query(collection(getDb(), 'clinicians'), where('clinicId', '==', clinicId));
  const snap = await getDocs(q);
  return snap.docs.map(mapClinician);
}

export async function provisionClinician(input: {
  uid: string;
  clinicId: string;
  fullName: string;
  email: string;
  title?: string | null;
}) {
  const ref = doc(getDb(), 'clinicians', input.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, {
    clinicId: input.clinicId,
    fullName: input.fullName,
    email: input.email,
    title: input.title ?? null,
    avatarUrl: null,
    createdAt: serverTimestamp(),
  });
}
