'use client';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  limit as fsLimit,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { MotionCapture, MotionCaptureFrame } from '../types';

function mapMotionCapture(d: QueryDocumentSnapshot): MotionCapture {
  return { id: d.id, ...(d.data() as Omit<MotionCapture, 'id'>) };
}

/**
 * Persist a motion-capture clip.
 *
 * Frames are stored inline on the document. Firestore caps documents at
 * 1 MiB; the recorder budget should keep clips well under that — a
 * conservative ceiling of about 30 seconds at 25 fps with ~11 bones per
 * frame works out to ~30 KB. Anything larger should switch to Firebase
 * Storage, which we'd surface via `frames: []` + `framesUrl`.
 */
export async function saveMotionCapture(input: {
  patientId: string;
  clinicId: string;
  sessionId: string | null;
  exerciseId: string | null;
  name: string;
  rigUrl: string;
  durationMs: number;
  sampleRateHz: number;
  frames: MotionCaptureFrame[];
}): Promise<string> {
  const db = getDb();
  const ref = await addDoc(collection(db, 'motionCaptures'), {
    patientId: input.patientId,
    clinicId: input.clinicId,
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    name: input.name,
    rigUrl: input.rigUrl,
    durationMs: input.durationMs,
    sampleRateHz: input.sampleRateHz,
    frameCount: input.frames.length,
    frames: input.frames,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listMotionCapturesForPatient(
  patientId: string,
  n = 40,
): Promise<MotionCapture[]> {
  const q = query(
    collection(getDb(), 'motionCaptures'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    fsLimit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapMotionCapture);
}

export async function getMotionCapture(id: string): Promise<MotionCapture | null> {
  const ref = doc(getDb(), 'motionCaptures', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<MotionCapture, 'id'>) };
}
