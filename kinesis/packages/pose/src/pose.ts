// MediaPipe Pose Landmarker wrapper.
// Lazy-loads the model + WASM from Google's CDN, GPU-accelerated.

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

// IMPORTANT: keep this version in lock-step with the @mediapipe/tasks-vision
// version installed in packages/pose/package.json. The WASM asset paths
// changed between 0.10.22 and 0.10.35 (vision_wasm_internal.js etc.),
// so a mismatched pair returns 404s and the camera silently fails with
// "Can't start session".
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

const MODEL_URLS = {
  lite:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full:  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
} as const;

export type ModelVariant = keyof typeof MODEL_URLS;

let landmarker: PoseLandmarker | null = null;
let currentModel: ModelVariant = 'lite';

export type PoseResult = PoseLandmarkerResult;

/**
 * Per-model MediaPipe confidence thresholds.
 *
 * The 'heavy' model can afford to be stricter — its keypoint quality is
 * high enough that low-confidence detections really are noise. 'lite'
 * stays at the conservative MediaPipe default because tightening it on
 * the small model produces "no pose detected" gaps. 'full' splits the
 * difference.
 *
 * Bumping these is the cheapest single accuracy win available: noisy
 * landmarks no longer reach the angle pipeline.
 */
const MODEL_PARAMS: Record<ModelVariant, {
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}> = {
  lite:  { minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 },
  full:  { minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6 },
  heavy: { minPoseDetectionConfidence: 0.7, minPosePresenceConfidence: 0.7, minTrackingConfidence: 0.7 },
};

export async function getPoseLandmarker(model: ModelVariant = 'lite'): Promise<PoseLandmarker> {
  if (landmarker && currentModel === model) return landmarker;
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const params = MODEL_PARAMS[model];
  landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[model], delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: params.minPoseDetectionConfidence,
    minPosePresenceConfidence: params.minPosePresenceConfidence,
    minTrackingConfidence: params.minTrackingConfidence,
    // Per-pixel foreground mask, used by the renderer to draw a tinted
    // body silhouette under the skeleton. Negligible cost on GPU, big
    // visual upgrade — the patient sees their whole body highlighted
    // rather than just stick-figure lines.
    outputSegmentationMasks: true,
  });
  currentModel = model;
  return landmarker;
}

export function disposePoseLandmarker() {
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
}
