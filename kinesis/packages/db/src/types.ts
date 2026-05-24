// Firestore document shapes. IDs come from the doc reference (not duplicated in the doc data).

import type { Timestamp } from 'firebase/firestore';

export type Sex = 'M' | 'F' | 'O';
export type RecoveryCompliance = 'green' | 'amber' | 'red';
export type ExerciseCategory = 'arm' | 'leg' | 'mixed' | 'cardio' | 'balance';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type Classification = 'normal' | 'compensatory' | 'guarded' | 'abnormal';
export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type SenderRole = 'patient' | 'clinician';

/** A Firestore Timestamp or a JS Date or null. Use `toMillis` helper. */
export type TS = Timestamp | Date | null;

export type Clinic = {
  id: string;                  // doc id, populated from the snapshot
  name: string;
  inviteCode: string;
  createdAt: TS;
};

export type Clinician = {
  id: string;                  // === auth uid
  clinicId: string;
  fullName: string;
  email: string;
  title: string | null;
  avatarUrl: string | null;
  createdAt: TS;
};

export type Patient = {
  id: string;                  // === auth uid
  clinicId: string;
  primaryClinicianId: string | null;
  fullName: string;
  email: string;
  age: number | null;
  sex: Sex | null;
  condition: string | null;
  surgeryDate: string | null;  // ISO date
  weekNum: number;
  weekTotal: number;
  compliance: RecoveryCompliance;
  avatarUrl: string | null;
  createdAt: TS;
};

export type Exercise = {
  id: string;
  clinicId: string | null;
  name: string;
  description: string | null;
  category: ExerciseCategory;
  difficulty: Difficulty;
  defaultJoints: string[];
  targetRom: number | null;
  durationMin: number | null;
  thumbnailUrl: string | null;
  demoVideoUrl: string | null;
};

export type Prescription = {
  id: string;
  patientId: string;
  exerciseId: string;
  prescribedBy: string;
  sets: number;
  reps: number;
  frequencyPerWeek: number;
  notes: string | null;
  active: boolean;
  createdAt: TS;
};

export type RepStat = {
  /** rep number, 1-indexed */
  index: number;
  /** seconds from session start at which the rep completed */
  tSec: number;
  /** seconds since the previous rep */
  intervalSec: number;
  /** range of motion for this rep, degrees */
  romDeg: number;
  /** peak (max) angle reached */
  peakAngle: number;
  /** trough (min) angle reached */
  troughAngle: number;
  /** mean angular speed during the rep, deg/s */
  meanSpeed: number;
  /** up-down symmetry, 0..1 (1 = perfectly symmetric) */
  symmetry: number;
};

export type Session = {
  id: string;
  patientId: string;
  clinicId: string;            // denormalized for clinic-scoped queries
  exerciseId: string | null;
  jointKeys: string[];
  startedAt: TS;
  endedAt: TS;
  durationSeconds: number;
  reps: number;
  avgQuality: number;
  classification: Classification | null;
  peakRom: Record<string, number>;
  minAngle: Record<string, number>;
  maxAngle: Record<string, number>;
  /** Per-rep stats for the primary tracked joint. Capped at 100 entries. */
  repStats?: RepStat[];
  painScore: number | null;
  notes: string | null;
  isLive: boolean;
  /** AI-generated summary text (filled by Cloud Function on finalize). */
  aiSummary?: string | null;
};

export type SessionSample = {
  // stored in sub-collection sessions/{sessionId}/samples/{autoId}
  tMs: number;
  joints: Record<string, number>;
  createdAt: TS;
};

export type Message = {
  id: string;
  patientId: string;
  clinicianId: string;
  clinicId: string;            // denormalized
  senderRole: SenderRole;
  body: string;
  attachedSessionId: string | null;
  readAt: TS;
  createdAt: TS;
};

export type Alert = {
  id: string;
  patientId: string;
  clinicId: string;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  relatedSessionId: string | null;
  status: AlertStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: TS;
  createdAt: TS;
};

export type PainFeeling = 'worse' | 'same' | 'better' | 'great';

export type PainCheckin = {
  id: string;
  patientId: string;
  score: number;
  note: string | null;
  /** Optional — set when a check-in is filed right after a session. */
  sessionId?: string | null;
  exerciseId?: string | null;
  feeling?: PainFeeling | null;
  createdAt: TS;
};

export type MedicationFrequency =
  | 'once-daily'
  | 'twice-daily'
  | 'three-times-daily'
  | 'four-times-daily'
  | 'as-needed'
  | 'weekly';

export type Medication = {
  id: string;
  patientId: string;
  clinicId: string;
  prescribedBy: string;
  name: string;
  dose: string;             // e.g. "400mg", "2 tablets"
  frequency: MedicationFrequency;
  /** Time-of-day reminders, "HH:MM" in patient-local time. */
  times: string[];
  startDate: string;        // ISO date
  endDate: string | null;   // ISO date or null = ongoing
  notes: string | null;
  active: boolean;
  createdAt: TS;
};

export type MedicationLog = {
  id: string;
  medicationId: string;
  patientId: string;
  takenAt: TS;
  note: string | null;
};

/**
 * A recorded motion-capture clip. Each frame holds the quaternion
 * rotations for the driven bones at that moment — replayable on any
 * skeleton with matching bone names.
 *
 * Frames live inline on the doc to keep playback a single read. A 30s
 * clip at 25 fps with ~11 bones is ~30 KB of JSON — well under the
 * 1 MiB Firestore doc limit. For longer or higher-rate captures, move
 * the frames array into Firebase Storage and store just the URL here.
 */
export type MotionCaptureFrame = {
  tMs: number;
  /** Map of bone name → quaternion [x, y, z, w]. Used when the capture
   *  was driven by a rigged GLB and we recorded bone rotations. */
  bones?: Record<string, [number, number, number, number]>;
  /** Flat [x0,y0,z0,x1,y1,z1,…] world positions for each MediaPipe
   *  landmark (33 of them, 99 numbers total). Used when the capture
   *  was driven by the parametric skeleton viewer — simpler + smaller. */
  xyz?: number[];
};

export type MotionCapture = {
  id: string;
  patientId: string;
  clinicId: string;
  sessionId: string | null;
  exerciseId: string | null;
  name: string;
  /** Avatar / skeleton this capture was recorded against. */
  rigUrl: string;
  durationMs: number;
  frameCount: number;
  /** Sample rate the recorder ran at, Hz. Informational. */
  sampleRateHz: number;
  frames: MotionCaptureFrame[];
  createdAt: TS;
};

export type AppointmentType = 'in-person' | 'tele' | 'home-visit' | 'other';
export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no-show';

export type Appointment = {
  id: string;
  patientId: string;
  clinicId: string;
  clinicianId: string;
  scheduledAt: TS;
  durationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: TS;
};

// Helper — Firestore Timestamps to millis.
export function tsToMillis(t: TS): number | null {
  if (!t) return null;
  if (t instanceof Date) return t.getTime();
  // duck-type the Firestore Timestamp shape
  if (typeof (t as Timestamp).toMillis === 'function') return (t as Timestamp).toMillis();
  return null;
}

export function tsToDate(t: TS): Date | null {
  const ms = tsToMillis(t);
  return ms === null ? null : new Date(ms);
}
