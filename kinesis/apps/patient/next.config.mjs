/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disabled because StrictMode's double-mount in dev triggers Firestore's
  // ca9/b815 internal assertions (onSnapshot subscribes twice → SDK
  // target-ID state machine races on the duplicate RESET). Production
  // doesn't double-mount, so this is a dev-only mitigation.
  reactStrictMode: false,
  transpilePackages: ['@kinesis/ui', '@kinesis/db', '@kinesis/pose', '@kinesis/imu'],
  experimental: {
    // Tree-shake submodule imports. Without this, `import { getDocs } from
    // 'firebase/firestore'` pulls the whole Firestore SDK into every page
    // chunk — dev compile times balloon and First Load JS bloats. With it
    // each page only pulls the exports it actually uses.
    optimizePackageImports: ['firebase', 'firebase/auth', 'firebase/firestore', 'firebase/app'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
