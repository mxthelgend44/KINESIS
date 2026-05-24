// Firebase config — read from NEXT_PUBLIC_* env vars at build time.
//
// Never commit literal API keys. Set the values in apps/patient/.env.local
// and apps/clinician/.env.local (both files are gitignored). See
// `.env.example` in each app for the required variable names.
//
// Firebase web API keys are technically meant to be exposed in client
// bundles (they identify the project, not authenticate access), but
// GitHub's secret scanner flags them and the values still belong in
// env files so they can be rotated or swapped per-environment without
// a code change.

const need = (k: string, v: string | undefined): string => {
  if (!v || v.length === 0) {
    throw new Error(
      `Missing required env var ${k}. Add it to apps/<app>/.env.local. ` +
      `See .env.example.`,
    );
  }
  return v;
};

export const firebaseConfig = {
  apiKey: need('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: need('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: need('NEXT_PUBLIC_FIREBASE_PROJECT_ID', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: need('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: need('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: need('NEXT_PUBLIC_FIREBASE_APP_ID', process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
