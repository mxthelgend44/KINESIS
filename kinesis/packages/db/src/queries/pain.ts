'use client';

import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  limit as fsLimit,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { PainCheckin, PainFeeling } from '../types';

function mapPain(d: QueryDocumentSnapshot): PainCheckin {
  return { id: d.id, ...(d.data() as Omit<PainCheckin, 'id'>) };
}

export async function listPainCheckins(patientId: string, n = 28): Promise<PainCheckin[]> {
  const q = query(
    collection(getDb(), 'painCheckins'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    fsLimit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapPain);
}

/**
 * Log a pain check-in. Accepts either the legacy positional signature
 * (patientId, score, note) or an options object with optional session +
 * exercise + feeling context for post-session feedback.
 */
export async function logPainCheckin(
  patientId: string,
  score: number,
  noteOrOpts?: string | null | {
    note?: string | null;
    sessionId?: string | null;
    exerciseId?: string | null;
    feeling?: PainFeeling | null;
  },
) {
  const opts =
    typeof noteOrOpts === 'object' && noteOrOpts !== null
      ? noteOrOpts
      : { note: noteOrOpts ?? null };
  return addDoc(collection(getDb(), 'painCheckins'), {
    patientId,
    score,
    note: opts.note ?? null,
    sessionId: opts.sessionId ?? null,
    exerciseId: opts.exerciseId ?? null,
    feeling: opts.feeling ?? null,
    createdAt: serverTimestamp(),
  });
}
