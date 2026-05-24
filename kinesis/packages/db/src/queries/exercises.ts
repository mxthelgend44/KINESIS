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
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Exercise, Prescription } from '../types';

function mapExercise(d: QueryDocumentSnapshot): Exercise {
  return { id: d.id, ...(d.data() as Omit<Exercise, 'id'>) };
}

/**
 * Stock exercise catalogue. These IDs match the ones in
 * `@kinesis/pose`'s `EXERCISE_INSTRUCTIONS` registry, so each one comes
 * with proper instructions, an SVG/Lottie demo, and sensible default
 * joints. They're merged into whatever Firestore returns so a clinic
 * that hasn't seeded its own catalogue still has something to start
 * with.
 *
 * Clinics can override any default by writing a doc with the matching
 * ID into /exercises — the Firestore row wins on collision.
 */
export const DEFAULT_EXERCISES: Exercise[] = [
  {
    id: 'knee-flexion',
    clinicId: null,
    name: 'Seated knee flexion',
    description: 'Bend and straighten the knee while seated. Great early-stage exercise for ACL and meniscus recovery.',
    category: 'leg',
    difficulty: 'beginner',
    defaultJoints: ['right_knee'],
    targetRom: 130,
    durationMin: 5,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'shoulder-abduction',
    clinicId: null,
    name: 'Shoulder abduction',
    description: 'Lift the arm sideways from a relaxed position at the hip toward shoulder height.',
    category: 'arm',
    difficulty: 'beginner',
    defaultJoints: ['right_shoulder'],
    targetRom: 110,
    durationMin: 5,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'hip-extension',
    clinicId: null,
    name: 'Standing hip extension',
    description: 'Extend the leg backward from the hip while standing. Strengthens glutes and posterior chain.',
    category: 'leg',
    difficulty: 'beginner',
    defaultJoints: ['right_hip'],
    targetRom: 55,
    durationMin: 5,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'elbow-curl',
    clinicId: null,
    name: 'Elbow curl',
    description: 'Curl the forearm up toward the shoulder. Useful for biceps tendinopathy recovery.',
    category: 'arm',
    difficulty: 'beginner',
    defaultJoints: ['right_elbow'],
    targetRom: 110,
    durationMin: 4,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'ankle-dorsi',
    clinicId: null,
    name: 'Ankle dorsiflexion',
    description: 'Pull the toes up toward the shin while seated. Standard post-fracture/post-sprain mobility drill.',
    category: 'leg',
    difficulty: 'beginner',
    defaultJoints: ['right_ankle'],
    targetRom: 40,
    durationMin: 4,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'sit-to-stand',
    clinicId: null,
    name: 'Sit-to-stand',
    description: 'Stand up from a chair without using your hands, then sit back down with control.',
    category: 'leg',
    difficulty: 'intermediate',
    defaultJoints: ['right_knee', 'left_knee'],
    targetRom: 80,
    durationMin: 5,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
  {
    id: 'wall-shoulder-flex',
    clinicId: null,
    name: 'Wall shoulder flexion',
    description: 'Walk the fingertips up a wall, lifting the arm forward and overhead.',
    category: 'arm',
    difficulty: 'beginner',
    defaultJoints: ['right_shoulder'],
    targetRom: 160,
    durationMin: 4,
    thumbnailUrl: null,
    demoVideoUrl: null,
  },
];

/**
 * Returns the full catalogue. Firestore-served exercises take precedence
 * — any default with the same ID is dropped. If Firestore returns
 * nothing (collection unseeded, permission-denied, offline), the defaults
 * are returned alone so the picker is never empty.
 */
export async function listExercises(): Promise<Exercise[]> {
  let firestoreList: Exercise[] = [];
  try {
    const q = query(collection(getDb(), 'exercises'), orderBy('name'));
    const snap = await getDocs(q);
    firestoreList = snap.docs.map(mapExercise);
  } catch {
    // Permission-denied or offline — fall back to defaults silently. The
    // picker showing seven sensible exercises is better than showing none.
  }
  const seen = new Set(firestoreList.map((e) => e.id));
  const merged = [...firestoreList];
  for (const d of DEFAULT_EXERCISES) {
    if (!seen.has(d.id)) merged.push(d);
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPrescriptionsForPatient(patientId: string): Promise<Prescription[]> {
  const q = query(
    collection(getDb(), 'prescriptions'),
    where('patientId', '==', patientId),
    where('active', '==', true),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Prescription, 'id'>) }));
}

export function subscribePrescriptionsForPatient(
  patientId: string,
  callback: (prescriptions: Prescription[]) => void,
) {
  const q = query(
    collection(getDb(), 'prescriptions'),
    where('patientId', '==', patientId),
    where('active', '==', true),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Prescription, 'id'>) })));
  });
}

export async function createPrescription(input: {
  patientId: string;
  exerciseId: string;
  prescribedBy: string;
  sets?: number;
  reps?: number;
  frequencyPerWeek?: number;
  notes?: string | null;
}) {
  return addDoc(collection(getDb(), 'prescriptions'), {
    patientId: input.patientId,
    exerciseId: input.exerciseId,
    prescribedBy: input.prescribedBy,
    sets: input.sets ?? 3,
    reps: input.reps ?? 15,
    frequencyPerWeek: input.frequencyPerWeek ?? 5,
    notes: input.notes ?? null,
    active: true,
    createdAt: serverTimestamp(),
  });
}

export async function deactivatePrescription(prescriptionId: string) {
  return updateDoc(doc(getDb(), 'prescriptions', prescriptionId), { active: false });
}
