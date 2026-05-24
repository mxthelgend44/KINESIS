'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Clinic } from '../types';

export async function getClinicByInviteCode(code: string): Promise<Clinic | null> {
  const q = query(
    collection(getDb(), 'clinics'),
    where('inviteCode', '==', code.trim().toUpperCase()),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return { id: d.id, ...(d.data() as Omit<Clinic, 'id'>) };
}

export async function getClinic(clinicId: string): Promise<Clinic | null> {
  const ref = doc(getDb(), 'clinics', clinicId);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Clinic, 'id'>) }) : null;
}

/** Random invite code: 4 letters + 4 digits (e.g. KINX-7842). Avoids 0/O/1/I. */
function generateInviteCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (src: string, n: number) =>
    Array.from({ length: n }, () => src[Math.floor(Math.random() * src.length)]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}`;
}

/** Create a new clinic with a unique invite code. Retries on collisions. */
export async function createClinic(name: string): Promise<Clinic> {
  for (let i = 0; i < 6; i++) {
    const inviteCode = generateInviteCode();
    const existing = await getClinicByInviteCode(inviteCode);
    if (existing) continue;
    const data = {
      name: name.trim() || 'New Clinic',
      inviteCode,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(getDb(), 'clinics'), data);
    return { id: ref.id, name: data.name, inviteCode, createdAt: null };
  }
  throw new Error('Could not generate a unique invite code. Try again.');
}
