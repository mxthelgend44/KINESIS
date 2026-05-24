export * from './types';
export {
  getFirebaseApp,
  getFirebaseAuth,
  getDb,
  initAnalytics,
} from './client';
export {
  signInWithPassword,
  signUpWithPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User,
} from './auth';
export { AuthProvider, useAuth } from './AuthProvider';
export { firebaseConfig } from './config';
export {
  prettyAuthError,
  prettyFirestoreError,
  logRaw,
  type FriendlyError,
} from './errors';
