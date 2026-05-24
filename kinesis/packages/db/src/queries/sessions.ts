'use client';

import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
  type QueryDocumentSnapshot,
  type DocumentReference,
  limit as fsLimit,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Session, SessionSample, Classification, RepStat } from '../types';

function mapSession(d: QueryDocumentSnapshot): Session {
  return { id: d.id, ...(d.data() as Omit<Session, 'id'>) };
}

export async function listSessionsForPatient(patientId: string, opts: { live?: boolean | null } = {}): Promise<Session[]> {
  const db = getDb();
  let q = query(
    collection(db, 'sessions'),
    where('patientId', '==', patientId),
    orderBy('startedAt', 'desc'),
  );
  if (opts.live === false) {
    q = query(
      collection(db, 'sessions'),
      where('patientId', '==', patientId),
      where('isLive', '==', false),
      orderBy('startedAt', 'desc'),
    );
  }
  const snap = await getDocs(q);
  return snap.docs.map(mapSession);
}

export async function listRecentSessionsInClinic(clinicId: string, n = 200): Promise<Session[]> {
  const q = query(
    collection(getDb(), 'sessions'),
    where('clinicId', '==', clinicId),
    orderBy('startedAt', 'desc'),
    fsLimit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapSession);
}

export function subscribeSessionsForPatient(
  patientId: string,
  callback: (sessions: Session[]) => void,
) {
  const q = query(
    collection(getDb(), 'sessions'),
    where('patientId', '==', patientId),
    orderBy('startedAt', 'asc'),
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapSession)));
}

export function subscribeLiveSessionsInClinic(
  clinicId: string,
  callback: (sessions: Session[]) => void,
) {
  const q = query(
    collection(getDb(), 'sessions'),
    where('clinicId', '==', clinicId),
    where('isLive', '==', true),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapSession)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[sessions:subscribeLive]', err);
      callback([]);
    },
  );
}

/** Create a session row when recording begins. Returns the new doc ref. */
export async function createSession(input: {
  patientId: string;
  clinicId: string;
  exerciseId: string | null;
  jointKeys: string[];
}): Promise<DocumentReference> {
  return addDoc(collection(getDb(), 'sessions'), {
    patientId: input.patientId,
    clinicId: input.clinicId,
    exerciseId: input.exerciseId,
    jointKeys: input.jointKeys,
    startedAt: serverTimestamp(),
    endedAt: serverTimestamp(),
    durationSeconds: 0,
    reps: 0,
    avgQuality: 100,
    classification: null as Classification | null,
    peakRom: {},
    minAngle: {},
    maxAngle: {},
    painScore: null,
    notes: null,
    isLive: true,
  });
}

export async function updateLiveSession(sessionId: string, patch: {
  reps?: number;
  avgQuality?: number;
  classification?: Classification | null;
}) {
  const ref = doc(getDb(), 'sessions', sessionId);
  return updateDoc(ref, patch);
}

export async function finalizeSession(sessionId: string, patch: {
  reps: number;
  avgQuality: number;
  classification: Classification | null;
  peakRom: Record<string, number>;
  minAngle: Record<string, number>;
  maxAngle: Record<string, number>;
  durationSeconds: number;
  repStats?: RepStat[];
}) {
  const ref = doc(getDb(), 'sessions', sessionId);
  return updateDoc(ref, { ...patch, endedAt: serverTimestamp(), isLive: false });
}

/** Bulk insert samples into the sub-collection during a live session. */
export async function appendSessionSamples(
  sessionId: string,
  samples: Array<{ tMs: number; joints: Record<string, number> }>,
) {
  if (!samples.length) return;
  const db = getDb();
  const batch = writeBatch(db);
  for (const s of samples) {
    const ref = doc(collection(db, 'sessions', sessionId, 'samples'));
    batch.set(ref, { tMs: s.tMs, joints: s.joints, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

export function subscribeSessionSamples(
  sessionId: string,
  callback: (latest: SessionSample) => void,
) {
  const q = query(
    collection(getDb(), 'sessions', sessionId, 'samples'),
    orderBy('createdAt', 'desc'),
    fsLimit(1),
  );
  return onSnapshot(q, (snap) => {
    const d = snap.docs[0];
    if (!d) return;
    const data = d.data() as Omit<SessionSample, never>;
    callback(data);
  });
}

export function subscribeSession(sessionId: string, callback: (s: Session) => void) {
  const ref = doc(getDb(), 'sessions', sessionId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    callback({ id: snap.id, ...(snap.data() as Omit<Session, 'id'>) });
  });
}
