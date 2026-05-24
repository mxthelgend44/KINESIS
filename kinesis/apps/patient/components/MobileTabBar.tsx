'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  icon: (color: string, filled: boolean) => React.ReactNode;
};

const TABS: Tab[] = [
  {
    href: '/',
    label: 'Home',
    icon: (c, f) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={f ? c : 'none'} stroke={c} strokeWidth="1.6">
        <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/session',
    label: 'Session',
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6 v6 l4 2" />
      </svg>
    ),
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5-5 4 4 8-9" />
        <path d="M14 7h6v6" />
      </svg>
    ),
  },
  {
    href: '/care',
    label: 'Care',
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c-1.7 1.8-4.4 3.8-7 6-2.6-2.2-5.3-4.2-7-6a4.5 4.5 0 0 1 7-5.5 4.5 4.5 0 0 1 7 5.5z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export function MobileTabBar({ dark = false }: { dark?: boolean }) {
  const pathname = usePathname();

  const bg = dark ? 'rgba(15,24,34,0.85)' : 'rgba(255,255,255,0.92)';
  const border = dark ? 'rgba(255,255,255,0.06)' : '#E5E1D8';

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 'max(env(safe-area-inset-bottom), 14px)',
        paddingTop: 10,
        background: bg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${border}`,
        display: 'flex',
        justifyContent: 'space-around',
        zIndex: 50,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        const c = isActive ? (dark ? '#7AB89A' : '#1A6B5A') : dark ? 'rgba(255,255,255,0.45)' : '#9AA3AC';
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '4px 12px',
              textDecoration: 'none',
            }}
          >
            {tab.icon(c, isActive)}
            <span className="k-sans" style={{ fontSize: 10, color: c, fontWeight: isActive ? 600 : 500 }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
