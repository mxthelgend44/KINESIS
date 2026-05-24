'use client';

// Email + password auth with Firebase. Default flow for both apps.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail as fbSendPasswordResetEmail,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './client';

export async function signInWithPassword(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return cred.user;
}

export async function signUpWithPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  if (displayName) {
    try {
      await updateProfile(cred.user, { displayName });
    } catch {
      // non-fatal
    }
  }
  return cred.user;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  await fbSendPasswordResetEmail(getFirebaseAuth(), email);
}

export function signOut() {
  return fbSignOut(getFirebaseAuth());
}

export function onAuthStateChanged(callback: (user: User | null) => void) {
  return fbOnAuthStateChanged(getFirebaseAuth(), callback);
}

export type { User };
