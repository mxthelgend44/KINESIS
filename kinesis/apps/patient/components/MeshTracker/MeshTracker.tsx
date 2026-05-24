'use client';

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { PoseRetargeter, type Landmark } from './retarget';

/**
 * 3D avatar view that mirrors the user's pose in real time and exposes
 * an imperative API for the parent to push landmark frames in.
 *
 * Design notes:
 *   • react-three-fiber drives the WebGL render loop. We mount the
 *     character via `useGLTF` and bind a `PoseRetargeter` to it once
 *     the skeleton is available.
 *   • Landmarks flow in via the imperative `pushFrame()` ref so we
 *     don't re-render React on every pose frame — applying landmarks
 *     mutates `bone.quaternion` directly which Three.js picks up on
 *     the next draw.
 *   • The recorder is also imperative: `startRecording()` /
 *     `stopRecording()` push every applied frame into a buffer the
 *     parent can pull out and persist.
 */

export type MeshTrackerHandle = {
  /** Feed a fresh pose-landmark frame. Mutates the avatar bones in place. */
  pushFrame: (landmarks: Landmark[], tMs: number) => void;
  /** Begin recording. Existing buffer is reset. */
  startRecording: () => void;
  /** Stop recording. Returns the captured frames (one per pushFrame call between start/stop). */
  stopRecording: () => MotionCaptureBuffer;
  /** Currently recording? */
  isRecording: () => boolean;
  /** Frames captured so far this session. */
  frameCount: () => number;
};

export type MotionCaptureBuffer = {
  /** Wall-clock ms of the first frame. */
  startMs: number;
  /** Duration in ms (last frame's tMs minus the first frame's tMs). */
  durationMs: number;
  /** Per-frame bone rotations (quaternions [x, y, z, w]). */
  frames: Array<{
    tMs: number;
    bones: Record<string, [number, number, number, number]>;
  }>;
};

type Props = {
  /** Path to the .glb relative to /public — defaults to the bundled bot. */
  modelUrl?: string;
  /** Height in px (the Canvas fills the container's width). */
  height?: number;
  /** Background colour for the canvas. */
  background?: string;
  /** Disable orbit controls. */
  lockCamera?: boolean;
  /** Idle pose vs live pose. */
  paused?: boolean;
};

/** Visible diagnostic state — surfaced in an overlay on the canvas so
 *  we can see what's happening without scrolling through console. */
type DiagState = {
  bones: string[];
  skinnedMeshCount: number;
  resolvedHips: string | null;
  resolvedDrives: Record<string, string | null>;
  frameCount: number;
  lastRotSnapshot: string;
  ySign: number | null;
  selfTestBone: string | null;
};

const DEFAULT_MODEL_URL = '/models/xy-bot.glb';

export const MeshTracker = forwardRef<MeshTrackerHandle, Props>(function MeshTracker(
  { modelUrl = DEFAULT_MODEL_URL, height = 360, background = '#0E1822', lockCamera = false, paused = false },
  ref,
) {
  const retargeterRef = useRef<PoseRetargeter | null>(null);
  const recordingRef = useRef<boolean>(false);
  const bufferRef = useRef<MotionCaptureBuffer | null>(null);
  // Frame-count debug — logs once a second how many landmark frames
  // the retargeter has processed. If this stays at 0 after enabling
  // the camera, the wiring from PoseTracker → MeshTracker is broken.
  const frameCountRef = useRef(0);
  const lastReportRef = useRef(0);
  const lastFrameMsRef = useRef(0);
  // Visible diagnostics — populated by the Avatar component, displayed
  // in an HTML overlay outside the Canvas. Lets us see the rig
  // resolution + per-frame state without console output (which has
  // proven unreliable due to React Dev call-stack noise).
  const [diag, setDiag] = useState<DiagState>({
    bones: [],
    skinnedMeshCount: 0,
    resolvedHips: null,
    resolvedDrives: {},
    frameCount: 0,
    lastRotSnapshot: '(none)',
    ySign: null,
    selfTestBone: null,
  });

  useImperativeHandle(
    ref,
    () => ({
      pushFrame(landmarks, tMs) {
        if (paused) return;
        // Mark "we got a frame" before the early-return so the self-test
        // yields control even if the retargeter hasn't bound yet — the
        // user can tell the wiring is alive vs the bind being slow.
        lastFrameMsRef.current = performance.now();
        const rt = retargeterRef.current;
        if (!rt) {
          // Loud debug — if this happens many times the bind step is
          // slow / failing.
          if (frameCountRef.current === 0) {
            // eslint-disable-next-line no-console
            console.warn('[MeshTracker] pushFrame called but retargeter is null — bind hasn\'t run yet.');
          }
          return;
        }
        rt.apply(landmarks, tMs);
        frameCountRef.current++;
        // Periodic heartbeat — proves pushFrame is firing and the
        // retargeter is consuming landmarks. If you don't see this in
        // the console after enabling the camera, the wiring from
        // PoseTracker.onLandmarks is broken.
        if (tMs - lastReportRef.current > 2000) {
          lastReportRef.current = tMs;
          // eslint-disable-next-line no-console
          console.debug(
            '[MeshTracker] frames=' + frameCountRef.current,
            'lm0=', landmarks[0],
            'rots=', rt.debugRotations(),
          );
        }
        if (recordingRef.current) {
          const buf = bufferRef.current;
          if (buf) {
            buf.frames.push({ tMs, bones: rt.snapshot() });
            buf.durationMs = Math.max(buf.durationMs, tMs - buf.startMs);
          }
        }
      },
      startRecording() {
        recordingRef.current = true;
        bufferRef.current = { startMs: Date.now(), durationMs: 0, frames: [] };
      },
      stopRecording() {
        recordingRef.current = false;
        const buf = bufferRef.current ?? { startMs: Date.now(), durationMs: 0, frames: [] };
        bufferRef.current = null;
        return buf;
      },
      isRecording() {
        return recordingRef.current;
      },
      frameCount() {
        return bufferRef.current?.frames.length ?? 0;
      },
    }),
    [paused],
  );

  const [showDiag, setShowDiag] = useState(true);
  const [forceTest, setForceTest] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      // Tighter framing — closer + slightly lower FOV makes small
      // motions readable on the small panel. Looking at the avatar's
      // mid-torso rather than its feet.
      camera={{ position: [0, 0.9, 2.4], fov: 35 }}
      style={{ height, background, borderRadius: 14, display: 'block' }}
    >
      {/* Three-point lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[2.5, 4, 3]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {/* Rim light from behind for silhouette definition */}
      <directionalLight position={[-2, 2, -3]} intensity={0.6} color="#5BD6A0" />
      {/* Fill light from below */}
      <directionalLight position={[0, -1, 2]} intensity={0.25} color="#FFC97D" />
      <Avatar
        modelUrl={modelUrl}
        retargeterRef={retargeterRef}
        lastFrameMsRef={lastFrameMsRef}
        setDiag={setDiag}
        forceTest={forceTest}
      />
      <ContactShadows position={[0, -1, 0]} opacity={0.45} scale={6} blur={2.2} far={2} />
      {!lockCamera && (
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={1.5}
          maxDistance={5}
          target={[0, 0.6, 0]}
          maxPolarAngle={Math.PI * 0.65}
          minPolarAngle={Math.PI * 0.2}
        />
      )}
    </Canvas>

    {/* Diagnostic overlay — surfaces what bones the rig has, what we
        resolved them to, and the live frame counter. Lets us debug
        without scrolling through console output. */}
    {showDiag && (
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          maxHeight: height - 16,
          overflowY: 'auto',
          padding: '8px 10px',
          background: 'rgba(10, 17, 24, 0.85)',
          color: '#C3D0DE',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          lineHeight: 1.45,
          borderRadius: 8,
          border: '1px solid rgba(91,214,160,0.30)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <strong style={{ color: '#5BD6A0', fontSize: 10 }}>RIG DIAGNOSTIC</strong>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => {
                const text = diag.bones.join('\n');
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(text);
                }
                // eslint-disable-next-line no-console
                console.log('[MeshTracker] bone list:\n' + text);
              }}
              style={{
                background: 'rgba(91,214,160,0.2)',
                color: '#5BD6A0',
                border: 'none',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                cursor: 'pointer',
              }}
              title="Copy all bone names to clipboard (also logged to console)."
            >
              COPY BONES
            </button>
            <button
              type="button"
              onClick={() => setForceTest((v) => !v)}
              style={{
                background: forceTest ? '#D4824A' : 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                cursor: 'pointer',
              }}
              title="Force-rotate every bone — if you see the figure crinkle, the rig is wired."
            >
              {forceTest ? 'STOP TEST' : 'FORCE TEST'}
            </button>
            <button
              type="button"
              onClick={() => setShowDiag(false)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div>bones: <span style={{ color: '#fff' }}>{diag.bones.length}</span></div>
        <div>skinned meshes: <span style={{ color: diag.skinnedMeshCount > 0 ? '#7AB89A' : '#FF7B7B' }}>{diag.skinnedMeshCount}</span></div>
        <div>hips resolved: <span style={{ color: diag.resolvedHips ? '#7AB89A' : '#FF7B7B' }}>{diag.resolvedHips ?? 'NOT FOUND'}</span></div>
        <div>self-test bone: <span style={{ color: diag.selfTestBone ? '#7AB89A' : '#FF7B7B' }}>{diag.selfTestBone ?? 'NOT FOUND'}</span></div>
        <div>Y sign: <span style={{ color: '#fff' }}>{diag.ySign === null ? '(unlocked)' : diag.ySign === 1 ? 'flip' : 'no-flip'}</span></div>
        <div>frame count: <span style={{ color: diag.frameCount > 0 ? '#7AB89A' : '#FFC97D' }}>{diag.frameCount}</span></div>
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: '#FFC97D' }}>drives resolution</summary>
          <div style={{ marginTop: 4 }}>
            {Object.entries(diag.resolvedDrives).map(([k, v]) => (
              <div key={k}>
                {k}: <span style={{ color: v ? '#7AB89A' : '#FF7B7B' }}>{v ?? 'NULL'}</span>
              </div>
            ))}
          </div>
        </details>
        <details>
          <summary style={{ cursor: 'pointer', color: '#FFC97D' }}>all bones ({diag.bones.length})</summary>
          <div style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto', fontSize: 8 }}>
            {diag.bones.map((b) => <div key={b}>{b}</div>)}
          </div>
        </details>
      </div>
    )}
    {!showDiag && (
      <button
        type="button"
        onClick={() => setShowDiag(true)}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          background: 'rgba(10, 17, 24, 0.85)',
          color: '#5BD6A0',
          border: '1px solid rgba(91,214,160,0.30)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 9,
          cursor: 'pointer',
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        DIAG
      </button>
    )}
    </div>
  );
});

function Avatar({
  modelUrl,
  retargeterRef,
  lastFrameMsRef,
  setDiag,
  forceTest,
}: {
  modelUrl: string;
  retargeterRef: React.MutableRefObject<PoseRetargeter | null>;
  lastFrameMsRef: React.MutableRefObject<number>;
  setDiag: React.Dispatch<React.SetStateAction<DiagState>>;
  forceTest: boolean;
}) {
  const { scene } = useGLTF(modelUrl) as unknown as { scene: THREE.Group };
  const sceneRef = useRef<THREE.Group | null>(null);
  const skinnedMeshesRef = useRef<THREE.SkinnedMesh[]>([]);
  const { camera, scene: rootScene } = useThree();

  // Force-update every SkinnedMesh's skeleton each render frame. This
  // is normally automatic, but a few GLBs come with `matrixAutoUpdate`
  // turned off on the armature, in which case bone rotations apply
  // (visible via SkeletonHelper) but the mesh stays in T-pose because
  // the GPU's bone-matrix uniforms never refresh.
  //
  // We *also* drive a self-test: when the retargeter isn't bound yet
  // (so no MediaPipe motion is feeding in), we rotate the LeftArm bone
  // on a sine wave so the user can visually confirm the rig + skinning
  // path actually responds to bone rotations. If they see the arm move
  // here but NOT when the camera is on, the issue is upstream of the
  // rig (landmarks, bone matching, math). If they don't see it move
  // either, the rig itself isn't wired through to the mesh.
  const selfTestRef = useRef<{ bone: THREE.Bone | null; logged: boolean }>({ bone: null, logged: false });
  const lastDiagPushRef = useRef(0);
  useFrame(() => {
    // Re-skin every SkinnedMesh in the avatar.
    for (const m of skinnedMeshesRef.current) {
      m.skeleton.update();
    }

    // ── FORCE TEST: when the diagnostic panel's FORCE TEST button is
    //    on, override every visible bone with a sine-wave rotation. If
    //    the figure visibly contorts, the rig + skinning are wired
    //    correctly and the issue is purely in the retargeter wiring.
    if (forceTest && sceneRef.current) {
      const t = performance.now() / 600;
      let i = 0;
      sceneRef.current.traverse((o) => {
        const b = o as THREE.Bone;
        if (!b.isBone) return;
        // Different phase / axis per bone so the figure obviously
        // jitters when the test is on.
        i++;
        const phase = i * 0.3;
        b.rotation.x = Math.sin(t + phase) * 0.25;
        b.rotation.z = Math.cos(t + phase) * 0.25;
      });
      // Push diagnostic frame counter too.
      if (performance.now() - lastDiagPushRef.current > 300) {
        lastDiagPushRef.current = performance.now();
        setDiag((d) => ({ ...d, frameCount: d.frameCount + 1 }));
      }
      return;
    }

    // Self-test arm wave: runs whenever we haven't received a real
    // landmark frame in the last 500ms. This is the "are you alive"
    // signal — if you see the arm waving, the rig + skinning is wired.
    const st = selfTestRef.current;
    const sinceLastFrame = performance.now() - lastFrameMsRef.current;
    const selfTestActive = sinceLastFrame > 500 && sceneRef.current;
    if (selfTestActive) {
      if (!st.bone) {
        let found: THREE.Bone | null = null;
        sceneRef.current!.traverse((o) => {
          if (found) return;
          const b = o as THREE.Bone;
          if (!b.isBone) return;
          const norm = o.name.replace(/^mixamorig:?/i, '').toLowerCase();
          if (norm === 'leftarm' || norm === 'left_arm' || norm === 'l_upperarm') {
            found = b;
          }
        });
        if (found) {
          st.bone = found;
          if (!st.logged) {
            setDiag((d) => ({ ...d, selfTestBone: (found as THREE.Bone).name }));
            st.logged = true;
          }
        }
      }
      if (st.bone) {
        const tt = performance.now() / 700;
        st.bone.rotation.z = Math.sin(tt) * 0.7;
      }
    }

    // Periodically mirror the retargeter's state into the diag overlay.
    if (performance.now() - lastDiagPushRef.current > 500) {
      lastDiagPushRef.current = performance.now();
      const rt = retargeterRef.current;
      setDiag((d) => ({
        ...d,
        frameCount: d.frameCount + 1,
        ySign: rt?.ySignDetected() ?? null,
        lastRotSnapshot: rt?.debugRotations() ?? '(no retargeter)',
      }));
    }
  });

  useEffect(() => {
    if (!sceneRef.current) return;
    const rt = new PoseRetargeter();
    rt.bind(sceneRef.current);
    retargeterRef.current = rt;

    // Populate the visible diagnostic with what we found.
    const boneList: string[] = [];
    sceneRef.current.traverse((o) => {
      if ((o as THREE.Bone).isBone) boneList.push(o.name);
    });
    setDiag((d) => ({
      ...d,
      bones: boneList,
      resolvedHips: rt.resolvedHipsName(),
      resolvedDrives: rt.resolvedDrivesMap(),
    }));

    // Skeleton overlay — vivid orange lines on every bone in the GLB,
    // rendered on top of the mesh (depthTest off) so we can always see
    // the bones moving even if the mesh material is opaque. This is
    // the single best diagnostic for "is the retargeter actually
    // working" — if the bones move with the user, all good.
    const helper = new THREE.SkeletonHelper(sceneRef.current);
    const mat = helper.material as THREE.LineBasicMaterial;
    mat.linewidth = 4;
    mat.color = new THREE.Color('#FF8A4C');
    mat.depthTest = false;
    mat.transparent = true;
    mat.opacity = 0.95;
    helper.renderOrder = 999;
    rootScene.add(helper);

    return () => {
      rootScene.remove(helper);
      if (retargeterRef.current === rt) retargeterRef.current = null;
    };
  }, [retargeterRef, rootScene, scene]);

  // Centre + scale the model on bind. GLBs export at arbitrary scales —
  // measure the bounding box and normalise so the figure is roughly the
  // same on-screen height regardless of source.
  useEffect(() => {
    if (!sceneRef.current) return;
    const box = new THREE.Box3().setFromObject(sceneRef.current);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetHeight = 2; // metres-ish
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    sceneRef.current.scale.setScalar(scale);
    // Re-measure after scaling and centre on the X/Z axes; sit the feet on y=−1.
    sceneRef.current.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(sceneRef.current);
    sceneRef.current.position.set(
      -(box2.min.x + box2.max.x) / 2,
      -1 - box2.min.y,
      -(box2.min.z + box2.max.z) / 2,
    );
    camera.lookAt(0, 1, 0);
  }, [scene, camera]);

  // Enable shadows on the avatar's meshes + collect every SkinnedMesh
  // so the per-frame skeleton.update() call (above) can hit them.
  useEffect(() => {
    if (!sceneRef.current) return;
    const meshes: THREE.SkinnedMesh[] = [];
    sceneRef.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Make sure every bone in the rig auto-updates its world
        // matrix. Some GLB exports disable autoUpdate on the armature
        // (an optimisation that prevents idle animation cost) which
        // also blocks our retargeter from showing visible motion.
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          const sm = mesh as THREE.SkinnedMesh;
          meshes.push(sm);
          sm.skeleton.bones.forEach((b) => {
            b.matrixAutoUpdate = true;
          });
        }
      }
    });
    skinnedMeshesRef.current = meshes;
    setDiag((d) => ({ ...d, skinnedMeshCount: meshes.length }));
  }, [scene, setDiag]);

  return <primitive object={scene} ref={sceneRef} />;
}

// Pre-warm the GLB loader so the first session navigation doesn't pay the
// model fetch + parse cost at view-mount time.
useGLTF.preload(DEFAULT_MODEL_URL);
