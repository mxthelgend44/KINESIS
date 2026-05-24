'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPoseLandmarker, type ModelVariant } from './pose';
import { LM } from './landmarks';
import { JOINTS, type JointKey } from './exercises';
import {
  angleAt,
  clampAngle,
  jointConfidence,
  LandmarkMedianFilter,
  OneEuro,
  type Pt3,
} from './angles';
import { MUSCLES, MuscleActivationTracker, computeJointAngles } from './anatomy';

export type LiveFrame = {
  tMs: number;
  angles: Partial<Record<JointKey, number>>;
  confidence: Partial<Record<JointKey, number>>;
};

export type PoseTrackerStatus =
  | 'idle'
  | 'loading-model'
  | 'requesting-camera'
  | 'running'
  | 'error';

type Props = {
  trackedJoints: JointKey[];
  onFrame?: (frame: LiveFrame) => void;
  paused?: boolean;
  showAngleLabels?: boolean;
  model?: ModelVariant;
  /** Notified whenever the tracker's internal status changes — so the parent
   *  can show its own UI ("Camera live, 25 fps") or gate the Start Recording
   *  button until the pipeline is actually streaming. */
  onStatusChange?: (status: PoseTrackerStatus, info?: { errorMsg?: string; fps?: number }) => void;
  /** Notified with the raw MediaPipe world landmarks for the most recent
   *  inferred frame. Used by the 3D mesh viewer to drive a rigged avatar
   *  in real time. Coordinates are MediaPipe-native (Y down). */
  onLandmarks?: (landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>, tMs: number) => void;
};

export function PoseTracker({
  trackedJoints,
  onFrame,
  paused = false,
  showAngleLabels = false,
  // Default 'lite' — it's ~6× faster than 'full' on integrated GPUs, the
  // 33-keypoint output schema is identical, and accuracy is plenty for
  // limb-angle ROM tracking. Callers can override to 'full' or 'heavy' for
  // clinic-grade recordings.
  model = 'lite',
  onStatusChange,
  onLandmarks,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);
  const lastInferenceMs = useRef<number>(0);
  const filtersRef = useRef<Partial<Record<JointKey, OneEuro>>>({});
  // Median filter per *landmark index* (33 total) on the worldLandmarks
  // stream. We use a small 3-frame window — long enough to reject the
  // occasional MediaPipe landmark flip but short enough not to lag real
  // motion. The cost is trivial (3 numbers / landmark / component).
  const lmFiltersRef = useRef<Map<number, LandmarkMedianFilter>>(new Map());
  const trackedSet = useRef<Set<JointKey>>(new Set(trackedJoints));
  // Muscle-activation tracker — converts joint-angle history into a
  // per-muscle "firing" strength used by the anatomical renderer.
  const muscleActRef = useRef<MuscleActivationTracker>(new MuscleActivationTracker());

  const [status, setStatus] = useState<PoseTrackerStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [fps, setFps] = useState(0);

  useEffect(() => {
    onStatusChange?.(status, { errorMsg, fps });
    // Intentionally narrow deps: callers usually don't memoise the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, errorMsg, fps]);

  useEffect(() => {
    trackedSet.current = new Set(trackedJoints);
    for (const k of trackedJoints) {
      if (!filtersRef.current[k]) filtersRef.current[k] = new OneEuro(1.2, 0.04, 1.0);
    }
  }, [trackedJoints]);

  // When the model variant changes, blow away the existing per-landmark
  // median filters (their window length is model-dependent) and the
  // per-joint One-Euro state. Otherwise the first frame after a switch
  // mixes filtered data from two models and lags the angle for ~1s.
  useEffect(() => {
    lmFiltersRef.current.clear();
    filtersRef.current = {};
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        setStatus('loading-model');
        const landmarker = await getPoseLandmarker(model);
        if (cancelled) return;

        setStatus('requesting-camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) return resolve();
          const onMeta = () => {
            video.removeEventListener('loadedmetadata', onMeta);
            resolve();
          };
          video.addEventListener('loadedmetadata', onMeta);
        });

        startMsRef.current = performance.now();
        setStatus('running');
        let frames = 0;
        let lastSec = performance.now();

        // Inference cadence is model-dependent. The lite model is fastest
        // and we cap it at ~25fps to avoid wasted work. The heavy model
        // can sustain ~30fps on most desktop GPUs and benefits from the
        // extra samples (more numerator for the angle median + One-Euro).
        // Joint-angle tracking is comfortable at 25fps either way.
        const INFERENCE_INTERVAL_MS =
          model === 'heavy' ? 33 : model === 'full' ? 36 : 40;

        const loop = () => {
          if (cancelled) return;
          const now = performance.now();
          if (!paused && video.readyState >= 2 && now - lastInferenceMs.current > INFERENCE_INTERVAL_MS) {
            lastInferenceMs.current = now;
            try {
              const result = landmarker.detectForVideo(video, now);
              drawAndEmit(result, video, now);
            } catch {
              // swallow occasional MediaPipe quirks
            }
            frames++;
            if (now - lastSec > 1000) {
              setFps(frames);
              frames = 0;
              lastSec = now;
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus('error');
        const msg = extractErrorMessage(err);
        const low = msg.toLowerCase();
        if (low.includes('permission') || low.includes('denied') || low.includes('notallowed')) {
          setErrorMsg('Camera permission denied. Enable camera access in your browser settings and reload.');
        } else if (low.includes('notfound') || low.includes('no camera')) {
          setErrorMsg('No camera found. Plug in a webcam or grant the right device.');
        } else if (low.includes('notreadable') || low.includes('in use')) {
          setErrorMsg('Camera is already in use by another app. Close it and try again.');
        } else if (low.includes('overconstrained')) {
          setErrorMsg('Camera does not support the requested resolution.');
        } else if (low.includes('secure') || low.includes('https')) {
          setErrorMsg('Camera requires a secure (HTTPS) connection.');
        } else {
          setErrorMsg(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const drawAndEmit = useCallback(
    (result: Awaited<ReturnType<Awaited<ReturnType<typeof getPoseLandmarker>>['detectForVideo']>>, video: HTMLVideoElement, now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (canvas.width !== vw) canvas.width = vw;
      if (canvas.height !== vh) canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, vw, vh);

      const landmarksList = result.landmarks?.[0];
      const worldList = result.worldLandmarks?.[0];
      if (!landmarksList || landmarksList.length < 33) return;

      const tracked = trackedSet.current;
      const trackedVertices = new Set<number>();
      for (const k of tracked) {
        const [a, b, c] = JOINTS[k].triplet;
        trackedVertices.add(a);
        trackedVertices.add(b);
        trackedVertices.add(c);
      }

      // ── Anatomical-volume rendering ─────────────────────────────────
      // Goal: a clinical, depth-aware overlay that reads like an
      // articulated mannequin, not a stick figure. We render in z-order
      // (farthest first) so closer limbs occlude further ones, and use
      // capsule strokes whose thickness matches the relevant body part.
      // The torso is a filled quadrilateral so the trunk has the
      // correct visual mass.

      const scale = Math.max(vw, vh) / 720; // 720p reference size

      // 1) Segmentation mask — paint the body silhouette as a soft
      //    teal wash under everything else. Comes from MediaPipe's
      //    optional `outputSegmentationMasks: true`.
      const mask = (result as { segmentationMasks?: Array<unknown> }).segmentationMasks?.[0];
      if (mask) {
        renderSegmentationSilhouette(ctx, mask, vw, vh);
      }

      // Anatomical bone thicknesses (capsule *radius*, scale-relative
      // px). These are intentionally thin — the muscle bundle layer
      // above provides the limb bulk; this layer renders the *bones*
      // running through them, like an anatomical diagram. Calibrated
      // against real anatomy: the femur is the thickest, ribs/clavicle
      // are thinner.
      const limbRadius: Record<string, number> = {
        clavicle:   3.5 * scale,
        torsoSide:  4.5 * scale,
        pelvis:     4.0 * scale,
        upperArm:   5.0 * scale, // humerus
        forearm:    4.0 * scale, // radius/ulna
        thigh:      6.5 * scale, // femur — thickest bone
        shin:       4.5 * scale, // tibia
        foot:       3.5 * scale,
        hand:       3.0 * scale,
      };
      type CapsuleSpec = { from: number; to: number; r: number; name: string };
      const CAPSULES: CapsuleSpec[] = [
        { from: LM.LEFT_SHOULDER,  to: LM.RIGHT_SHOULDER, r: limbRadius.clavicle!,  name: 'clavicle' },
        { from: LM.LEFT_HIP,       to: LM.RIGHT_HIP,      r: limbRadius.pelvis!,    name: 'pelvis' },
        { from: LM.LEFT_SHOULDER,  to: LM.LEFT_ELBOW,     r: limbRadius.upperArm!,  name: 'left_upper_arm' },
        { from: LM.LEFT_ELBOW,     to: LM.LEFT_WRIST,     r: limbRadius.forearm!,   name: 'left_forearm' },
        { from: LM.RIGHT_SHOULDER, to: LM.RIGHT_ELBOW,    r: limbRadius.upperArm!,  name: 'right_upper_arm' },
        { from: LM.RIGHT_ELBOW,    to: LM.RIGHT_WRIST,    r: limbRadius.forearm!,   name: 'right_forearm' },
        { from: LM.LEFT_HIP,       to: LM.LEFT_KNEE,      r: limbRadius.thigh!,     name: 'left_thigh' },
        { from: LM.LEFT_KNEE,      to: LM.LEFT_ANKLE,     r: limbRadius.shin!,      name: 'left_shin' },
        { from: LM.RIGHT_HIP,      to: LM.RIGHT_KNEE,     r: limbRadius.thigh!,     name: 'right_thigh' },
        { from: LM.RIGHT_KNEE,     to: LM.RIGHT_ANKLE,    r: limbRadius.shin!,      name: 'right_shin' },
        { from: LM.LEFT_ANKLE,     to: LM.LEFT_FOOT_INDEX, r: limbRadius.foot!,     name: 'left_foot' },
        { from: LM.RIGHT_ANKLE,    to: LM.RIGHT_FOOT_INDEX, r: limbRadius.foot!,    name: 'right_foot' },
        { from: LM.LEFT_WRIST,     to: LM.LEFT_INDEX,     r: limbRadius.hand!,      name: 'left_hand' },
        { from: LM.RIGHT_WRIST,    to: LM.RIGHT_INDEX,    r: limbRadius.hand!,      name: 'right_hand' },
      ];

      // Average z (depth) for a segment — used for back-to-front
      // ordering and brightness modulation. MediaPipe Z is negative
      // toward the camera.
      const segZ = (a: number, b: number) =>
        ((landmarksList[a]?.z ?? 0) + (landmarksList[b]?.z ?? 0)) / 2;

      // Tracked-joint membership for an entire capsule
      const isHot = (a: number, b: number) =>
        trackedVertices.has(a) && trackedVertices.has(b);

      // Sort capsules back-to-front so closer limbs paint last.
      const ordered = [...CAPSULES].sort((c1, c2) => segZ(c2.from, c2.to) - segZ(c1.from, c1.to));

      // 2) Torso polygon — filled quad between L/R shoulders and hips.
      //    Provides the body mass that line-based skeletons miss.
      const ls = landmarksList[LM.LEFT_SHOULDER];
      const rs = landmarksList[LM.RIGHT_SHOULDER];
      const lh = landmarksList[LM.LEFT_HIP];
      const rh = landmarksList[LM.RIGHT_HIP];
      if (ls && rs && lh && rh && Math.min(ls.visibility ?? 0, rs.visibility ?? 0, lh.visibility ?? 0, rh.visibility ?? 0) > 0.4) {
        const torsoZ = (ls.z + rs.z + lh.z + rh.z) / 4;
        const torsoTint = depthTint('#5BD6A0', torsoZ);
        ctx.save();
        ctx.fillStyle = torsoTint;
        ctx.globalAlpha = 0.32;
        ctx.beginPath();
        ctx.moveTo(ls.x * vw, ls.y * vh);
        ctx.lineTo(rs.x * vw, rs.y * vh);
        ctx.lineTo(rh.x * vw, rh.y * vh);
        ctx.lineTo(lh.x * vw, lh.y * vh);
        ctx.closePath();
        ctx.fill();
        // Subtle edge highlight
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = torsoTint;
        ctx.stroke();
        ctx.restore();
      }

      // 2b) Muscle bundles — drawn UNDER the bones so the limbs read
      //     anatomically (muscle sits around the bone, bone runs through
      //     it). Activation pumps the brightness + size of each bundle.
      //     We compute the activation from the joint-angle derivatives
      //     so muscles fire when the relevant motion is happening
      //     (biceps fire on elbow flexion, quads fire on knee extension,
      //     etc.).
      {
        const lmForAngles = landmarksList as ReadonlyArray<Pt3 & { visibility?: number }>;
        const jointAngles = computeJointAngles(lmForAngles);
        muscleActRef.current.update(jointAngles, now);

        for (const m of MUSCLES) {
          const pa = landmarksList[m.from];
          const pb = landmarksList[m.to];
          if (!pa || !pb) continue;
          if ((pa.visibility ?? 0) < 0.4 || (pb.visibility ?? 0) < 0.4) continue;

          const x1 = pa.x * vw, y1 = pa.y * vh;
          const x2 = pb.x * vw, y2 = pb.y * vh;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          if (len < 1) continue;
          // Unit vector along the bone, and the perpendicular.
          const ux = dx / len, uy = dy / len;
          const px = -uy, py = ux;

          // Bundle centre = point alongBone the bone, offset perpOffset
          // away from it.
          const cx = x1 + ux * (len * m.alongBone) + px * (len * m.perpOffset);
          const cy = y1 + uy * (len * m.alongBone) + py * (len * m.perpOffset);

          const activation = muscleActRef.current.get(m.id);
          const halfLen = len * m.lengthFraction * 0.5;
          // Width swells slightly when the muscle fires.
          const halfWid = len * m.widthFraction * 0.5 * (1 + activation * 0.18);

          // Colour: from rest (cool teal) to firing (vivid amber).
          const restR = 91,  restG = 214, restB = 160;
          const hotR  = 255, hotG  = 138, hotB  = 76;
          const a = activation;
          const r = Math.round(restR + (hotR - restR) * a);
          const g = Math.round(restG + (hotG - restG) * a);
          const b = Math.round(restB + (hotB - restB) * a);
          const fill = `rgba(${r}, ${g}, ${b}, ${0.55 + a * 0.35})`;
          const stroke = `rgba(${r}, ${g}, ${b}, ${0.85})`;

          // Draw the bundle as a rotated ellipse with a radial gradient
          // for volume. Striations (a couple of thin parallel lines
          // along the bone direction) sell the "muscle fibres" look.
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.atan2(uy, ux));

          // Outer glow when firing
          if (a > 0.05) {
            ctx.shadowBlur = 14 * scale * a;
            ctx.shadowColor = `rgba(${hotR}, ${hotG}, ${hotB}, ${0.55 * a})`;
          }
          // Bundle body
          ctx.beginPath();
          ctx.ellipse(0, 0, halfLen, halfWid, 0, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Outline
          ctx.lineWidth = 1.2 * scale;
          ctx.strokeStyle = stroke;
          ctx.stroke();

          // Striations — three thin dark lines parallel to the muscle
          // axis suggest fascicles. Subtle so they don't dominate.
          ctx.strokeStyle = `rgba(${Math.round(r * 0.55)}, ${Math.round(g * 0.55)}, ${Math.round(b * 0.55)}, 0.45)`;
          ctx.lineWidth = 0.6 * scale;
          for (const f of [-0.5, 0, 0.5]) {
            const yOff = halfWid * f * 0.7;
            ctx.beginPath();
            ctx.moveTo(-halfLen * 0.85, yOff);
            ctx.lineTo(halfLen * 0.85, yOff);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 3) Bones — z-sorted, ivory-coloured, thin and bright. They
      //    visibly run through the muscle bundles like a real skeleton.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const c of ordered) {
        const pa = landmarksList[c.from];
        const pb = landmarksList[c.to];
        if (!pa || !pb) continue;
        const va = pa.visibility ?? 0;
        const vb = pb.visibility ?? 0;
        if (va < 0.4 || vb < 0.4) continue;
        const z = segZ(c.from, c.to);
        const x1 = pa.x * vw, y1 = pa.y * vh;
        const x2 = pb.x * vw, y2 = pb.y * vh;

        // Dark drop-shadow under the bone so it reads against the
        // muscle bundle and the underlying video.
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = c.r * 2 + 2.5 * scale;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Bone body — ivory with slight depth tint. Real bone is pale
        // off-white; we tint slightly so closer bones stand out.
        const bone = depthTint('#F5EFE2', z);
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, bone);
        grad.addColorStop(0.5, lighten(bone, 0.06));
        grad.addColorStop(1, bone);
        ctx.strokeStyle = grad;
        ctx.lineWidth = c.r * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Specular highlight stripe along one edge — gives the bone a
        // rounded, 3-D feel.
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const nx = -dy / len, ny = dx / len;
          const off = c.r * 0.4;
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = c.r * 0.55;
          ctx.beginPath();
          ctx.moveTo(x1 + nx * off, y1 + ny * off);
          ctx.lineTo(x2 + nx * off, y2 + ny * off);
          ctx.stroke();
        }
      }

      // 4) Head — circle anchored at the nose, sized by ear-to-ear
      //    distance for proper anatomical scale.
      const nose = landmarksList[LM.NOSE];
      const lEar = landmarksList[LM.LEFT_EAR];
      const rEar = landmarksList[LM.RIGHT_EAR];
      if (nose && lEar && rEar && (nose.visibility ?? 0) > 0.4) {
        const earDist = Math.hypot((lEar.x - rEar.x) * vw, (lEar.y - rEar.y) * vh);
        const r = Math.max(28 * scale, earDist * 0.95);
        const cx = ((lEar.x + rEar.x) / 2) * vw;
        const cy = ((lEar.y + rEar.y) / 2) * vh;
        const headZ = (lEar.z + rEar.z) / 2;
        // Soft halo
        ctx.save();
        ctx.shadowBlur = 14 * scale;
        ctx.shadowColor = 'rgba(91,214,160,0.6)';
        ctx.fillStyle = depthTint('#5BD6A0', headZ);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Outline
        ctx.lineWidth = 3 * scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.stroke();
      }

      // 5) Joint balls — depth-shaded spheres that sit on top of the
      //    capsules. Tracked joints get a larger marker + ring.
      const drawBall = (i: number) => {
        const p = landmarksList[i];
        if (!p || (p.visibility ?? 0) < 0.4) return;
        const tk = trackedVertices.has(i);
        const z = p.z ?? 0;
        const baseR = (tk ? 11 : 6) * scale;
        const x = p.x * vw;
        const y = p.y * vh;
        const colour = tk ? '#FF8A4C' : '#5BD6A0';
        // Outer halo
        ctx.fillStyle = depthTint(colour, z);
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(x, y, baseR, 0, Math.PI * 2);
        ctx.fill();
        // Outline
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        // White inner core
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, baseR * 0.45, 0, Math.PI * 2);
        ctx.fill();
      };
      // Major joints only — fingers and face landmarks are noise here.
      for (const i of [
        LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
        LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
        LM.LEFT_WRIST, LM.RIGHT_WRIST,
        LM.LEFT_HIP, LM.RIGHT_HIP,
        LM.LEFT_KNEE, LM.RIGHT_KNEE,
        LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      ]) {
        drawBall(i);
      }

      const tMs = now - startMsRef.current;
      const angles: Partial<Record<JointKey, number>> = {};
      const conf: Partial<Record<JointKey, number>> = {};
      // Cache median-filtered landmarks by index so multiple joints sharing
      // a vertex (e.g. left_elbow and left_shoulder share LEFT_SHOULDER)
      // only filter once per frame.
      const filteredSrcCache = new Map<number, Pt3>();
      const src = worldList ?? landmarksList;
      const getFiltered = (i: number): Pt3 => {
        const cached = filteredSrcCache.get(i);
        if (cached) return cached;
        let f = lmFiltersRef.current.get(i);
        if (!f) {
          // Bigger median window on the heavier/more-accurate models —
          // they produce smoother input so a 5-frame median doesn't lag
          // perceptibly while reducing the residual jitter further.
          const window = model === 'heavy' ? 5 : model === 'full' ? 4 : 3;
          f = new LandmarkMedianFilter(window);
          lmFiltersRef.current.set(i, f);
        }
        // We still carry the 2D visibility from `landmarks` — worldLandmarks
        // doesn't include a visibility field on every MediaPipe build.
        const fp = f.filter({
          x: src[i].x,
          y: src[i].y,
          z: src[i].z,
          visibility: landmarksList[i]?.visibility ?? src[i].visibility ?? 1,
        });
        filteredSrcCache.set(i, fp);
        return fp;
      };

      for (const k of tracked) {
        const [ai, bi, ci] = JOINTS[k].triplet;
        const pa = getFiltered(ai);
        const pb = getFiltered(bi);
        const pc = getFiltered(ci);
        const c = jointConfidence(landmarksList[ai], landmarksList[bi], landmarksList[ci]);
        let raw = angleAt(pa, pb, pc);
        // Clamp to anatomical bounds (no negative angles, no >180°).
        raw = clampAngle(raw, 0, 180);
        const filter = filtersRef.current[k] ?? new OneEuro(1.2, 0.04, 1.0);
        filtersRef.current[k] = filter;
        raw = filter.filter(raw, tMs, c);
        angles[k] = raw;
        conf[k] = c;

        if (showAngleLabels) {
          const b2d = landmarksList[bi];
          const x = b2d.x * vw + 12;
          const y = b2d.y * vh - 12;
          ctx.fillStyle = 'rgba(14, 24, 34, 0.78)';
          const text = `${Math.round(raw)}°`;
          ctx.font = '600 18px "Plus Jakarta Sans", system-ui, sans-serif';
          const w = ctx.measureText(text).width + 14;
          roundRect(ctx, x, y - 18, w, 26, 10);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(text, x + 7, y + 1);
        }
      }

      onFrame?.({ tMs, angles, confidence: conf });
      // Emit raw world landmarks for the 3D mesh viewer. We prefer
      // worldLandmarks (real-world metres, gravity-aligned) when the
      // model provides them — they translate cleanly to skeletal
      // retargeting — and fall back to the 2D image-space landmarks
      // otherwise.
      if (onLandmarks) {
        const src = worldList ?? landmarksList;
        // Carry through the 2D landmark visibilities — worldLandmarks
        // don't always include one — so the retargeter can gate by it.
        const withVis = src.map((p, i) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: landmarksList[i]?.visibility ?? (p as { visibility?: number }).visibility ?? 1,
        }));
        onLandmarks(withVis, tMs);
      }
    },
    [onFrame, onLandmarks, showAngleLabels],
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0A1118', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          transform: 'scaleX(-1)',
          pointerEvents: 'none',
        }}
      />
      {status !== 'running' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10,17,24,0.9)',
            color: '#fff',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: 320 }}>
            {status === 'loading-model' && (
              <>
                <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>LOADING</div>
                <div className="k-serif" style={{ fontSize: 22, marginBottom: 6 }}>Preparing motion model…</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                  First load downloads ~6 MB. Cached after.
                </div>
              </>
            )}
            {status === 'requesting-camera' && (
              <>
                <div className="k-eyebrow" style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>CAMERA</div>
                <div className="k-serif" style={{ fontSize: 22 }}>Allow camera access to continue.</div>
              </>
            )}
            {status === 'error' && (
              <>
                <div className="k-eyebrow" style={{ color: '#C44545', marginBottom: 8 }}>ERROR</div>
                <div className="k-serif" style={{ fontSize: 22, marginBottom: 6 }}>Can't start session</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{errorMsg}</div>
              </>
            )}
            {status === 'idle' && <div className="k-serif" style={{ fontSize: 22 }}>Starting…</div>}
          </div>
        </div>
      )}
      {status === 'running' && (
        <div
          className="k-mono"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.5)',
            color: '#fff',
            fontSize: 10,
            backdropFilter: 'blur(8px)',
          }}
        >
          {fps} fps
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ── Render helpers ────────────────────────────────────────────────────

/**
 * Modulate a base hex colour by a MediaPipe Z depth. Z is negative
 * toward the camera; closer surfaces should look brighter. Clamps to
 * a sensible range so we don't end up with black or white limbs.
 */
function depthTint(hex: string, z: number): string {
  // z ≈ -1 (very close) → +0.20 lightness
  // z ≈ +1 (very far)   → -0.15 lightness
  const k = Math.max(-1, Math.min(1, z));
  const delta = -k * 0.175;
  return adjustLightness(hex, delta);
}

function lighten(hex: string, amount: number): string {
  return adjustLightness(hex, amount);
}

function adjustLightness(hex: string, delta: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const adj = (n: number) => Math.round(Math.max(0, Math.min(255, n + delta * 255)));
  const rh = adj(r).toString(16).padStart(2, '0');
  const gh = adj(g).toString(16).padStart(2, '0');
  const bh = adj(b).toString(16).padStart(2, '0');
  return `#${rh}${gh}${bh}`;
}

// One offscreen canvas re-used across frames for the segmentation
// composite. Saves an allocation per frame on the render hot path.
let _maskScratch: HTMLCanvasElement | null = null;
function getMaskScratch(width: number, height: number): HTMLCanvasElement {
  if (!_maskScratch) {
    _maskScratch = document.createElement('canvas');
  }
  if (_maskScratch.width !== width || _maskScratch.height !== height) {
    _maskScratch.width = width;
    _maskScratch.height = height;
  }
  return _maskScratch;
}

/**
 * Paint MediaPipe's per-pixel foreground mask as a soft teal silhouette
 * behind the skeleton. The mask is a Uint8 grayscale image where
 * non-zero pixels are foreground.
 *
 * MediaPipe's MPMask object exposes the underlying data through a few
 * different shapes depending on SDK version — we try each.
 */
function renderSegmentationSilhouette(
  ctx: CanvasRenderingContext2D,
  rawMask: unknown,
  vw: number,
  vh: number,
): void {
  const mask = rawMask as {
    width?: number;
    height?: number;
    getAsUint8Array?: () => Uint8Array;
    getAsFloat32Array?: () => Float32Array;
  };
  const mw = mask.width ?? 0;
  const mh = mask.height ?? 0;
  if (mw <= 0 || mh <= 0) return;

  let data: Uint8Array | Float32Array | null = null;
  try {
    data = mask.getAsUint8Array?.() ?? mask.getAsFloat32Array?.() ?? null;
  } catch {
    return;
  }
  if (!data) return;

  // Build an ImageData with teal pixels where the mask is foreground.
  const scratch = getMaskScratch(mw, mh);
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  const img = sctx.createImageData(mw, mh);
  const px = img.data;
  // Teal #5BD6A0 = 91, 214, 160
  const isFloat = data instanceof Float32Array;
  for (let i = 0; i < mw * mh; i++) {
    const v = isFloat ? (data[i] as number) : (data[i] as number) / 255;
    const alpha = Math.min(1, Math.max(0, v));
    if (alpha < 0.15) continue;
    const o = i * 4;
    px[o] = 91;
    px[o + 1] = 214;
    px[o + 2] = 160;
    px[o + 3] = Math.round(alpha * 95); // soft wash, never fully opaque
  }
  sctx.putImageData(img, 0, 0);

  // Draw the silhouette stretched to the video canvas.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratch, 0, 0, vw, vh);
  ctx.restore();
}

// MediaPipe and getUserMedia can reject with DOMException, Event, MediaError, or
// a plain Error. The naive String(err) for an Event yields "[object Event]"
// which is useless to the user.
function extractErrorMessage(e: unknown): string {
  if (e == null) return 'Unknown error — please reload and try again.';
  if (e instanceof Error) return e.message || e.name || 'Unknown error.';
  if (typeof e === 'string') return e;
  // DOMException has a name (e.g. "NotAllowedError") and a message.
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return e.message || e.name;
  }
  // MediaStream / media element errors fire as Events on the element.
  if (typeof Event !== 'undefined' && e instanceof Event) {
    const target = (e as Event & { target?: { error?: { message?: string; code?: number } } }).target;
    const mediaErr = target?.error;
    if (mediaErr?.message) return mediaErr.message;
    if (mediaErr?.code) return `Camera error (code ${mediaErr.code})`;
    return e.type ? `Camera ${e.type} error` : 'Camera failed to start.';
  }
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message;
    if (typeof obj.name === 'string' && obj.name.length > 0) return obj.name;
  }
  return 'Could not start the camera or pose model.';
}
