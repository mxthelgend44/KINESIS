import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'health.kinesis.patient',
  appName: 'KINESIS',
  webDir: 'out',
  bundledWebRuntime: false,
  ios: { contentInset: 'always' },
  android: { allowMixedContent: false },
  // For dev — point Capacitor at the live dev server.
  // Comment out the `server` block before producing a release build.
  server: process.env.CAP_LIVE_RELOAD_URL
    ? { url: process.env.CAP_LIVE_RELOAD_URL, cleartext: false }
    : undefined,
};

export default config;
