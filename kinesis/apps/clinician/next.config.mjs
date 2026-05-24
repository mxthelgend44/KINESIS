/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled because StrictMode's double-mount in dev triggers Firestore's
  // ca9/b815 internal assertions (onSnapshot subscribes twice → SDK
  // target-ID state machine races on the duplicate RESET). Production
  // doesn't double-mount, so this is a dev-only mitigation.
  reactStrictMode: false,
  transpilePackages: ['@kinesis/ui', '@kinesis/db', '@kinesis/pose'],
  experimental: {
    typedRoutes: false,
    // Tree-shake Firebase submodule imports. Each clinician page only
    // pulls the exports it actually uses, which keeps the per-page
    // chunk small in dev mode and the compile + navigation fast.
    optimizePackageImports: ['firebase', 'firebase/auth', 'firebase/firestore', 'firebase/app'],
  },
};

export default nextConfig;
