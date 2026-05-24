'use client';

// Firebase client — lazy initialization so we only run it in the browser.
//
// Firestore here is configured explicitly with `initializeFirestore` so we
// can pin a few transport choices that work around well-known SDK bugs:
//
//   1. Auto-detect long polling. Default WebChannel transport sometimes
//      gets into a bad state behind corporate proxies, dev-server hot
//      reloads, or VPNs, and surfaces as the "INTERNAL ASSERTION FAILED
//      (ID: ca9)" / (ID: b815) crashes. Enabling auto-detect lets the
//      SDK fall back to long polling cleanly.
//
//   2. Memory-only local cache (no IndexedDB persistence). Persistence
//      tied to IndexedDB is the dominant root cause of ca9 in dev because
//      Next.js HMR re-runs module init while the previous Firestore
//      instance is still holding an IndexedDB lock. We don't need
//      offline persistence here — the patient/clinician apps are
//      always-online — and disabling it makes HMR cycles instantly
//      survivable.
//
// `initializeFirestore` can only be called *once per app*; if a prior
// HMR pass already initialised it, we silently fall back to
// `getFirestore` so subsequent module evaluations don't blow up.

import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from './config';

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseApp());
  return _auth;
}

export function getDb(): Firestore {
  if (_db) return _db;
  const app = getFirebaseApp();
  try {
    _db = initializeFirestore(app, {
      // Force long-polling instead of WebChannel. Auto-detect still
      // hit the ca9/b815 internal assertions in dev — the WebChannel
      // state machine and HMR don't get along. Long-polling is slower
      // by ~50ms per call, which is invisible for our workload.
      experimentalForceLongPolling: true,
      // Skip IndexedDB persistence entirely. HMR + IndexedDB locks are
      // the dominant cause of dev-mode Firestore crashes. The app is
      // online-first; offline reads via persistence aren't needed.
      localCache: memoryLocalCache(),
    });
  } catch {
    // Already initialised on a prior HMR pass — return the existing
    // instance instead of crashing.
    _db = getFirestore(app);
  }
  return _db;
}

// Analytics is browser-only and optional — call from a useEffect in a layout.
export async function initAnalytics() {
  if (typeof window === 'undefined') return null;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (!(await isSupported())) return null;
  return getAnalytics(getFirebaseApp());
}
