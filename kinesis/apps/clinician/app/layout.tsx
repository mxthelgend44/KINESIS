import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@kinesis/db/AuthProvider';
import { ToastProvider, ErrorBoundary } from '@kinesis/ui';

export const metadata: Metadata = {
  title: 'KINESIS Clinician',
  description: 'AI-driven rehabilitation monitoring dashboard for clinicians.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0E1822',
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
