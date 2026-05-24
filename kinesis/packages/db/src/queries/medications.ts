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
  Timestamp,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Medication, MedicationLog, MedicationFrequency } from '../types';

function mapMedication(d: QueryDocumentSnapshot): Medication {
  return { id: d.id, ...(d.data() as Omit<Medication, 'id'>) };
}
function mapLog(d: QueryDocumentSnapshot): MedicationLog {
  return { id: d.id, ...(d.data() as Omit<MedicationLog, 'id'>) };
}

export async function listMedicationsForPatient(patientId: string): Promise<Medication[]> {
  const q = query(
    collection(getDb(), 'medications'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapMedication);
}

export function subscribeMedicationsForPatient(
  patientId: string,
  callback: (meds: Medication[]) => void,
) {
  const q = query(
    collection(getDb(), 'medications'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapMedication)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[medications:subscribe]', err);
      callback([]);
    },
  );
}

export async function prescribeMedication(input: {
  patientId: string;
  clinicId: string;
  prescribedBy: string;
  name: string;
  dose: string;
  frequency: MedicationFrequency;
  times: string[];
  startDate: string;
  endDate: string | null;
  notes: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(getDb(), 'medications'), {
    patientId: input.patientId,
    clinicId: input.clinicId,
    prescribedBy: input.prescribedBy,
    name: input.name,
    dose: input.dose,
    frequency: input.frequency,
    times: input.times,
    startDate: input.startDate,
    endDate: input.endDate,
    notes: input.notes,
    active: true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMedication(
  medicationId: string,
  patch: Partial<Omit<Medication, 'id' | 'patientId' | 'clinicId' | 'createdAt'>>,
) {
  const ref = doc(getDb(), 'medications', medicationId);
  return updateDoc(ref, patch);
}

export async function deactivateMedication(medicationId: string) {
  const ref = doc(getDb(), 'medications', medicationId);
  return updateDoc(ref, { active: false });
}

/** Patient marks a dose as taken. Records the time + optional note. */
export async function logMedicationDose(input: {
  medicationId: string;
  patientId: string;
  note?: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(getDb(), 'medicationLogs'), {
    medicationId: input.medicationId,
    patientId: input.patientId,
    takenAt: Timestamp.now(),
    note: input.note ?? null,
  });
  return ref.id;
}

export async function listMedicationLogs(
  patientId: string,
  medicationId?: string,
): Promise<MedicationLog[]> {
  const base = collection(getDb(), 'medicationLogs');
  const q = medicationId
    ? query(
        base,
        where('patientId', '==', patientId),
        where('medicationId', '==', medicationId),
        orderBy('takenAt', 'desc'),
      )
    : query(base, where('patientId', '==', patientId), orderBy('takenAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(mapLog);
}
