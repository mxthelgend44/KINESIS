'use client';

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  getDocs,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../client';
import type { Message, SenderRole } from '../types';

function mapMessage(d: QueryDocumentSnapshot): Message {
  return { id: d.id, ...(d.data() as Omit<Message, 'id'>) };
}

export function subscribeMessages(patientId: string, callback: (messages: Message[]) => void) {
  const q = query(
    collection(getDb(), 'messages'),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapMessage)));
}

export async function sendMessage(input: {
  patientId: string;
  clinicianId: string;
  clinicId: string;
  senderRole: SenderRole;
  body: string;
  attachedSessionId?: string | null;
}) {
  return addDoc(collection(getDb(), 'messages'), {
    patientId: input.patientId,
    clinicianId: input.clinicianId,
    clinicId: input.clinicId,
    senderRole: input.senderRole,
    body: input.body,
    attachedSessionId: input.attachedSessionId ?? null,
    readAt: null,
    createdAt: serverTimestamp(),
  });
}

export async function markMessagesRead(messageIds: string[]) {
  if (!messageIds.length) return;
  const db = getDb();
  const batch = writeBatch(db);
  for (const id of messageIds) {
    batch.update(doc(db, 'messages', id), { readAt: serverTimestamp() });
  }
  await batch.commit();
}
