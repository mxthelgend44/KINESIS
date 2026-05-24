'use client';

import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDb } from '../client';

/**
 * Sample-data seeder for the clinician dashboard.
 *
 * The previous version wrote sessions/alerts/messages with
 * `patientId = clinician.uid` — that satisfies the security rules but the
 * cohort table reads from the `patients` collection, so those sessions
 * had no patient to render under and the demo data was invisible.
 *
 * This version creates *real* fake patient docs with deterministic IDs
 * `sample_<clinicId>_<n>`, then ties sessions / alerts / messages /
 * medications / appointments to those patients. The Firestore rules
 * include a carve-out that lets a same-clinic clinician create / update /
 * delete docs whose ID starts with `sample_`, so no admin SDK is needed.
 *
 * All sample patient docs (and every related row) are tagged with
 * `__sample: true` so `clearSampleData` removes them precisely without
 * touching real data.
 *
 * Queries are kept single-field (just `patientId == X`) so they don't
 * require composite Firestore indexes.
 */

const SAMPLE_MARKER = '__sample';

function samplePatientId(clinicId: string, n: number): string {
  // Rules check for the `sample_` prefix on user-id strings.
  return `sample_${clinicId}_${n}`;
}

const SAMPLE_PROFILES = [
  {
    fullName: 'Sarah Chen',
    email: 'sarah.chen+sample@kinesis.dev',
    age: 42,
    sex: 'F' as const,
    condition: 'ACL · Right knee',
    weekNum: 5,
    weekTotal: 12,
    compliance: 'green' as const,
    primaryExercise: 'knee-flexion',
    primaryJoints: ['right_knee', 'left_knee'],
  },
  {
    fullName: 'Marcus Patel',
    email: 'marcus.patel+sample@kinesis.dev',
    age: 58,
    sex: 'M' as const,
    condition: 'Rotator cuff · Left shoulder',
    weekNum: 8,
    weekTotal: 14,
    compliance: 'amber' as const,
    primaryExercise: 'shoulder-abduction',
    primaryJoints: ['left_shoulder'],
  },
  {
    fullName: 'Lila Okonkwo',
    email: 'lila.okonkwo+sample@kinesis.dev',
    age: 31,
    sex: 'F' as const,
    condition: 'Hip arthroplasty · Right',
    weekNum: 2,
    weekTotal: 16,
    compliance: 'red' as const,
    primaryExercise: 'hip-extension',
    primaryJoints: ['right_hip'],
  },
];

type SeedResult = {
  patients: number;
  sessions: number;
  alerts: number;
  messages: number;
  medications: number;
  appointments: number;
  skipped: string[];
};

export async function hasSampleData(_uid: string, clinicId: string): Promise<boolean> {
  // Single doc.get — no composite index, no permission edge cases.
  const ref = doc(getDb(), 'patients', samplePatientId(clinicId, 0));
  const snap = await getDoc(ref);
  return snap.exists();
}

export async function seedSampleData(input: {
  uid: string;
  clinicId: string;
}): Promise<SeedResult> {
  const db = getDb();
  const now = Date.now();
  const result: SeedResult = {
    patients: 0,
    sessions: 0,
    alerts: 0,
    messages: 0,
    medications: 0,
    appointments: 0,
    skipped: [],
  };

  const skip = (label: string) => {
    if (!result.skipped.includes(label)) result.skipped.push(label);
  };
  const tryWrite = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      if (code === 'permission-denied') {
        skip(label);
        // eslint-disable-next-line no-console
        console.warn(`[sample-data:${label}] permission denied`, e);
        return false;
      }
      // eslint-disable-next-line no-console
      console.warn(`[sample-data:${label}]`, e);
      throw e;
    }
  };

  // ── 1. Patient docs ────────────────────────────────────────────────────
  const patientIds: string[] = [];
  for (let i = 0; i < SAMPLE_PROFILES.length; i++) {
    const profile = SAMPLE_PROFILES[i]!;
    const id = samplePatientId(input.clinicId, i);
    const ok = await tryWrite('patients', () =>
      setDoc(doc(db, 'patients', id), {
        clinicId: input.clinicId,
        primaryClinicianId: input.uid,
        fullName: profile.fullName,
        email: profile.email,
        age: profile.age,
        sex: profile.sex,
        condition: profile.condition,
        surgeryDate: new Date(now - profile.weekNum * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        weekNum: profile.weekNum,
        weekTotal: profile.weekTotal,
        compliance: profile.compliance,
        avatarUrl: null,
        createdAt: serverTimestamp(),
        [SAMPLE_MARKER]: true,
      }),
    );
    if (ok) {
      patientIds.push(id);
      result.patients++;
    }
  }

  if (patientIds.length === 0) {
    // If we couldn't write any sample patients, the rest will all fail in
    // the same way — bail with the clear message.
    return result;
  }

  // ── 2. Sessions ────────────────────────────────────────────────────────
  // Each patient gets a spread of past sessions with realistic numbers.
  for (let pIdx = 0; pIdx < patientIds.length; pIdx++) {
    const pid = patientIds[pIdx]!;
    const profile = SAMPLE_PROFILES[pIdx]!;
    const joints = profile.primaryJoints;
    const sessionCount = 4 + pIdx; // 4, 5, 6 sessions
    for (let s = 0; s < sessionCount; s++) {
      const daysAgo = (s + 1) * 1.8;
      const startedAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
      const endedAt = new Date(startedAt.getTime() + (8 + Math.random() * 12) * 60 * 1000);
      const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
      const baseQuality =
        profile.compliance === 'green' ? 82
        : profile.compliance === 'amber' ? 64
        : 48;
      const avgQuality = clamp(0, 100, baseQuality + Math.round((Math.random() - 0.5) * 16));
      const classification =
        avgQuality >= 75 ? 'normal'
        : avgQuality >= 55 ? 'compensatory'
        : 'guarded';
      const reps = 8 + Math.floor(Math.random() * 14);
      const peakRom: Record<string, number> = {};
      const minAngle: Record<string, number> = {};
      const maxAngle: Record<string, number> = {};
      for (const jk of joints) {
        const rom = 50 + Math.random() * 80;
        const mn = 15 + Math.random() * 25;
        peakRom[jk] = Math.round(rom);
        minAngle[jk] = Math.round(mn);
        maxAngle[jk] = Math.round(mn + rom);
      }
      const ok = await tryWrite('sessions', () =>
        addDoc(collection(db, 'sessions'), {
          patientId: pid,
          clinicId: input.clinicId,
          exerciseId: profile.primaryExercise,
          jointKeys: joints,
          startedAt: Timestamp.fromDate(startedAt),
          endedAt: Timestamp.fromDate(endedAt),
          durationSeconds,
          reps,
          avgQuality,
          classification,
          peakRom,
          minAngle,
          maxAngle,
          painScore: 1 + Math.floor(Math.random() * 5),
          notes: null,
          isLive: false,
          aiSummary:
            s === 0
              ? `Sample summary: ${reps} reps of ${profile.primaryExercise.replace(/-/g, ' ')}. Quality ${avgQuality}/100. Movement classified ${classification}.`
              : null,
          [SAMPLE_MARKER]: true,
        }),
      );
      if (ok) result.sessions++;
    }
  }

  // ── 3. Alerts ──────────────────────────────────────────────────────────
  const alertSeed = [
    { pIdx: 1, severity: 'warning', title: 'Asymmetry trending up', description: 'Left/right ROM gap widened from 8° to 21° this week.' },
    { pIdx: 2, severity: 'critical', title: 'Quality dropped below 50', description: 'Avg quality fell from 62 → 42 over 3 sessions on the right hip.' },
    { pIdx: 2, severity: 'warning', title: 'Pain score spiking',     description: 'Self-reported pain score 7/10 after last session.' },
    { pIdx: 0, severity: 'info',    title: 'On track this week',     description: '4 sessions logged against a target of 5. Compliance: green.' },
  ];
  for (const a of alertSeed) {
    if (!patientIds[a.pIdx]) continue;
    const ok = await tryWrite('alerts', () =>
      addDoc(collection(db, 'alerts'), {
        patientId: patientIds[a.pIdx]!,
        clinicId: input.clinicId,
        severity: a.severity,
        title: a.title,
        description: a.description,
        relatedSessionId: null,
        status: 'open',
        acknowledgedBy: null,
        acknowledgedAt: null,
        createdAt: serverTimestamp(),
        [SAMPLE_MARKER]: true,
      }),
    );
    if (ok) result.alerts++;
  }

  // ── 4. Messages ────────────────────────────────────────────────────────
  const messageSeed = [
    { pIdx: 0, body: 'Great work this week — keep the same cadence.' },
    { pIdx: 1, body: 'Noticed the asymmetry creeping back. Try the slow eccentric variation tomorrow.' },
    { pIdx: 2, body: 'Pause heavy work for 48h. Schedule a check-in if pain stays above 5/10.' },
  ];
  for (const m of messageSeed) {
    if (!patientIds[m.pIdx]) continue;
    const ok = await tryWrite('messages', () =>
      addDoc(collection(db, 'messages'), {
        patientId: patientIds[m.pIdx]!,
        clinicianId: input.uid,
        clinicId: input.clinicId,
        senderRole: 'clinician',
        body: m.body,
        attachedSessionId: null,
        readAt: null,
        createdAt: serverTimestamp(),
        [SAMPLE_MARKER]: true,
      }),
    );
    if (ok) result.messages++;
  }

  // ── 5. Medications ─────────────────────────────────────────────────────
  const medSeed: Array<{
    pIdx: number;
    name: string;
    dose: string;
    frequency: string;
    times: string[];
    notes: string;
  }> = [
    { pIdx: 0, name: 'Ibuprofen',      dose: '400mg', frequency: 'twice-daily',     times: ['08:00', '20:00'], notes: 'Take with food.' },
    { pIdx: 1, name: 'Acetaminophen',  dose: '500mg', frequency: 'three-times-daily', times: ['08:00', '14:00', '20:00'], notes: 'Up to 3000mg/day.' },
    { pIdx: 2, name: 'Naproxen',       dose: '250mg', frequency: 'twice-daily',     times: ['09:00', '21:00'], notes: 'With breakfast and dinner.' },
    { pIdx: 2, name: 'Cyclobenzaprine',dose: '5mg',   frequency: 'once-daily',      times: ['22:00'],          notes: 'At bedtime — may cause drowsiness.' },
  ];
  const startISO = new Date(now).toISOString().slice(0, 10);
  const endISO = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const m of medSeed) {
    if (!patientIds[m.pIdx]) continue;
    const ok = await tryWrite('medications', () =>
      addDoc(collection(db, 'medications'), {
        patientId: patientIds[m.pIdx]!,
        clinicId: input.clinicId,
        prescribedBy: input.uid,
        name: m.name,
        dose: m.dose,
        frequency: m.frequency,
        times: m.times,
        startDate: startISO,
        endDate: endISO,
        notes: m.notes,
        active: true,
        createdAt: serverTimestamp(),
        [SAMPLE_MARKER]: true,
      }),
    );
    if (ok) result.medications++;
  }

  // ── 6. Appointments ────────────────────────────────────────────────────
  const apptSeed: Array<{ pIdx: number; offsetDays: number; hour: number; minute: number; duration: number; type: string; notes: string }> = [
    { pIdx: 0, offsetDays: 2,  hour: 10, minute: 0,  duration: 30, type: 'in-person', notes: 'Follow-up — knee ROM check.' },
    { pIdx: 1, offsetDays: 4,  hour: 14, minute: 30, duration: 45, type: 'tele',      notes: 'Shoulder progress review.' },
    { pIdx: 2, offsetDays: 1,  hour: 9,  minute: 0,  duration: 45, type: 'in-person', notes: 'Hip evaluation — pain workup.' },
    { pIdx: 0, offsetDays: 9,  hour: 11, minute: 0,  duration: 30, type: 'in-person', notes: 'Mid-program review.' },
  ];
  for (const a of apptSeed) {
    if (!patientIds[a.pIdx]) continue;
    const dt = new Date(now + a.offsetDays * 24 * 60 * 60 * 1000);
    dt.setHours(a.hour, a.minute, 0, 0);
    const ok = await tryWrite('appointments', () =>
      addDoc(collection(db, 'appointments'), {
        patientId: patientIds[a.pIdx]!,
        clinicId: input.clinicId,
        clinicianId: input.uid,
        scheduledAt: Timestamp.fromDate(dt),
        durationMinutes: a.duration,
        type: a.type,
        status: 'scheduled',
        notes: a.notes,
        createdAt: serverTimestamp(),
        [SAMPLE_MARKER]: true,
      }),
    );
    if (ok) result.appointments++;
  }

  return result;
}

export async function clearSampleData(input: {
  uid: string;
  clinicId: string;
}): Promise<{ removed: number; skipped: string[] }> {
  const db = getDb();
  let removed = 0;
  const skipped: string[] = [];

  const patientIds: string[] = [];
  for (let i = 0; i < 8; i++) patientIds.push(samplePatientId(input.clinicId, i));

  // Drop every doc tied to a sample patient ID. All queries are single-field
  // on `patientId` so no composite index is required. We don't even filter
  // by __sample — anything pointing at a sample_* patient ID *is* sample
  // data (real patients can't have sample_* IDs).
  const collections = ['sessions', 'alerts', 'medications', 'appointments', 'messages', 'medicationLogs', 'painCheckins'];
  for (const coll of collections) {
    for (const pid of patientIds) {
      try {
        const q = query(collection(db, coll), where('patientId', '==', pid));
        const snap = await getDocs(q);
        if (snap.empty) continue;
        let batch = writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
          batch.delete(d.ref);
          n++;
          if (n === 400) {
            await batch.commit();
            batch = writeBatch(db);
            n = 0;
          }
        }
        if (n > 0) await batch.commit();
        removed += snap.size;
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code ?? '';
        if (code === 'permission-denied') {
          if (!skipped.includes(coll)) skipped.push(coll);
          // eslint-disable-next-line no-console
          console.warn(`[sample-data:clear:${coll}] permission denied`, e);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[sample-data:clear:${coll}]`, e);
        }
      }
    }
  }

  // Finally delete the patient docs themselves.
  for (const pid of patientIds) {
    try {
      const ref = doc(db, 'patients', pid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await deleteDoc(ref);
        removed++;
      }
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      if (code === 'permission-denied') {
        if (!skipped.includes('patients')) skipped.push('patients');
        // eslint-disable-next-line no-console
        console.warn(`[sample-data:clear:patients] permission denied`, e);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[sample-data:clear:patients]`, e);
      }
    }
  }

  return { removed, skipped };
}

function clamp(min: number, max: number, n: number): number {
  return Math.max(min, Math.min(max, n));
}
