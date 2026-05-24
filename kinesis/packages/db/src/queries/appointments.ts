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
  Timestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Appointment, AppointmentStatus, AppointmentType } from '../types';

function mapAppointment(d: QueryDocumentSnapshot): Appointment {
  return { id: d.id, ...(d.data() as Omit<Appointment, 'id'>) };
}

export async function listAppointmentsForPatient(patientId: string): Promise<Appointment[]> {
  const q = query(
    collection(getDb(), 'appointments'),
    where('patientId', '==', patientId),
    orderBy('scheduledAt', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapAppointment);
}

export function subscribeAppointmentsForPatient(
  patientId: string,
  callback: (appts: Appointment[]) => void,
) {
  const q = query(
    collection(getDb(), 'appointments'),
    where('patientId', '==', patientId),
    orderBy('scheduledAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapAppointment)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[appointments:subscribe]', err);
      callback([]);
    },
  );
}

export async function listAppointmentsForClinic(clinicId: string): Promise<Appointment[]> {
  const q = query(
    collection(getDb(), 'appointments'),
    where('clinicId', '==', clinicId),
    orderBy('scheduledAt', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapAppointment);
}

export function subscribeAppointmentsForClinic(
  clinicId: string,
  callback: (appts: Appointment[]) => void,
) {
  const q = query(
    collection(getDb(), 'appointments'),
    where('clinicId', '==', clinicId),
    orderBy('scheduledAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map(mapAppointment)),
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[appointments:subscribe]', err);
      callback([]);
    },
  );
}

export async function createAppointment(input: {
  patientId: string;
  clinicId: string;
  clinicianId: string;
  scheduledAt: Date;
  durationMinutes: number;
  type: AppointmentType;
  notes: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(getDb(), 'appointments'), {
    patientId: input.patientId,
    clinicId: input.clinicId,
    clinicianId: input.clinicianId,
    scheduledAt: Timestamp.fromDate(input.scheduledAt),
    durationMinutes: input.durationMinutes,
    type: input.type,
    status: 'scheduled' as AppointmentStatus,
    notes: input.notes,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAppointment(
  appointmentId: string,
  patch: Partial<Pick<Appointment, 'scheduledAt' | 'durationMinutes' | 'type' | 'status' | 'notes'>>,
) {
  const ref = doc(getDb(), 'appointments', appointmentId);
  return updateDoc(ref, patch);
}

export async function cancelAppointment(appointmentId: string) {
  const ref = doc(getDb(), 'appointments', appointmentId);
  return updateDoc(ref, { status: 'cancelled' as AppointmentStatus });
}

export async function completeAppointment(appointmentId: string, notes?: string | null) {
  const ref = doc(getDb(), 'appointments', appointmentId);
  return updateDoc(ref, {
    status: 'completed' as AppointmentStatus,
    ...(notes !== undefined ? { notes } : {}),
  });
}
