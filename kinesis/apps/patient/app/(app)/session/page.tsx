'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ROMGauge, useToast } from '@kinesis/ui';
import {
  LimbSelector,
  JOINTS,
  RepCounter,
  scoreQuality,
  pairOf,
  getExerciseInstructions,
  ExerciseAnimation,
  type JointKey,
  type LiveFrame,
  type Classification,
  type RepEvent,
  type PoseTrackerStatus,
} from '@kinesis/pose';
import { fuseAngles } from '@kinesis/imu';
import { useAuth, type RepStat } from '@kinesis/db';
import { logPainCheckin } from '@kinesis/db/queries/pain';

// PoseTracker pulls MediaPipe + WASM (~6MB lazy load), ImuPanel pulls
// the IMU stack, and MeshTracker pulls three.js + react-three-fiber +
// the rigged GLB. Defer all three so the session page shell paints
// immediately and the heavy stuff streams in when the camera is needed.
const PoseTracker = dynamic(
  () => import('@kinesis/pose').then((m) => ({ default: m.PoseTracker })),
  { ssr: false, loading: () => <PoseTrackerSkeleton /> },
);
const ImuPanel = dynamic(
  () => import('@kinesis/imu').then((m) => ({ default: m.ImuPanel })),
  { ssr: false },
);
// Parametric skeleton viewer (spheres + cylinders directly from
// MediaPipe landmarks). Built from scratch because the rigged-GLB
// approach kept fighting us with rig naming + rest-axis conventions.
const SkeletonMesh = dynamic(
  () => import('@/components/MeshTracker/SkeletonMesh').then((m) => ({ default: m.SkeletonMesh })),
  { ssr: false },
);

function PoseTrackerSkeleton() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0A1118',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.55)',
        fontSize: 13,
      }}
    >
      Loading motion model…
    </div>
  );
}
import { listExercises, listPrescriptionsForPatient } from '@kinesis/db/queries/exercises';
import {
  createSession,
  updateLiveSession,
  finalizeSession,
  appendSessionSamples,
} from '@kinesis/db/queries/sessions';
import { saveMotionCapture } from '@kinesis/db/queries/motion-captures';
import { usePatientProfile } from '@/components/PatientProfileProvider';
import type { SkeletonMeshHandle } from '@/components/MeshTracker/SkeletonMesh';
import type { Exercise, Patient, Prescription } from '@kinesis/db';
import { countdown, repBeep, warningBeep, unlockAudio } from '@/lib/audio-cues';

const T = {
  night: '#0A1118',
  nightCard: '#162230',
  amber: '#D4824A',
  coral: '#C44545',
  sage: '#5C8A6E',
  teal: '#1A6B5A',
};

type LivePerJoint = {
  angle: number;
  min: number;
  max: number;
  reps: number;
  cadenceMs: number;
  prevAngle: number;
  prevT: number;
  prevVel: number;
  jerkAcc: number;
  jerkN: number;
  peakVel: number;
};

export default function SessionPageWrapper() {
  return (
    <Suspense fallback={<div style={{ background: T.night, color: '#fff', minHeight: '100vh' }} />}>
      <SessionPage />
    </Suspense>
  );
}

function SessionPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // Patient is already loaded by the (app) layout — read from context.
  const { patient } = usePatientProfile();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    let cancelled = false;
    (async () => {
      const [ex, pr] = await Promise.all([
        listExercises(),
        listPrescriptionsForPatient(auth.user.uid),
      ]);
      if (cancelled) return;
      setExercises(ex);
      setPrescriptions(pr);
    })();
    return () => { cancelled = true; };
  }, [auth.status, auth.user]);

  const initialExerciseId =
    params.get('exercise') ?? prescriptions[0]?.exerciseId ?? exercises[0]?.id ?? 'knee-flexion';
  const initialExercise = exercises.find((e) => e.id === initialExerciseId) ?? exercises[0];
  const fallbackJoints =
    (initialExercise?.defaultJoints as JointKey[] | undefined) ?? (['right_knee'] as JointKey[]);
  const initialJoints =
    (params.get('joints')?.split(',').filter(Boolean) as JointKey[] | undefined) ?? fallbackJoints;

  const [exerciseId, setExerciseId] = useState(initialExerciseId);
  // Track whether the user has manually picked an exercise. Once they have,
  // we leave it alone; before that, we keep snapping the default to the
  // first prescribed exercise as soon as prescriptions load.
  const [userPickedExercise, setUserPickedExercise] = useState(false);
  useEffect(() => {
    if (!exercises.length) return;
    // If the current selection isn't in the catalog, snap to the first
    // prescribed one (or the first catalog entry as a fallback).
    if (!exercises.find((e) => e.id === exerciseId)) {
      const firstPrescribed = prescriptions.find((p) => exercises.some((e) => e.id === p.exerciseId));
      setExerciseId(firstPrescribed?.exerciseId ?? exercises[0]!.id);
      return;
    }
    // First time prescriptions arrive — if the user hasn't picked yet, jump
    // to their prescribed exercise instead of whatever default we had.
    if (!userPickedExercise && prescriptions.length > 0) {
      const firstPrescribed = prescriptions.find((p) => exercises.some((e) => e.id === p.exerciseId));
      if (firstPrescribed && firstPrescribed.exerciseId !== exerciseId) {
        setExerciseId(firstPrescribed.exerciseId);
        const ex = exercises.find((e) => e.id === firstPrescribed.exerciseId);
        if (ex) setTrackedJoints(ex.defaultJoints as JointKey[]);
      }
    }
  }, [exercises, exerciseId, prescriptions, userPickedExercise]);
  const exercise = exercises.find((e) => e.id === exerciseId);
  const [trackedJoints, setTrackedJoints] = useState<JointKey[]>(initialJoints);
  const [paused, setPaused] = useState(false);
  const [armed, setArmed] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const liveRef = useRef<Partial<Record<JointKey, LivePerJoint>>>({});
  const repsRef = useRef<Partial<Record<JointKey, RepCounter>>>({});
  const sampleBufRef = useRef<{ tMs: number; joints: Record<string, number> }[]>([]);
  const lastSampleAt = useRef(0);
  const lastQualityAt = useRef(0);
  // IMU integration — primary joint can be augmented by a paired sensor.
  // We only re-render the badge/panel from the IMU hook; the angle itself
  // flows through this ref to avoid frame-rate React updates.
  const imuAngleRef = useRef<number | null>(null);
  const imuBoundJointRef = useRef<string | null>(null);
  const [imuState, setImuState] = useState<{ connected: boolean; bound: boolean; rateHz: number }>({
    connected: false,
    bound: false,
    rateHz: 0,
  });
  // Camera + tracker state. The PoseTracker only mounts when the user
  // explicitly clicks "Enable camera" — this guarantees `getUserMedia` is
  // called within a user gesture (some browsers, notably Safari, refuse to
  // prompt without one) and gives the user a clear opt-in moment.
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [poseStatus, setPoseStatus] = useState<PoseTrackerStatus>('idle');
  const [poseErrorMsg, setPoseErrorMsg] = useState<string>('');
  const [poseFps, setPoseFps] = useState(0);
  const [permissionState, setPermissionState] = useState<'unknown' | 'prompt' | 'granted' | 'denied'>('unknown');
  // Tracking accuracy preference. The 'lite' model runs at ~25 fps on
  // integrated GPUs; 'full' adds noticeable load but is more accurate;
  // 'heavy' is for clinic-grade recordings on a strong GPU. We default
  // to 'full' (balanced) — accuracy matters more than fps for ROM tracking.
  const [modelVariant, setModelVariant] = useState<'lite' | 'full' | 'heavy'>('full');
  // Post-session feedback modal.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  // The session is a two-step flow: (1) pick an exercise, (2) record. We
  // explicitly gate step 2 on a click so the patient is never dropped into
  // an active recording UI without first acknowledging what they're doing.
  // The default exercise selection still happens behind the scenes — once
  // the patient confirms, the rest of the UI uses that selection.
  const [exerciseConfirmed, setExerciseConfirmed] = useState(false);
  // 3D skeleton mirror + motion-capture state.
  const meshRef = useRef<SkeletonMeshHandle | null>(null);
  const [showMesh, setShowMesh] = useState(false);
  const [mocapActive, setMocapActive] = useState(false);
  const [mocapBusy, setMocapBusy] = useState(false);
  const [mocapFrameCount, setMocapFrameCount] = useState(0);

  const [, force] = useState(0);
  const [classification, setClassification] = useState<Classification>('normal');
  const [qualityScore, setQualityScore] = useState(100);

  useEffect(() => {
    if (!armed || paused) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [armed, paused]);

  // Poll the motion-capture buffer for a frame count to render — we
  // don't React-re-render on every captured frame (would thrash the
  // viewer), but a 4 Hz refresh lets the user see the counter tick.
  useEffect(() => {
    if (!mocapActive) return;
    const id = setInterval(() => {
      const n = meshRef.current?.frameCount() ?? 0;
      setMocapFrameCount(n);
    }, 250);
    return () => clearInterval(id);
  }, [mocapActive]);

  // Best-effort permission pre-check. Lets us tell the user "you previously
  // denied camera access — open your browser settings" *before* we render
  // the PoseTracker, which would otherwise throw an opaque permission error.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    // The Permissions API isn't supported on every browser (e.g. older
    // Safari). Failing gracefully is fine — we just show the default UI.
    type PermissionResultLike = { state: PermissionState; onchange?: (() => void) | null };
    type PermissionsLike = { query: (d: { name: PermissionName }) => Promise<PermissionResultLike> };
    const perms = (navigator as Navigator & { permissions?: PermissionsLike }).permissions;
    if (!perms?.query) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await perms.query({ name: 'camera' as PermissionName });
        if (cancelled) return;
        const apply = () => {
          const s = result.state;
          if (s === 'granted' || s === 'denied' || s === 'prompt') setPermissionState(s);
          else setPermissionState('unknown');
        };
        apply();
        result.onchange = apply;
      } catch {
        // Not all browsers accept "camera" as a name — that's OK.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Helper: fire the camera permission prompt synchronously from a user
  // gesture, then mount the PoseTracker (which will reuse the granted
  // permission and stream frames). We open + close a probe stream so the
  // tracker doesn't end up holding two MediaStreams at once.
  const enableCamera = useCallback(async () => {
    setPoseStatus('requesting-camera');
    setPoseErrorMsg('');
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      probe.getTracks().forEach((t) => t.stop());
      setCameraEnabled(true);
      setPermissionState('granted');
    } catch (e: unknown) {
      const message = (() => {
        if (e instanceof Error) return e.message;
        if (typeof e === 'object' && e !== null && 'name' in e) return String((e as { name: string }).name);
        return 'Could not start the camera.';
      })();
      const low = message.toLowerCase();
      if (low.includes('permission') || low.includes('notallowed') || low.includes('denied')) {
        setPermissionState('denied');
        setPoseErrorMsg('Camera permission denied. Open your browser site settings and allow camera access, then reload this page.');
      } else if (low.includes('notfound')) {
        setPoseErrorMsg('No camera was detected on this device.');
      } else if (low.includes('notreadable') || low.includes('in use')) {
        setPoseErrorMsg('Camera is in use by another app — close it and try again.');
      } else {
        setPoseErrorMsg(message);
      }
      setPoseStatus('error');
    }
  }, []);

  const retryCamera = useCallback(() => {
    setCameraEnabled(false);
    setPoseStatus('idle');
    setPoseErrorMsg('');
  }, []);

  // Push samples + header updates every 2s so clinician sees live motion.
  useEffect(() => {
    if (!armed || !sessionId) return;
    const id = setInterval(async () => {
      const buf = sampleBufRef.current;
      if (buf.length) {
        const samples = [...buf];
        sampleBufRef.current = [];
        await appendSessionSamples(sessionId, samples);
      }
      const totalReps = Object.values(liveRef.current).reduce((s, l) => s + (l?.reps ?? 0), 0);
      await updateLiveSession(sessionId, {
        reps: totalReps,
        avgQuality: qualityScore,
        classification,
      });
    }, 2000);
    return () => clearInterval(id);
  }, [armed, sessionId, qualityScore, classification]);

  const onFrame = useCallback(
    (frame: LiveFrame) => {
      if (paused) return;
      for (const k of Object.keys(frame.angles) as JointKey[]) {
        let ang = frame.angles[k];
        if (ang === undefined) continue;
        // If the IMU is paired to this joint, fuse its reading with the
        // camera angle. The fusion weight tilts toward the IMU when camera
        // confidence drops (out of frame, occluded). When confidence is
        // high, the camera dominates.
        if (
          imuBoundJointRef.current === k &&
          imuAngleRef.current !== null
        ) {
          const cConf = frame.confidence[k] ?? 0;
          const fused = fuseAngles({
            visionDeg: ang,
            visionConf: cConf,
            imuDeg: imuAngleRef.current,
          });
          if (fused !== null) ang = fused;
        }
        const live = liveRef.current[k] ?? (liveRef.current[k] = fresh());
        live.angle = ang;
        if (armed) {
          if (ang < live.min) live.min = ang;
          if (ang > live.max) live.max = ang;
          if (!isNaN(live.prevAngle) && live.prevT) {
            const dt = (frame.tMs - live.prevT) / 1000;
            if (dt > 0) {
              const vel = (ang - live.prevAngle) / dt;
              if (Math.abs(vel) > live.peakVel) live.peakVel = Math.abs(vel);
              const jerk = (vel - live.prevVel) / dt;
              live.jerkAcc += jerk * jerk;
              live.jerkN += 1;
              live.prevVel = vel;
            }
          }
          live.prevAngle = ang;
          live.prevT = frame.tMs;
          if (!repsRef.current[k]) {
            repsRef.current[k] = new RepCounter(JOINTS[k].rep.flexedBelow, JOINTS[k].rep.extendedAbove);
          }
          const conf = frame.confidence[k] ?? 1;
          const event = repsRef.current[k]!.update(ang, frame.tMs, conf);
          if (event) {
            // Only audio-cue the primary joint to avoid double-beeps
            if (k === trackedJoints[0]) {
              repBeep();
              if (event.romDeg < JOINTS[k].target.max * 0.5) warningBeep();
            }
          }
          live.reps = repsRef.current[k]!.count();
          live.cadenceMs = repsRef.current[k]!.cadenceMs();
        }
      }

      if (armed && frame.tMs - lastSampleAt.current > 200) {
        lastSampleAt.current = frame.tMs;
        const snap: Record<string, number> = {};
        for (const k of trackedJoints) {
          const a = frame.angles[k];
          if (a !== undefined) snap[k] = Math.round(a * 10) / 10;
        }
        sampleBufRef.current.push({ tMs: Math.floor(frame.tMs), joints: snap });
      }

      if (armed && frame.tMs - lastQualityAt.current > 600) {
        lastQualityAt.current = frame.tMs;
        const primary = trackedJoints[0];
        const live = primary ? liveRef.current[primary] : undefined;
        if (live) {
          const target = JOINTS[primary].target.max;
          const rom = isFinite(live.max - live.min) ? live.max - live.min : 0;
          const jerk = live.jerkN > 0 ? Math.sqrt(live.jerkAcc / live.jerkN) : 0;
          let asym = 0;
          const pair = pairOf(primary);
          if (pair && trackedJoints.includes(pair)) {
            const other = liveRef.current[pair];
            if (other && isFinite(other.max - other.min) && rom > 0) {
              const oRom = other.max - other.min;
              asym = Math.abs(rom - oRom) / Math.max(rom, oRom);
            }
          }
          const result = scoreQuality({
            romDeg: rom,
            targetRom: target,
            jerk,
            asymmetry: asym,
            cadenceMs: live.cadenceMs,
            cadenceVar: 0,
          });
          setClassification(result.classification);
          setQualityScore(result.score);
        }
        force((n) => n + 1);
      }
    },
    [paused, armed, trackedJoints],
  );

  const [counting, setCounting] = useState(false);
  const toast = useToast();

  const startRecording = async () => {
    // Guard against accidental clicks before the camera is live.
    if (!cameraEnabled || poseStatus !== 'running') {
      toast.error('Enable the camera before recording.');
      return;
    }
    // Unlock audio inside the user gesture so iOS plays the countdown.
    unlockAudio();
    setCounting(true);
    try {
      await countdown(3);
    } finally {
      setCounting(false);
    }

    try {
      const ref = await createSession({
        patientId: patient.id,
        clinicId: patient.clinicId,
        exerciseId: exerciseId,
        jointKeys: trackedJoints,
      });
      setSessionId(ref.id);
    } catch (e: unknown) {
      toast.error('Could not start session. Try again.');
      // eslint-disable-next-line no-console
      console.error('[session:create]', e);
      return;
    }
    liveRef.current = {};
    repsRef.current = {};
    sampleBufRef.current = [];
    // Per-model min-confidence threshold for the rep counter. The heavier
    // models produce cleaner landmarks, so we can afford to discard
    // anything below 0.7 (any lower would be noise on those models). The
    // lite model is more conservative — too tight a threshold there would
    // throw away usable frames during a real rep.
    const minConf =
      modelVariant === 'heavy' ? 0.7 : modelVariant === 'full' ? 0.6 : 0.5;
    for (const k of trackedJoints) {
      liveRef.current[k] = fresh();
      // Hysteresis margin and jump cap are also slightly tighter on the
      // higher-accuracy modes since the input noise floor is lower.
      const margin = modelVariant === 'lite' ? 5 : 4;
      const maxJump = modelVariant === 'lite' ? 40 : 30;
      repsRef.current[k] = new RepCounter(
        JOINTS[k].rep.flexedBelow,
        JOINTS[k].rep.extendedAbove,
        margin,
        minConf,
        500,
        maxJump,
      );
    }
    setElapsed(0);
    setArmed(true);
  };

  const onEnd = async () => {
    if (!armed || !sessionId) {
      router.push('/');
      return;
    }
    if (sampleBufRef.current.length) {
      try {
        await appendSessionSamples(sessionId, [...sampleBufRef.current]);
      } catch {
        // best-effort flush
      }
      sampleBufRef.current = [];
    }
    const peakROM: Record<string, number> = {};
    const minA: Record<string, number> = {};
    const maxA: Record<string, number> = {};
    let totalReps = 0;
    for (const k of trackedJoints) {
      const live = liveRef.current[k];
      if (!live) continue;
      const mn = isFinite(live.min) ? live.min : 0;
      const mx = isFinite(live.max) ? live.max : 0;
      peakROM[k] = Math.max(0, mx - mn);
      minA[k] = mn;
      maxA[k] = mx;
      totalReps += live.reps;
    }
    // Per-rep stats from the primary joint
    const primary = trackedJoints[0];
    const primaryCounter = primary ? repsRef.current[primary] : undefined;
    const repStats: RepStat[] = (primaryCounter?.history() ?? []).map((r: RepEvent) => ({
      index: r.index,
      tSec: r.tMs / 1000,
      intervalSec: r.intervalMs / 1000,
      romDeg: Math.round(r.romDeg * 10) / 10,
      peakAngle: Math.round(r.peakAngle * 10) / 10,
      troughAngle: Math.round(r.troughAngle * 10) / 10,
      meanSpeed: Math.round(r.meanSpeedDegPerSec * 10) / 10,
      symmetry: Math.round(r.symmetry * 100) / 100,
    }));

    try {
      await finalizeSession(sessionId, {
        reps: totalReps,
        avgQuality: qualityScore,
        classification,
        peakRom: peakROM,
        minAngle: minA,
        maxAngle: maxA,
        durationSeconds: elapsed,
        repStats,
      });
      toast.success(`Session saved — ${totalReps} reps, quality ${qualityScore}/100`);
    } catch {
      toast.error('Saved locally but cloud sync failed.');
    }
    // Pop the post-session feedback modal *before* navigating away. Storing
    // the destination in state lets the modal hand control back when the
    // user is done.
    setPendingNav('/progress');
    setFeedbackOpen(true);
  };

  const primary = trackedJoints[0];
  const primaryLive = primary ? liveRef.current[primary] : undefined;
  const angleDisplay = primaryLive?.angle ?? 0;
  const peakVelDisplay = primaryLive?.peakVel ?? 0;
  const repsTotal = Object.values(liveRef.current).reduce((s, l) => s + (l?.reps ?? 0), 0);
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toString().padStart(2, '0');
  const qColor = qualityScore >= 80 ? T.sage : qualityScore >= 60 ? T.amber : T.coral;
  const qLabel =
    classification === 'normal'
      ? 'Strong form — keep going'
      : classification === 'compensatory'
        ? 'Compensatory motion — adjust'
        : classification === 'guarded'
          ? 'Slow the return phase'
          : 'Abnormal — pause and reset';

  // Step 1: exercise selection screen. The patient must pick before any
  // tracking UI mounts. This keeps the camera idle until they're ready
  // and makes the doctor's prescriptions the first thing they see.
  if (!exerciseConfirmed) {
    return (
      <ChooseExerciseScreen
        patient={patient}
        exercises={exercises}
        prescriptions={prescriptions}
        selectedId={exerciseId}
        onPick={(ex) => {
          setUserPickedExercise(true);
          setExerciseId(ex.id);
          setTrackedJoints(ex.defaultJoints as JointKey[]);
          setExerciseConfirmed(true);
        }}
      />
    );
  }

  return (
    <div style={{ background: T.night, minHeight: '100vh', color: '#fff', paddingBottom: 100 }}>
      <div style={{ height: 54 }} />

      <div style={{ padding: '12px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={() => {
            if (armed) {
              if (!confirm('End this session and pick another exercise?')) return;
              void onEnd();
            }
            setExerciseConfirmed(false);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.55)',
            textDecoration: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="k-sans" style={{ fontSize: 13 }}>Change exercise</span>
        </button>
        <div style={{ textAlign: 'center' }}>
          <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>
            {armed ? 'RECORDING · LIVE' : 'READY'}
          </div>
          <div className="k-sans" style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>
            {exercise?.name ?? 'Custom'}
          </div>
        </div>
        <div className="k-mono k-tabnums" style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', minWidth: 48, textAlign: 'right' }}>
          {mins.toString().padStart(2, '0')}:{secs}
        </div>
      </div>

      <div style={{ padding: '0 20px 8px' }}>
        <div
          style={{
            position: 'relative',
            borderRadius: 18,
            overflow: 'hidden',
            background: '#000',
            // Only constrain to a 16:10 aspect ratio when the camera is
            // streaming. The off-state placeholder needs to size itself
            // to its content (icon + title + description + Enable button)
            // — on phone-width screens the fixed ratio would clip the
            // button below the fold and leave the user wondering where
            // it went.
            aspectRatio: cameraEnabled ? '16 / 10' : undefined,
            minHeight: cameraEnabled ? undefined : 360,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {cameraEnabled ? (
            <PoseTracker
              trackedJoints={trackedJoints}
              onFrame={onFrame}
              paused={paused}
              showAngleLabels
              model={modelVariant}
              onStatusChange={(s, info) => {
                setPoseStatus(s);
                setPoseErrorMsg(info?.errorMsg ?? '');
                if (info?.fps !== undefined) setPoseFps(info.fps);
              }}
              onLandmarks={(landmarks, tMs) => {
                meshRef.current?.pushFrame(landmarks, tMs);
              }}
            />
          ) : (
            <CameraOffPlaceholder
              permissionState={permissionState}
              onEnable={enableCamera}
              requesting={poseStatus === 'requesting-camera'}
              errorMsg={poseErrorMsg}
            />
          )}
          {/* Overlay UI — only when the camera is live. When the placeholder
              is showing, the camera tile is its own self-contained surface
              with its own title + CTA, and pills/buttons sitting on top
              just cover the headline. */}
          {cameraEnabled && (
            <>
              {imuState.bound && imuState.connected && (
                <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 6, alignItems: 'center', padding: '4px 9px', borderRadius: 999, background: 'rgba(91,214,160,0.18)', border: '1px solid rgba(91,214,160,0.45)', color: '#5BD6A0', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: '#5BD6A0', boxShadow: '0 0 6px #5BD6A0' }} />
                  IMU FUSED · {imuState.rateHz}HZ
                </div>
              )}
              <div style={{ position: 'absolute', top: 10, left: 10, right: 110, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {trackedJoints.map((k) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 9px',
                      borderRadius: 999,
                      background: 'rgba(0,0,0,0.5)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.12)',
                    }}
                  >
                    <span className="k-pulse" style={{ width: 6, height: 6, borderRadius: 3, background: T.amber, boxShadow: `0 0 8px ${T.amber}` }} />
                    <span className="k-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.05em' }}>
                      {JOINTS[k].label.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowPicker(true)}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  border: '1px solid rgba(255,255,255,0.18)',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                Change limbs
              </button>
            </>
          )}
        </div>
      </div>

      {/* 3D mirror — live avatar driven by MediaPipe + motion capture recorder. */}
      <div style={{ padding: '0 20px 12px' }}>
        <div style={{ background: T.nightCard, borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showMesh ? 10 : 0 }}>
            <div>
              <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>3D mirror</div>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
                Live avatar
                {mocapActive && (
                  <span style={{ marginLeft: 10, fontSize: 11, color: T.coral, fontWeight: 700 }}>
                    ● REC · {mocapFrameCount} frames
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowMesh((v) => !v)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                background: showMesh ? 'rgba(91,214,160,0.18)' : 'transparent',
                color: showMesh ? '#5BD6A0' : 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showMesh ? 'Hide' : 'Show'}
            </button>
          </div>

          {showMesh && (
            <>
              <SkeletonMesh
                onReady={(h) => { meshRef.current = h; }}
                height={300}
                background={T.night}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {!mocapActive ? (
                  <button
                    type="button"
                    disabled={!cameraEnabled || poseStatus !== 'running' || mocapBusy}
                    onClick={() => {
                      meshRef.current?.startRecording();
                      setMocapActive(true);
                      setMocapFrameCount(0);
                    }}
                    style={recordBtnStyle(cameraEnabled && poseStatus === 'running')}
                  >
                    ● Record motion
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={mocapBusy}
                      onClick={async () => {
                        const buf = meshRef.current?.stopRecording();
                        setMocapActive(false);
                        if (!buf || buf.frames.length === 0) {
                          toast.error('No motion captured.');
                          return;
                        }
                        setMocapBusy(true);
                        try {
                          const name = `${exercise?.name ?? 'Custom'} · ${new Date().toLocaleString()}`;
                          await saveMotionCapture({
                            patientId: patient.id,
                            clinicId: patient.clinicId,
                            sessionId,
                            exerciseId,
                            name,
                            rigUrl: '/models/xy-bot.glb',
                            durationMs: buf.durationMs,
                            sampleRateHz: buf.frames.length > 0 && buf.durationMs > 0
                              ? Math.round((buf.frames.length / buf.durationMs) * 1000)
                              : 0,
                            frames: buf.frames,
                          });
                          toast.success(`Saved ${buf.frames.length} frames (${Math.round(buf.durationMs / 100) / 10}s).`);
                        } catch (e: unknown) {
                          const msg = e instanceof Error ? e.message : 'Could not save motion capture.';
                          toast.error(msg);
                        } finally {
                          setMocapBusy(false);
                        }
                      }}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 999,
                        background: T.coral,
                        color: '#fff',
                        border: 'none',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {mocapBusy ? 'Saving…' : '■ Stop & save'}
                    </button>
                    <button
                      type="button"
                      disabled={mocapBusy}
                      onClick={() => {
                        meshRef.current?.stopRecording();
                        setMocapActive(false);
                        setMocapFrameCount(0);
                      }}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 999,
                        background: 'transparent',
                        color: 'rgba(255,255,255,0.7)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Discard
                    </button>
                  </>
                )}
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', alignSelf: 'center' }}>
                  Camera frames drive the rig in real time. Recordings save to your clinician as motion-capture clips.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 20px 16px', display: 'flex', justifyContent: 'center' }}>
        <ROMGauge
          current={angleDisplay}
          targetMin={primary ? JOINTS[primary].target.max * 0.7 : 80}
          targetMax={primary ? JOINTS[primary].target.max : 110}
          max={180}
          size={300}
          dark
          label={primary ? JOINTS[primary].label.toUpperCase() : 'ANGLE'}
        />
      </div>

      <div style={{ padding: '0 20px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Readout label="REPS" value={repsTotal} />
        <Readout label="VELOCITY" value={Math.round(peakVelDisplay)} unit="°/s" />
        <Readout label="QUALITY" value={qualityScore} color={qColor} sub={classification.toUpperCase()} />
      </div>

      <div style={{ padding: '0 20px 16px' }}>
        <div style={{ background: T.nightCard, borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.35)' }}>AI · MOTION CLASS</div>
            <div className="k-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>MediaPipe · 30 fps</div>
          </div>
          <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${qualityScore}%`,
                background: `linear-gradient(90deg, ${T.coral} 0%, ${T.amber} 50%, ${T.sage} 100%)`,
                backgroundSize: `${10000 / Math.max(1, qualityScore)}% 100%`,
                borderRadius: 4,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: qColor }} />
            <div className="k-sans" style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{qLabel}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 16px' }}>
        <ImuPanel
          jointKey={primary ?? 'right_knee'}
          onAngle={(deg) => {
            imuAngleRef.current = deg;
          }}
          onStateChange={(s) => {
            setImuState(s);
            imuBoundJointRef.current = s.bound ? primary ?? null : null;
            if (!s.bound) imuAngleRef.current = null;
          }}
        />
      </div>

      {!armed && (
        <div style={{ padding: '0 20px 16px' }}>
          <InstructionsCard
            exerciseName={exercise?.name ?? 'Custom exercise'}
            exerciseId={exerciseId}
            primary={primary ?? null}
          />
          <SetupCard
            cameraEnabled={cameraEnabled}
            poseStatus={poseStatus}
            poseErrorMsg={poseErrorMsg}
            poseFps={poseFps}
            permissionState={permissionState}
            imuConnected={imuState.connected}
            imuBound={imuState.bound}
            imuRateHz={imuState.rateHz}
            counting={counting}
            modelVariant={modelVariant}
            onModelVariantChange={setModelVariant}
            cameraAlreadyOn={cameraEnabled}
            onEnableCamera={enableCamera}
            onRetryCamera={retryCamera}
            onStartRecording={startRecording}
          />
        </div>
      )}
      {counting && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,17,24,0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 70,
          }}
        >
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <div className="k-eyebrow" style={{ color: '#7AB89A', marginBottom: 8 }}>GET READY</div>
            <div className="k-serif" style={{ fontSize: 48, letterSpacing: '-0.02em' }}>3 · 2 · 1</div>
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ padding: '0 20px 32px', display: 'flex', gap: 10 }}>
        <button
          onClick={() => setPaused((p) => !p)}
          style={{
            flex: 1,
            height: 56,
            borderRadius: 16,
            background: 'transparent',
            border: '1.5px solid rgba(255,255,255,0.18)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={onEnd}
          style={{
            flex: 1,
            height: 56,
            borderRadius: 16,
            background: T.coral,
            border: 'none',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {armed ? 'End session' : 'Cancel'}
        </button>
      </div>

      {feedbackOpen && patient && (
        <PostSessionFeedback
          patientId={patient.id}
          exerciseId={exerciseId}
          sessionId={sessionId}
          reps={Object.values(liveRef.current).reduce((s, l) => s + (l?.reps ?? 0), 0)}
          quality={qualityScore}
          onSubmitted={() => {
            setFeedbackOpen(false);
            const target = pendingNav ?? '/progress';
            setPendingNav(null);
            router.push(target);
          }}
          onSkip={() => {
            setFeedbackOpen(false);
            const target = pendingNav ?? '/progress';
            setPendingNav(null);
            router.push(target);
          }}
        />
      )}
      {showPicker && (
        <div
          onClick={() => setShowPicker(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              color: '#0E1822',
              width: '100%',
              maxWidth: 440,
              margin: '0 auto',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: '18px 18px 28px',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ width: 38, height: 4, borderRadius: 2, background: '#E5E1D8', margin: '0 auto 14px' }} />
            <ExercisePicker
              exercises={exercises}
              prescriptions={prescriptions}
              selectedId={exerciseId}
              onSelect={(ex) => {
                setUserPickedExercise(true);
                setExerciseId(ex.id);
                setTrackedJoints(ex.defaultJoints as JointKey[]);
              }}
            />
            <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 6 }}>TRACKED JOINTS</div>
            <LimbSelector selected={trackedJoints} onChange={setTrackedJoints} multi />
            <button
              onClick={() => setShowPicker(false)}
              style={{
                marginTop: 14,
                width: '100%',
                background: '#1A6B5A',
                color: '#fff',
                borderRadius: 999,
                padding: '12px 14px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Readout({ label, value, unit, sub, color = '#fff' }: { label: string; value: number | string; unit?: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: T.nightCard, borderRadius: 14, padding: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{label}</div>
      <div className="k-serif" style={{ fontSize: 28, color, lineHeight: 1, letterSpacing: '-0.02em' }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{unit}</span>}
      </div>
      {sub && (
        <div className="k-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function fresh(): LivePerJoint {
  return {
    angle: 0,
    min: Infinity,
    max: -Infinity,
    reps: 0,
    cadenceMs: 0,
    prevAngle: NaN,
    prevT: 0,
    prevVel: 0,
    jerkAcc: 0,
    jerkN: 0,
    peakVel: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
//  Setup card + camera placeholder
//
//  Two distinct UIs share this file:
//    • CameraOffPlaceholder fills the video tile while no stream is open —
//      a friendly explanation + Enable button.
//    • SetupCard is the bottom card that walks the user through the
//      camera + IMU + start-recording flow. It also gates Start Recording
//      until the PoseTracker has reached the `running` status.

function CameraOffPlaceholder({
  permissionState,
  onEnable,
  requesting,
  errorMsg,
}: {
  permissionState: 'unknown' | 'prompt' | 'granted' | 'denied';
  onEnable: () => void;
  requesting: boolean;
  errorMsg: string;
}) {
  const denied = permissionState === 'denied';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #162230 0%, #0A1118 70%)',
        color: '#fff',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ width: 56, height: 56, borderRadius: 28, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" />
        </svg>
      </div>
      <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Camera</div>
      <div className="k-serif" style={{ fontSize: 22, lineHeight: 1.25, marginBottom: 6, maxWidth: 280 }}>
        {denied ? 'Camera access was blocked' : 'Enable your camera to track motion'}
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4, maxWidth: 320, marginBottom: 16 }}>
        {denied
          ? 'Open your browser site settings, allow camera access, then reload this page.'
          : 'KINESIS uses your camera to detect limb position and measure joint angles. Video stays on this device — only joint angles are uploaded.'}
      </div>
      {errorMsg && !denied && (
        <div style={{ fontSize: 12, color: '#F2B5B5', marginBottom: 14, maxWidth: 320, lineHeight: 1.4 }}>{errorMsg}</div>
      )}
      <button
        type="button"
        onClick={onEnable}
        disabled={requesting || denied}
        style={{
          padding: '11px 20px',
          borderRadius: 999,
          border: 'none',
          background: denied ? 'rgba(255,255,255,0.08)' : '#1A6B5A',
          color: denied ? 'rgba(255,255,255,0.55)' : '#fff',
          fontSize: 13,
          fontWeight: 700,
          cursor: requesting || denied ? 'not-allowed' : 'pointer',
          opacity: requesting ? 0.7 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {requesting ? 'Requesting…' : denied ? 'Blocked — see browser settings' : 'Enable camera'}
      </button>
    </div>
  );
}

function SetupCard({
  cameraEnabled,
  poseStatus,
  poseErrorMsg,
  poseFps,
  permissionState,
  imuConnected,
  imuBound,
  imuRateHz,
  counting,
  modelVariant,
  onModelVariantChange,
  cameraAlreadyOn,
  onEnableCamera,
  onRetryCamera,
  onStartRecording,
}: {
  cameraEnabled: boolean;
  poseStatus: PoseTrackerStatus;
  poseErrorMsg: string;
  poseFps: number;
  permissionState: 'unknown' | 'prompt' | 'granted' | 'denied';
  imuConnected: boolean;
  imuBound: boolean;
  imuRateHz: number;
  counting: boolean;
  modelVariant: 'lite' | 'full' | 'heavy';
  onModelVariantChange: (m: 'lite' | 'full' | 'heavy') => void;
  cameraAlreadyOn: boolean;
  onEnableCamera: () => void;
  onRetryCamera: () => void;
  onStartRecording: () => void;
}) {
  const cameraLive = cameraEnabled && poseStatus === 'running';
  const cameraError = poseStatus === 'error';

  const accuracyLabel: Record<'lite' | 'full' | 'heavy', string> = {
    lite:  'Fast · less accurate',
    full:  'Balanced · recommended',
    heavy: 'Best · needs a strong GPU',
  };

  return (
    <div style={{ background: T.nightCard, borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>Setup</div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 0 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 4,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>Tracking accuracy</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            {accuracyLabel[modelVariant]}
            {cameraAlreadyOn && ' · reloads model on change'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['lite', 'full', 'heavy'] as const).map((v) => {
            const active = modelVariant === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onModelVariantChange(v)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: active ? '1px solid rgba(91,214,160,0.55)' : '1px solid rgba(255,255,255,0.12)',
                  background: active ? 'rgba(91,214,160,0.18)' : 'transparent',
                  color: active ? '#5BD6A0' : 'rgba(255,255,255,0.7)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {v === 'lite' ? 'Fast' : v === 'full' ? 'Standard' : 'Best'}
              </button>
            );
          })}
        </div>
      </div>

      <SetupStep
        index={1}
        label="Enable camera"
        sub={
          cameraLive ? `Live · ${poseFps || 25} fps · tracking ${poseStatus}`
          : cameraError ? (poseErrorMsg || 'Camera failed to start.')
          : cameraEnabled ? (
              poseStatus === 'loading-model' ? 'Loading motion model…'
              : poseStatus === 'requesting-camera' ? 'Requesting camera access…'
              : 'Starting…'
            )
          : permissionState === 'denied' ? 'Camera permission was previously denied.'
          : 'Click to allow camera access — required for motion tracking.'
        }
        state={cameraLive ? 'done' : cameraError ? 'error' : cameraEnabled ? 'pending' : 'todo'}
        action={
          cameraLive ? null
          : cameraError ? <SetupBtn onClick={onRetryCamera}>Try again</SetupBtn>
          : !cameraEnabled ? <SetupBtn onClick={onEnableCamera}>Enable</SetupBtn>
          : null
        }
      />

      <SetupStep
        index={2}
        label="Pair IMU sensor (optional)"
        sub={
          imuBound && imuConnected ? `Connected · ${imuRateHz} Hz · fusing with vision`
          : imuConnected ? 'Connected — calibrate in the IMU panel above to start fusing.'
          : 'Optional. Plug in an Arduino IMU for higher-rate angle data.'
        }
        state={imuBound && imuConnected ? 'done' : imuConnected ? 'pending' : 'optional'}
      />

      <SetupStep
        index={3}
        label="Position the limb in frame"
        sub={
          cameraLive
            ? 'Stand so the tracked joints are fully visible. A 3-second countdown plays on Start.'
            : 'Available once the camera is live.'
        }
        state={cameraLive ? 'pending' : 'todo'}
      />

      <button
        type="button"
        onClick={onStartRecording}
        disabled={!cameraLive || counting}
        style={{
          marginTop: 14,
          width: '100%',
          background: cameraLive ? '#fff' : 'rgba(255,255,255,0.08)',
          color: cameraLive ? T.teal : 'rgba(255,255,255,0.45)',
          border: 'none',
          borderRadius: 12,
          padding: '13px 14px',
          fontSize: 14,
          fontWeight: 700,
          cursor: cameraLive && !counting ? 'pointer' : 'not-allowed',
          opacity: counting ? 0.6 : 1,
          letterSpacing: '-0.005em',
        }}
      >
        {counting ? 'Get ready…' : cameraLive ? 'Start recording' : 'Enable camera first'}
      </button>
    </div>
  );
}

function SetupStep({
  index,
  label,
  sub,
  state,
  action,
}: {
  index: number;
  label: string;
  sub: string;
  state: 'todo' | 'pending' | 'done' | 'error' | 'optional';
  action?: React.ReactNode;
}) {
  const dotBg =
    state === 'done'  ? T.sage
    : state === 'error' ? T.coral
    : state === 'pending' ? T.amber
    : state === 'optional' ? 'rgba(255,255,255,0.12)'
    : 'rgba(255,255,255,0.08)';
  const dotColor =
    state === 'done' ? '#fff'
    : state === 'error' ? '#fff'
    : state === 'pending' ? '#fff'
    : 'rgba(255,255,255,0.45)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '8px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          background: dotBg,
          color: dotColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {state === 'done' ? '✓' : state === 'error' ? '!' : index}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
      </div>
      {action}
    </div>
  );
}

function recordBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '10px 16px',
    borderRadius: 999,
    background: enabled ? T.coral : 'rgba(255,255,255,0.08)',
    color: enabled ? '#fff' : 'rgba(255,255,255,0.4)',
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'not-allowed',
    letterSpacing: '0.02em',
  };
}

function SetupBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        border: 'none',
        background: T.teal,
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        marginTop: 2,
      }}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  ChooseExerciseScreen — the first screen of /session.
//
//  Lands the patient on a calm, dark, full-page picker. Prescribed
//  exercises from their clinician are front and centre. The library
//  appears below as smaller pills so they can experiment outside their
//  plan. Selecting an exercise transitions the page into the recording
//  flow.
// ────────────────────────────────────────────────────────────────────────

function ChooseExerciseScreen({
  patient,
  exercises,
  prescriptions,
  selectedId,
  onPick,
}: {
  patient: Patient;
  exercises: Exercise[];
  prescriptions: Prescription[];
  selectedId: string;
  onPick: (ex: Exercise) => void;
}) {
  const prescribedIds = new Set(prescriptions.map((p) => p.exerciseId));
  const prescribed = exercises.filter((e) => prescribedIds.has(e.id));
  const library = exercises.filter((e) => !prescribedIds.has(e.id));
  const prescriptionFor = (id: string) => prescriptions.find((p) => p.exerciseId === id);
  const firstName = patient.fullName.split(/\s+/)[0] ?? 'there';

  return (
    <div style={{ background: T.night, minHeight: '100vh', color: '#fff', paddingBottom: 80 }}>
      <div style={{ height: 54 }} />
      <div style={{ padding: '12px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="k-sans" style={{ fontSize: 13 }}>Home</span>
        </Link>
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.4)' }}>Step 1 · choose</div>
        <div style={{ width: 48 }} />
      </div>

      <div style={{ padding: '8px 24px 4px' }}>
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>Today's session</div>
        <h1 className="k-serif" style={{ fontSize: 28, lineHeight: 1.15, color: '#fff', letterSpacing: '-0.02em', marginBottom: 6 }}>
          What would you like to work on, <em style={{ color: '#5BD6A0', fontStyle: 'italic' }}>{firstName}</em>?
        </h1>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 18 }}>
          Pick an exercise to see how to do it and start tracking.
        </div>
      </div>

      {prescribed.length > 0 ? (
        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 8px 8px' }}>
            <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Prescribed by your clinician
            </div>
            <span className="k-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>{prescribed.length} active</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
            {prescribed.map((e) => {
              const rx = prescriptionFor(e.id);
              const isCurrent = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPick(e)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '16px 18px',
                    borderRadius: 16,
                    border: isCurrent ? '1.5px solid rgba(91,214,160,0.65)' : '1px solid rgba(255,255,255,0.08)',
                    background: isCurrent ? 'rgba(91,214,160,0.10)' : T.nightCard,
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <span style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: T.amber,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    flexShrink: 0,
                  }}>RX</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="k-serif" style={{ fontSize: 17, color: '#fff', lineHeight: 1.2 }}>
                      {e.name}
                    </div>
                    <div className="k-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4, letterSpacing: '0.04em' }}>
                      {rx ? `${rx.sets}×${rx.reps} · ${rx.frequencyPerWeek}×/wk` : 'Prescribed'}
                    </div>
                    {rx?.notes && (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 6, lineHeight: 1.45 }}>
                        {rx.notes}
                      </div>
                    )}
                  </div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ padding: '0 24px 22px' }}>
          <div style={{
            padding: '14px 16px',
            borderRadius: 14,
            background: 'rgba(212, 130, 74, 0.10)',
            border: '1px solid rgba(212, 130, 74, 0.30)',
            color: '#F5C09E',
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            Your clinician hasn't prescribed exercises yet. You can start with one from the library below — your clinician will see what you tried and prescribe a plan.
          </div>
        </div>
      )}

      <div style={{ padding: '0 24px' }}>
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
          Library · {library.length} more
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {library.map((e) => {
            const isCurrent = e.id === selectedId;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 999,
                  border: isCurrent ? '1px solid rgba(91,214,160,0.6)' : '1px solid rgba(255,255,255,0.12)',
                  background: isCurrent ? 'rgba(91,214,160,0.14)' : 'transparent',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {e.name}
              </button>
            );
          })}
          {library.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No more exercises in the library.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Exercise picker — split into Prescribed (top, from the doctor) and
//  Library (bottom, the full catalog). Patients can pick either, but the
//  prescribed list is what their clinician laid out for them.
// ────────────────────────────────────────────────────────────────────────

function ExercisePicker({
  exercises,
  prescriptions,
  selectedId,
  onSelect,
}: {
  exercises: Exercise[];
  prescriptions: Prescription[];
  selectedId: string;
  onSelect: (ex: Exercise) => void;
}) {
  const prescribedIds = new Set(prescriptions.map((p) => p.exerciseId));
  const prescribed = exercises.filter((e) => prescribedIds.has(e.id));
  const library = exercises.filter((e) => !prescribedIds.has(e.id));
  const prescriptionFor = (id: string) => prescriptions.find((p) => p.exerciseId === id);

  return (
    <>
      {prescribed.length > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="k-eyebrow" style={{ color: '#6B7785' }}>Prescribed by your clinician · {prescribed.length}</div>
            <div className="k-mono" style={{ fontSize: 9, color: '#9AA3AC', letterSpacing: '0.06em' }}>RX</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {prescribed.map((e) => {
              const rx = prescriptionFor(e.id);
              const selected = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: selected ? '1.5px solid #1A6B5A' : '1px solid #E5E1D8',
                    background: selected ? '#E6F0EC' : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#D4824A',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    flexShrink: 0,
                  }}>RX</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#0E1822', fontWeight: 600 }}>{e.name}</div>
                    <div className="k-mono" style={{ fontSize: 10, color: '#6B7785', marginTop: 2 }}>
                      {rx ? `${rx.sets}×${rx.reps} · ${rx.frequencyPerWeek}×/wk` : ''}{rx?.notes ? ` · ${rx.notes}` : ''}
                    </div>
                  </div>
                  {selected && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A6B5A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-11" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: '10px 12px', marginBottom: 16, borderRadius: 10, background: '#F5E8DC', border: '1px solid #E5E1D8', color: '#7A4A1F', fontSize: 12 }}>
          No exercises prescribed yet. Pick from the library below, or ask your clinician to send a prescription.
        </div>
      )}

      <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 8 }}>
        Library · {library.length} more
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {library.map((e) => {
          const selected = e.id === selectedId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e)}
              style={{
                padding: '7px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: selected ? '1px solid #1A6B5A' : '1px solid #E5E1D8',
                background: selected ? '#1A6B5A' : '#fff',
                color: selected ? '#fff' : '#0E1822',
                cursor: 'pointer',
              }}
            >
              {e.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Exercise instructions card — what the user should do
// ────────────────────────────────────────────────────────────────────────

function InstructionsCard({
  exerciseName,
  exerciseId,
  primary,
}: {
  exerciseName: string;
  exerciseId: string;
  primary: JointKey | null;
}) {
  const [tab, setTab] = useState<'setup' | 'cues' | 'safety'>('setup');
  const instr = getExerciseInstructions(exerciseId, primary ?? undefined);

  return (
    <div
      style={{
        background: T.nightCard,
        borderRadius: 14,
        padding: 16,
        border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
        <div>
          <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>How to do it</div>
          <div className="k-serif" style={{ fontSize: 18, color: '#fff', lineHeight: 1.2 }}>
            {exerciseName}
          </div>
          <div style={{ fontSize: 12, color: T.amber, marginTop: 4, fontStyle: 'italic' }}>
            {instr.oneLiner}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <ExerciseAnimation spec={instr.animation} height={180} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['setup', 'cues', 'safety'] as const).map((id) => {
          const active = tab === id;
          const label = id === 'setup' ? 'Set up' : id === 'cues' ? 'Form cues' : 'Safety';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: active ? '1px solid rgba(91,214,160,0.4)' : '1px solid rgba(255,255,255,0.1)',
                background: active ? 'rgba(91,214,160,0.14)' : 'transparent',
                color: active ? '#5BD6A0' : 'rgba(255,255,255,0.65)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <ol style={{ paddingLeft: 18, margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.55 }}>
        {(tab === 'setup' ? instr.setup : tab === 'cues' ? instr.cues : instr.safety).map((s, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{s}</li>
        ))}
      </ol>

      {tab === 'cues' && instr.avoid && instr.avoid.length > 0 && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(196, 69, 69, 0.10)', border: '1px solid rgba(196, 69, 69, 0.25)' }}>
          <div className="k-eyebrow" style={{ color: '#F2B5B5', marginBottom: 4 }}>Avoid</div>
          <ul style={{ paddingLeft: 16, margin: 0, color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.5 }}>
            {instr.avoid.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Post-session feedback modal — pain + feeling
// ────────────────────────────────────────────────────────────────────────

type Feeling = 'worse' | 'same' | 'better' | 'great';

function PostSessionFeedback({
  patientId,
  exerciseId,
  sessionId,
  reps,
  quality,
  onSubmitted,
  onSkip,
}: {
  patientId: string;
  exerciseId: string;
  sessionId: string | null;
  reps: number;
  quality: number;
  onSubmitted: () => void;
  onSkip: () => void;
}) {
  const [score, setScore] = useState<number>(2);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const colorForScore = (n: number) =>
    n <= 2 ? T.sage : n <= 5 ? T.amber : T.coral;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await logPainCheckin(patientId, score, {
        note: note.trim() || null,
        sessionId: sessionId ?? null,
        exerciseId,
        feeling,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pain-checkin]', e);
    } finally {
      setSubmitting(false);
      onSubmitted();
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,17,24,0.8)',
        backdropFilter: 'blur(8px)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: T.nightCard,
          color: '#fff',
          width: '100%',
          maxWidth: 480,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          padding: '18px 20px 28px',
          border: '1px solid rgba(255,255,255,0.06)',
          borderBottom: 'none',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '0 auto 14px' }} />
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>How did that feel?</div>
        <div className="k-serif" style={{ fontSize: 22, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.2, marginBottom: 4 }}>
          {reps} reps, quality {quality}/100
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 18 }}>
          A 30-second check-in helps your clinician adjust the plan.
        </div>

        {/* Pain score */}
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
          Pain right now · {score}/10
        </div>
        <input
          type="range"
          min={0}
          max={10}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          style={{ width: '100%', accentColor: colorForScore(score) }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 18 }}>
          <span>No pain</span>
          <span>Moderate</span>
          <span>Worst possible</span>
        </div>

        {/* Feeling chips */}
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
          How are you feeling compared to last session?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 18 }}>
          {(['worse', 'same', 'better', 'great'] as Feeling[]).map((f) => {
            const active = feeling === f;
            const bg =
              active
                ? f === 'worse' ? T.coral
                  : f === 'same' ? 'rgba(255,255,255,0.18)'
                  : f === 'better' ? T.amber
                  : T.sage
                : 'transparent';
            const fg =
              active && f !== 'same' ? '#fff' : active ? '#fff' : 'rgba(255,255,255,0.75)';
            const labelText =
              f === 'worse' ? '😣 Worse'
              : f === 'same' ? '😐 Same'
              : f === 'better' ? '🙂 Better'
              : '💪 Great';
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFeeling(f)}
                style={{
                  padding: '10px 6px',
                  borderRadius: 12,
                  border: active ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.12)',
                  background: bg,
                  color: fg,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {labelText}
              </button>
            );
          })}
        </div>

        {/* Note */}
        <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
          Anything to add? (optional)
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. slight stiffness at the top, no sharp pain"
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            color: '#fff',
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            resize: 'vertical',
            marginBottom: 18,
          }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            style={{
              flex: 1,
              padding: '13px 14px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.75)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            style={{
              flex: 2,
              padding: '13px 14px',
              borderRadius: 12,
              border: 'none',
              background: '#fff',
              color: T.teal,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
