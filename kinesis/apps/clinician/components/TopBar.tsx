'use client';

import { useEffect, useState } from 'react';

export function TopBar({ crumbs = ['Patients'] }: { crumbs?: string[] }) {
  const [now, setNow] = useState<string>(() => fmt(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(fmt(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      style={{
        height: 56,
        background: '#FFFFFF',
        borderBottom: '1px solid #E5E1D8',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span style={{ color: '#9AA3AC' }}>/</span>}
            <span
              className="k-sans"
              style={{
                fontSize: 13,
                color: i === crumbs.length - 1 ? '#0E1822' : '#6B7785',
                fontWeight: i === crumbs.length - 1 ? 600 : 500,
              }}
            >
              {c}
            </span>
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#F1EFE9',
          borderRadius: 8,
          padding: '6px 12px',
          width: 280,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7785" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          placeholder="Search patients, sessions, exercises…"
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: 13,
            color: '#0E1822',
            fontFamily: 'inherit',
          }}
        />
        <span
          className="k-mono"
          style={{
            fontSize: 9,
            color: '#9AA3AC',
            padding: '2px 5px',
            background: '#fff',
            borderRadius: 4,
            border: '1px solid #E5E1D8',
          }}
        >
          ⌘K
        </span>
      </div>
      <span className="k-mono" style={{ fontSize: 10, color: '#6B7785', marginLeft: 16 }}>
        {now}
      </span>
    </div>
  );
}

function fmt(d: Date) {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${hh}:${mm}`;
}
