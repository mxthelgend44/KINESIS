'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { KinesisWordmark } from '@kinesis/ui';
import { signOut } from '@kinesis/db';

type NavItem = {
  href: string;
  label: string;
  countKey?: 'patients' | 'alerts';
  icon: React.ReactNode;
};

const ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Command Centre',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/patients',
    label: 'Patients',
    countKey: 'patients',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21c0-3 3-6 7-6s7 3 7 6" />
        <circle cx="17" cy="6" r="3" />
        <path d="M22 18c0-2-2-4-5-4" />
      </svg>
    ),
  },
  {
    href: '/alerts',
    label: 'Alerts',
    countKey: 'alerts',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 0 0 4 0" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M3 21V3M3 21h18M7 17v-6M12 17v-9M17 17v-4" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 13h6M9 17h6" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.8a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.4a7 7 0 0 0-2.1 1.2L5.1 5.8 3.1 9.2l2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.8a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.4a7 7 0 0 0 2.1-1.2l2.4.8 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
      </svg>
    ),
  },
];

type ClinicianInfo = {
  full_name: string;
  email: string;
  initials: string;
  patientCount: number;
  openAlertCount: number;
  liveSessionCount: number;
};

export function Sidebar({ initial }: { initial: ClinicianInfo }) {
  const pathname = usePathname();
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace('/sign-in');
  };

  return (
    <aside
      style={{
        width: 232,
        background: '#0E1822',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 14px',
        borderRight: '1px solid #2A3441',
        position: 'sticky',
        top: 0,
        height: '100vh',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '4px 10px 22px' }}>
        <KinesisWordmark color="#fff" size={13} />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 10px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.04)',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            background: '#D7E8E1',
            color: '#114A3F',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {initial.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k-sans" style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {initial.full_name}
          </div>
          <div className="k-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>
            CLINICIAN
          </div>
        </div>
        <button onClick={onSignOut} title="Sign out" style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {ITEMS.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const count =
            item.countKey === 'patients' ? initial.patientCount : item.countKey === 'alerts' ? initial.openAlertCount : undefined;
          const isCritical = item.countKey === 'alerts' && initial.openAlertCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
                background: isActive ? '#1A6B5A' : 'transparent',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
              }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: isCritical ? '#C44545' : 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: initial.liveSessionCount > 0 ? '#5BD6A0' : 'rgba(255,255,255,0.3)',
              boxShadow: initial.liveSessionCount > 0 ? '0 0 6px #5BD6A0' : 'none',
            }}
          />
          <span className="k-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
            {initial.liveSessionCount > 0 ? `${initial.liveSessionCount} LIVE` : 'IDLE'} · CLOUD SYNCED
          </span>
        </div>
        <div className="k-sans" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          {initial.patientCount} patients
        </div>
      </div>
    </aside>
  );
}
