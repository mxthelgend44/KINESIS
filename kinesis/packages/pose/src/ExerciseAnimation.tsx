'use client';

import { useEffect, useRef, useState } from 'react';
import type { JointKey } from './exercises';
import type { AnimationSpec } from './instructions';

const PALETTE = {
  bgFrom: '#0A1118',
  bgTo: '#162230',
  bodyFill: '#C9D4E0',
  bodyStroke: 'rgba(255, 255, 255, 0.08)',
  bodyMute: 'rgba(201, 212, 224, 0.28)',
  bodyMuteFill: 'rgba(201, 212, 224, 0.32)',
  joint: '#1A6B5A',
  jointActive: '#D4824A',
  jointActiveDim: 'rgba(212, 130, 74, 0.25)',
  arc: 'rgba(212, 130, 74, 0.55)',
  arcRange: 'rgba(212, 130, 74, 0.12)',
  ground: 'rgba(255, 255, 255, 0.10)',
} as const;

type Props = {
  spec: AnimationSpec;
  /** Approximate height of the viewer in px. */
  height?: number;
  /** Pause the animation. */
  paused?: boolean;
};

/**
 * Looping demo of a prescribed exercise.
 *
 * Render strategy (chosen by spec):
 *   • Lottie URL set → render dotLottie web component (loops & autoplays)
 *   • Video URL set  → render an autoplay/loop/muted <video>
 *   • Otherwise      → fall back to the in-house SVG figure
 *
 * Lottie / video URLs are loaded from a public CDN. If they fail, we
 * fall back to the SVG so the page never shows a broken animation.
 */
export function ExerciseAnimation({ spec, height = 240, paused = false }: Props) {
  const [t, setT] = useState(0);
  const [lottieReady, setLottieReady] = useState(false);
  const [lottieFailed, setLottieFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const lottieRef = useRef<HTMLElement | null>(null);

  // Drive the SVG figure on requestAnimationFrame. Even when a Lottie or
  // video is in front of it, this also powers the small "Right Knee · 87°"
  // readout below the viewer.
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) % spec.durationMs;
      const phase = elapsed / spec.durationMs;
      const smooth = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
      setT(smooth);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec.durationMs, paused]);

  // Load the dotLottie web component script once. It registers
  // <dotlottie-player>; we use it as a normal element below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!spec.lottieUrl) return;
    if (lottieReady) return;
    const ID = 'dotlottie-player-script';
    if (document.getElementById(ID)) {
      setLottieReady(true);
      return;
    }
    const s = document.createElement('script');
    s.id = ID;
    s.type = 'module';
    s.src = 'https://unpkg.com/@dotlottie/player-component@2.7.12/dist/dotlottie-player.mjs';
    s.onload = () => setLottieReady(true);
    s.onerror = () => setLottieFailed(true);
    document.head.appendChild(s);
  }, [spec.lottieUrl, lottieReady]);

  const currentDeg = spec.range[0] + (spec.range[1] - spec.range[0]) * t;

  const useLottie = !!spec.lottieUrl && lottieReady && !lottieFailed;
  const useVideo = !useLottie && !!spec.videoUrl && !videoFailed;

  return (
    <div
      style={{
        position: 'relative',
        background: `linear-gradient(180deg, ${PALETTE.bgFrom} 0%, ${PALETTE.bgTo} 100%)`,
        borderRadius: 14,
        padding: 12,
        border: '1px solid rgba(255, 255, 255, 0.06)',
        overflow: 'hidden',
      }}
    >
      {useLottie ? (
        <LottieMount
          ref={lottieRef}
          src={spec.lottieUrl!}
          height={height}
          onError={() => setLottieFailed(true)}
        />
      ) : useVideo ? (
        <video
          src={spec.videoUrl}
          poster={spec.videoPoster}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          style={{
            display: 'block',
            width: '100%',
            height,
            objectFit: 'contain',
            borderRadius: 10,
            background: '#000',
          }}
        />
      ) : (
        <SvgFigure spec={spec} t={t} height={height} />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          color: 'rgba(255,255,255,0.55)',
        }}
      >
        <span>{labelFor(spec.joint)} · {Math.round(currentDeg)}°</span>
        <span>
          {useLottie ? 'Lottie' : useVideo ? 'Video' : 'SVG'} · ~{Math.round(spec.durationMs / 1000)}s / rep
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Lottie mount (web component)
// ─────────────────────────────────────────────────────────────────────────

import { forwardRef } from 'react';

const LottieMount = forwardRef<
  HTMLElement,
  { src: string; height: number; onError: () => void }
>(function LottieMount({ src, height, onError }, _ref) {
  // The dotLottie web component is a custom HTML element. React doesn't
  // know its prop names so we use dangerouslySetInnerHTML to render it.
  // (Alternatively `React.createElement('dotlottie-player', ...)` works
  // once the script has loaded — we use that pattern here.)
  const Tag = 'dotlottie-player' as unknown as keyof JSX.IntrinsicElements;
  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Tag
        {...({
          src,
          autoplay: true,
          loop: true,
          background: 'transparent',
          speed: '1',
          style: { width: '100%', height: `${height}px` },
          onError: onError,
        } as any)}
      />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────
//  Polished SVG fallback — better than thin stick figure
// ─────────────────────────────────────────────────────────────────────────

function SvgFigure({ spec, t, height }: { spec: AnimationSpec; t: number; height: number }) {
  const sweepDeg = mapToSegmentRotation(spec.joint, spec.range[0] + (spec.range[1] - spec.range[0]) * t);
  const sweepDegMin = mapToSegmentRotation(spec.joint, spec.range[0]);
  const sweepDegMax = mapToSegmentRotation(spec.joint, spec.range[1]);
  return (
    <svg viewBox="0 0 260 320" width="100%" height={height} style={{ display: 'block' }}>
      {/* Ground line */}
      <line x1="20" y1="298" x2="240" y2="298" stroke={PALETTE.ground} strokeWidth="1" strokeDasharray="2 5" />

      <Figure animatedJoint={spec.joint} sweepDeg={sweepDeg} sweepRange={[sweepDegMin, sweepDegMax]} />
    </svg>
  );
}

function mapToSegmentRotation(joint: JointKey, angleDeg: number): number {
  switch (joint) {
    case 'right_knee':  return -(170 - angleDeg);
    case 'left_knee':   return  (170 - angleDeg);
    case 'right_hip':   return  (165 - angleDeg);
    case 'left_hip':    return -(165 - angleDeg);
    case 'right_shoulder': return  (angleDeg - 10);
    case 'left_shoulder':  return -(angleDeg - 10);
    case 'right_elbow': return -(160 - angleDeg);
    case 'left_elbow':  return  (160 - angleDeg);
    case 'right_ankle': return -(angleDeg - 80);
    case 'left_ankle':  return  (angleDeg - 80);
    default: return 0;
  }
}

function Figure({
  animatedJoint,
  sweepDeg,
  sweepRange,
}: {
  animatedJoint: JointKey;
  sweepDeg: number;
  sweepRange: [number, number];
}) {
  // Anchors in viewBox space (260×320).
  const head      = { x: 130, y: 56 };
  const neck      = { x: 130, y: 92 };
  const shoulderL = { x: 100, y: 100 };
  const shoulderR = { x: 160, y: 100 };
  const hipL      = { x: 113, y: 180 };
  const hipR      = { x: 147, y: 180 };
  const hipC      = { x: 130, y: 180 };

  const upperArmLen = 54;
  const forearmLen  = 48;
  const upperLegLen = 60;
  const lowerLegLen = 54;
  const footLen     = 22;
  const limbThick   = 14; // shows as a rounded "limb" rather than a stick
  const limbThickActive = 16;

  const isAnimated = (joint: JointKey) => animatedJoint === joint;
  const animSide = animatedJoint.startsWith('right_') ? 'right' : 'left';
  const sweepIf = (joint: JointKey) => (animatedJoint === joint ? sweepDeg : 0);

  // A limb segment is drawn as a rounded "capsule" — two endpoints joined
  // by a stroked thick line with rounded caps. The active limb is amber;
  // the mirror side is dimmer so attention lands on the working side.
  const limbColor = (proximal: JointKey, distal: JointKey, side: 'left' | 'right'): { stroke: string; thick: number } => {
    const active = animatedJoint === proximal || animatedJoint === distal;
    if (active) return { stroke: PALETTE.jointActive, thick: limbThickActive };
    return {
      stroke: side === animSide ? PALETTE.bodyFill : PALETTE.bodyMuteFill,
      thick: limbThick,
    };
  };

  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* Torso silhouette */}
      <path
        d={`M ${shoulderL.x - 4} ${shoulderL.y - 4}
            L ${shoulderR.x + 4} ${shoulderR.y - 4}
            L ${hipR.x + 4} ${hipR.y + 4}
            L ${hipL.x - 4} ${hipL.y + 4}
            Z`}
        fill={PALETTE.bodyFill}
        opacity="0.95"
        stroke={PALETTE.bodyStroke}
        strokeWidth="1"
      />

      {/* Head */}
      <circle cx={head.x} cy={head.y} r="20" fill={PALETTE.bodyFill} stroke={PALETTE.bodyStroke} strokeWidth="1" />
      {/* Neck */}
      <line x1={head.x} y1={head.y + 18} x2={neck.x} y2={neck.y} stroke={PALETTE.bodyFill} strokeWidth="10" />

      {/* Left arm — capsule per segment */}
      <g transform={`rotate(${sweepIf('left_shoulder')} ${shoulderL.x} ${shoulderL.y})`}>
        {(() => {
          const c = limbColor('left_shoulder', 'left_shoulder', 'left');
          return (
            <line
              x1={shoulderL.x}
              y1={shoulderL.y}
              x2={shoulderL.x}
              y2={shoulderL.y + upperArmLen}
              stroke={c.stroke}
              strokeWidth={c.thick}
            />
          );
        })()}
        <g transform={`rotate(${sweepIf('left_elbow')} ${shoulderL.x} ${shoulderL.y + upperArmLen})`}>
          {(() => {
            const c = limbColor('left_elbow', 'left_shoulder', 'left');
            return (
              <line
                x1={shoulderL.x}
                y1={shoulderL.y + upperArmLen}
                x2={shoulderL.x}
                y2={shoulderL.y + upperArmLen + forearmLen}
                stroke={c.stroke}
                strokeWidth={c.thick - 1}
              />
            );
          })()}
          <Joint cx={shoulderL.x} cy={shoulderL.y + upperArmLen} active={isAnimated('left_elbow')} />
        </g>
        <Joint cx={shoulderL.x} cy={shoulderL.y} active={isAnimated('left_shoulder')} />
      </g>

      {/* Right arm */}
      <g transform={`rotate(${sweepIf('right_shoulder')} ${shoulderR.x} ${shoulderR.y})`}>
        {(() => {
          const c = limbColor('right_shoulder', 'right_shoulder', 'right');
          return (
            <line
              x1={shoulderR.x}
              y1={shoulderR.y}
              x2={shoulderR.x}
              y2={shoulderR.y + upperArmLen}
              stroke={c.stroke}
              strokeWidth={c.thick}
            />
          );
        })()}
        <g transform={`rotate(${sweepIf('right_elbow')} ${shoulderR.x} ${shoulderR.y + upperArmLen})`}>
          {(() => {
            const c = limbColor('right_elbow', 'right_shoulder', 'right');
            return (
              <line
                x1={shoulderR.x}
                y1={shoulderR.y + upperArmLen}
                x2={shoulderR.x}
                y2={shoulderR.y + upperArmLen + forearmLen}
                stroke={c.stroke}
                strokeWidth={c.thick - 1}
              />
            );
          })()}
          <Joint cx={shoulderR.x} cy={shoulderR.y + upperArmLen} active={isAnimated('right_elbow')} />
        </g>
        <Joint cx={shoulderR.x} cy={shoulderR.y} active={isAnimated('right_shoulder')} />
      </g>

      {/* Left leg */}
      <g transform={`rotate(${sweepIf('left_hip')} ${hipL.x} ${hipL.y})`}>
        {(() => {
          const c = limbColor('left_hip', 'left_hip', 'left');
          return (
            <line
              x1={hipL.x}
              y1={hipL.y}
              x2={hipL.x}
              y2={hipL.y + upperLegLen}
              stroke={c.stroke}
              strokeWidth={c.thick + 2}
            />
          );
        })()}
        <g transform={`rotate(${sweepIf('left_knee')} ${hipL.x} ${hipL.y + upperLegLen})`}>
          {(() => {
            const c = limbColor('left_knee', 'left_hip', 'left');
            return (
              <line
                x1={hipL.x}
                y1={hipL.y + upperLegLen}
                x2={hipL.x}
                y2={hipL.y + upperLegLen + lowerLegLen}
                stroke={c.stroke}
                strokeWidth={c.thick + 1}
              />
            );
          })()}
          <g transform={`rotate(${sweepIf('left_ankle')} ${hipL.x} ${hipL.y + upperLegLen + lowerLegLen})`}>
            <line
              x1={hipL.x}
              y1={hipL.y + upperLegLen + lowerLegLen}
              x2={hipL.x - footLen}
              y2={hipL.y + upperLegLen + lowerLegLen + 2}
              stroke={isAnimated('left_ankle') ? PALETTE.jointActive : PALETTE.bodyMuteFill}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <Joint cx={hipL.x} cy={hipL.y + upperLegLen + lowerLegLen} active={isAnimated('left_ankle')} />
          </g>
          <Joint cx={hipL.x} cy={hipL.y + upperLegLen} active={isAnimated('left_knee')} />
        </g>
        <Joint cx={hipL.x} cy={hipL.y} active={isAnimated('left_hip')} />
      </g>

      {/* Right leg */}
      <g transform={`rotate(${sweepIf('right_hip')} ${hipR.x} ${hipR.y})`}>
        {(() => {
          const c = limbColor('right_hip', 'right_hip', 'right');
          return (
            <line
              x1={hipR.x}
              y1={hipR.y}
              x2={hipR.x}
              y2={hipR.y + upperLegLen}
              stroke={c.stroke}
              strokeWidth={c.thick + 2}
            />
          );
        })()}
        <g transform={`rotate(${sweepIf('right_knee')} ${hipR.x} ${hipR.y + upperLegLen})`}>
          {(() => {
            const c = limbColor('right_knee', 'right_hip', 'right');
            return (
              <line
                x1={hipR.x}
                y1={hipR.y + upperLegLen}
                x2={hipR.x}
                y2={hipR.y + upperLegLen + lowerLegLen}
                stroke={c.stroke}
                strokeWidth={c.thick + 1}
              />
            );
          })()}
          <g transform={`rotate(${sweepIf('right_ankle')} ${hipR.x} ${hipR.y + upperLegLen + lowerLegLen})`}>
            <line
              x1={hipR.x}
              y1={hipR.y + upperLegLen + lowerLegLen}
              x2={hipR.x + footLen}
              y2={hipR.y + upperLegLen + lowerLegLen + 2}
              stroke={isAnimated('right_ankle') ? PALETTE.jointActive : PALETTE.bodyMuteFill}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <Joint cx={hipR.x} cy={hipR.y + upperLegLen + lowerLegLen} active={isAnimated('right_ankle')} />
          </g>
          <Joint cx={hipR.x} cy={hipR.y + upperLegLen} active={isAnimated('right_knee')} />
        </g>
        <Joint cx={hipR.x} cy={hipR.y} active={isAnimated('right_hip')} />
      </g>

      {/* Range-of-motion arc + sweep handle for the active joint */}
      <ActiveJointArc joint={animatedJoint} sweepRange={sweepRange} currentSweep={sweepDeg} anchors={{ shoulderL, shoulderR, hipL, hipR, upperArmLen, upperLegLen, lowerLegLen, forearmLen }} />
    </g>
  );
}

function Joint({ cx, cy, active }: { cx: number; cy: number; active: boolean }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={active ? 7 : 5}
      fill={active ? PALETTE.jointActive : PALETTE.bodyFill}
      stroke={active ? '#fff' : 'rgba(0,0,0,0.18)'}
      strokeWidth={active ? 1.6 : 1}
    />
  );
}

function ActiveJointArc({
  joint,
  sweepRange,
  currentSweep,
  anchors,
}: {
  joint: JointKey;
  sweepRange: [number, number];
  currentSweep: number;
  anchors: {
    shoulderL: { x: number; y: number };
    shoulderR: { x: number; y: number };
    hipL: { x: number; y: number };
    hipR: { x: number; y: number };
    upperArmLen: number;
    upperLegLen: number;
    lowerLegLen: number;
    forearmLen: number;
  };
}) {
  const { shoulderL, shoulderR, hipL, hipR, upperArmLen, upperLegLen, lowerLegLen } = anchors;
  let p: { x: number; y: number } | null = null;
  let radius = 36;
  switch (joint) {
    case 'left_shoulder':  p = shoulderL; radius = 50; break;
    case 'right_shoulder': p = shoulderR; radius = 50; break;
    case 'left_elbow':     p = { x: shoulderL.x, y: shoulderL.y + upperArmLen }; radius = 44; break;
    case 'right_elbow':    p = { x: shoulderR.x, y: shoulderR.y + upperArmLen }; radius = 44; break;
    case 'left_hip':       p = hipL; radius = 56; break;
    case 'right_hip':      p = hipR; radius = 56; break;
    case 'left_knee':      p = { x: hipL.x, y: hipL.y + upperLegLen }; radius = 50; break;
    case 'right_knee':     p = { x: hipR.x, y: hipR.y + upperLegLen }; radius = 50; break;
    case 'left_ankle':     p = { x: hipL.x, y: hipL.y + upperLegLen + lowerLegLen }; radius = 28; break;
    case 'right_ankle':    p = { x: hipR.x, y: hipR.y + upperLegLen + lowerLegLen }; radius = 28; break;
  }
  if (!p) return null;
  // Arc from sweepRange[0] to sweepRange[1] centred on the joint pivot.
  // SVG arc draws clockwise; we render the range arc as a faint band and
  // a brighter sweep handle showing the *current* rotation.
  const a0 = (sweepRange[0] - 90) * Math.PI / 180;
  const a1 = (sweepRange[1] - 90) * Math.PI / 180;
  const ac = (currentSweep - 90) * Math.PI / 180;
  const x0 = p.x + radius * Math.cos(a0);
  const y0 = p.y + radius * Math.sin(a0);
  const x1 = p.x + radius * Math.cos(a1);
  const y1 = p.y + radius * Math.sin(a1);
  const xc = p.x + radius * Math.cos(ac);
  const yc = p.y + radius * Math.sin(ac);
  const largeArc = Math.abs(sweepRange[1] - sweepRange[0]) > 180 ? 1 : 0;
  const sweepDir = sweepRange[1] > sweepRange[0] ? 1 : 0;
  return (
    <>
      <path
        d={`M ${x0} ${y0} A ${radius} ${radius} 0 ${largeArc} ${sweepDir} ${x1} ${y1}`}
        fill="none"
        stroke={PALETTE.arcRange}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line x1={p.x} y1={p.y} x2={xc} y2={yc} stroke={PALETTE.arc} strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx={xc} cy={yc} r="4" fill={PALETTE.jointActive} stroke="#fff" strokeWidth="1.3" />
    </>
  );
}

function labelFor(j: JointKey): string {
  return j.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
