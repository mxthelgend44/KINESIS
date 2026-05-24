import type { Patient, Session } from '@kinesis/db';
import { tsToDate } from '@kinesis/db';

export type CohortRow = Patient & {
  isLive: boolean;
  rom: number;
  romPct: number;
  q: number;
  qC: 'sage' | 'amber' | 'coral';
  alerts: number;
  initials: string;
  last: string;
  wk: string;
};

export function buildCohortRow(
  p: Patient,
  liveSessionIds: Set<string>,
  lastSessions: Map<string, Session>,
  alertCounts: Map<string, number>,
): CohortRow {
  const last = lastSessions.get(p.id);
  const rom = last ? Math.max(0, ...(Object.values(last.peakRom) as number[])) : 0;
  const romPct = Math.round(Math.min(100, (rom / 120) * 100));
  const q = last?.avgQuality ?? 0;
  const qC: CohortRow['qC'] = q >= 80 ? 'sage' : q >= 60 ? 'amber' : q > 0 ? 'coral' : 'sage';
  const initials = p.fullName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return {
    ...p,
    isLive: liveSessionIds.has(p.id),
    rom,
    romPct,
    q,
    qC,
    alerts: alertCounts.get(p.id) ?? 0,
    initials,
    last: last ? relativeTime(tsToDate(last.startedAt)) : '—',
    wk: `${p.weekNum}/${p.weekTotal}`,
  };
}

export function relativeTime(d: Date | null): string {
  if (!d) return '—';
  const ts = d.getTime();
  const now = Date.now();
  const diffM = Math.floor((now - ts) / 60_000);
  if (diffM < 1) return 'just now';
  if (diffM < 60) return `Today, ${formatHM(d)}`;
  if (d.toDateString() === new Date(now).toDateString()) {
    return `Today, ${formatHM(d)}`;
  }
  const diffH = Math.floor(diffM / 60);
  if (diffH < 48) return 'Yesterday';
  const days = Math.floor(diffH / 24);
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

function formatHM(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
