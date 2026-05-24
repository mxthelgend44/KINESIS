import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@kinesis/db/AuthProvider';
import { ToastProvider, ErrorBoundary } from '@kinesis/ui';

export const metadata: Metadata = {
  title: 'KINESIS',
  description: 'AI-driven rehabilitation monitoring — your daily companion.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'KINESIS' },
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAF8F4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
