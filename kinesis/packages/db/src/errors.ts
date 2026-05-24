// Friendly error mapping for Firebase Auth and Firestore.
//
// Use these everywhere we surface an error to the user. Raw codes
// like "Missing or insufficient permissions." or "auth/invalid-credential"
// are confusing — these wrappers map them to a short, friendly title +
// a helpful suggestion.

export type FriendlyError = {
  code: string;          // raw firebase code, for logging
  title: string;         // headline shown to the user
  message: string;       // single sentence under the headline
  retryable: boolean;    // should we offer a Retry button?
};

function codeOf(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) return String((e as { code: unknown }).code);
  return '';
}

export function prettyFirestoreError(e: unknown): FriendlyError {
  const code = codeOf(e);

  if (code === 'permission-denied') {
    return {
      code,
      title: "We can't reach your data right now",
      message: 'Your account is signed in, but the data store rejected the request. Try again in a moment.',
      retryable: true,
    };
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return {
      code,
      title: 'Connection problem',
      message: "We couldn't reach KINESIS right now. Check your internet connection and try again.",
      retryable: true,
    };
  }
  if (code === 'not-found') {
    return {
      code,
      title: 'Not found',
      message: "We couldn't find what you were looking for.",
      retryable: false,
    };
  }
  if (code === 'unauthenticated') {
    return {
      code,
      title: 'Please sign in again',
      message: 'Your session has expired.',
      retryable: false,
    };
  }
  if (code === 'failed-precondition') {
    // Often: query needs a composite index that isn't deployed yet.
    return {
      code,
      title: "We couldn't load that yet",
      message: 'Something needs to finish setting up. Try again in a moment.',
      retryable: true,
    };
  }
  if (code === 'resource-exhausted') {
    return {
      code,
      title: 'Daily limit reached',
      message: 'We hit our usage limit. Try again later.',
      retryable: false,
    };
  }

  return {
    code: code || 'unknown',
    title: 'Something went wrong',
    message: "We couldn't complete that just now. Please try again.",
    retryable: true,
  };
}

export function prettyAuthError(e: unknown): FriendlyError {
  const code = codeOf(e);

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { code, title: 'Sign-in failed', message: 'Email or password is incorrect.', retryable: false };
    case 'auth/email-already-in-use':
      return { code, title: 'Account already exists', message: 'An account with this email already exists. Try signing in instead.', retryable: false };
    case 'auth/weak-password':
      return { code, title: 'Password too short', message: 'Use at least 8 characters.', retryable: false };
    case 'auth/invalid-email':
      return { code, title: 'Invalid email', message: 'Check the email address and try again.', retryable: false };
    case 'auth/too-many-requests':
      return { code, title: 'Too many attempts', message: 'Wait a minute and try again.', retryable: true };
    case 'auth/network-request-failed':
      return { code, title: 'Connection problem', message: 'Check your internet connection.', retryable: true };
    case 'auth/operation-not-allowed':
      return { code, title: "Sign-in isn't enabled", message: 'Contact your administrator.', retryable: false };
    default:
      return {
        code: code || 'unknown',
        title: 'Sign-in failed',
        message: e instanceof Error ? e.message : "Something didn't work — please try again.",
        retryable: true,
      };
  }
}

/** Console log the raw error in dev for the operator. */
export function logRaw(label: string, e: unknown) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[kinesis:${label}]`, e);
  }
}
