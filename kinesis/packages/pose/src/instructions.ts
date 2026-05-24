// Per-exercise instructions catalogue.
//
// The Firestore /exercises collection holds the canonical name + default
// joints. This file augments those records with step-by-step instructions,
// form cues, safety notes, and an animation spec — content that doesn't
// change per-patient and so doesn't belong in the database.
//
// The animation spec is a small declarative description (which joint
// rotates and between which angles) that ExerciseAnimation interprets to
// render a looping stick-figure demo. No animation assets required.

import type { JointKey } from './exercises';

export type AnimationSpec = {
  /** Which limb segment animates (drives the SVG figure). */
  joint: JointKey;
  /** Angle range the segment sweeps through during one rep (degrees). */
  range: [number, number];
  /** Cycle duration in milliseconds for one full down-up rep. */
  durationMs: number;
  /**
   * Optional dotLottie URL — when set, the animation viewer renders a
   * looping Lottie player instead of the SVG fallback. The expected
   * source is a publicly-hosted .lottie or .json file (e.g. from the
   * LottieFiles CDN at https://lottie.host/...). When the asset fails
   * to load or this field is unset, the SVG figure is used.
   */
  lottieUrl?: string;
  /**
   * Optional MP4 / WebM video URL — preferred over the SVG fallback
   * when set and when no `lottieUrl` is provided. The viewer renders an
   * autoplay, muted, looping <video> element.
   */
  videoUrl?: string;
  /** Optional poster image shown while the video loads. */
  videoPoster?: string;
};

export type ExerciseInstructions = {
  /** Short imperative title shown above the figure ("Bend the knee slowly"). */
  oneLiner: string;
  /** Numbered setup steps. */
  setup: string[];
  /** Form cues displayed during the rep. */
  cues: string[];
  /** Safety reminders + when to stop. */
  safety: string[];
  /** Animation spec for the looping demo figure. */
  animation: AnimationSpec;
  /** Common mistakes to avoid. */
  avoid?: string[];
};

/**
 * Registry keyed by Firestore exerciseId. Add new exercises here whenever
 * the catalogue grows in `/exercises`.
 *
 * The `videoUrl` fields point at MP4 files served by Google's open
 * `gtv-videos-bucket` (publicly cacheable demo content used by countless
 * sample apps and tutorials). They're generic motion clips, not literal
 * physiotherapy demos — they exist so the patient sees *something* moving
 * inside the viewer until the clinic uploads their own demo footage to
 * Firebase Storage. Any 4xx/5xx from the URL drops us back to the local
 * SVG figure, which is always available.
 *
 * To replace any of these with a clinic-specific demo, just update the
 * `videoUrl` (or set `lottieUrl` for a Lottie animation hosted on
 * lottie.host). The viewer picks up the new asset on the next page
 * load — no other code changes required.
 */
export const EXERCISE_INSTRUCTIONS: Record<string, ExerciseInstructions> = {
  'knee-flexion': {
    oneLiner: 'Slowly bend and straighten the knee',
    setup: [
      'Sit on a sturdy chair with feet flat on the floor.',
      'Keep your back upright and shoulders relaxed.',
      'Position so the tracked leg is fully visible to the camera.',
    ],
    cues: [
      'Lift the foot off the floor and extend the leg in front of you.',
      'Slowly bring the heel back toward the chair, bending the knee.',
      'Return to full extension before the next rep.',
      'Move at a steady tempo — about 2 seconds up, 2 seconds down.',
    ],
    safety: [
      'Stop immediately if you feel a sharp pain.',
      'It is normal to feel mild stretching — sharp or popping is not.',
    ],
    avoid: [
      'Locking the knee at the top of the rep.',
      'Letting the foot slap the floor between reps.',
    ],
    animation: {
      joint: 'right_knee',
      range: [40, 170],
      durationMs: 2600,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    },
  },

  'shoulder-abduction': {
    oneLiner: 'Lift the arm out to the side',
    setup: [
      'Stand tall with feet shoulder-width apart, arms relaxed at your sides.',
      'Face the camera so the tracked arm is fully in frame.',
      'Soften the knees slightly to avoid leaning.',
    ],
    cues: [
      'Lift the arm sideways, away from your body.',
      'Keep the elbow soft — not locked.',
      'Stop at shoulder height or wherever the prescribed range is.',
      'Lower slowly with control.',
    ],
    safety: [
      'Do not shrug — keep the shoulders down and back.',
      'If you feel a pinch, lower the arm and rest before continuing.',
    ],
    avoid: ['Swinging the arm up with momentum.', 'Leaning the torso to compensate.'],
    animation: {
      joint: 'right_shoulder',
      range: [10, 110],
      durationMs: 2400,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    },
  },

  'hip-extension': {
    oneLiner: 'Extend the leg backward from the hip',
    setup: [
      'Stand facing a chair or wall, holding it lightly for balance.',
      'Position the camera to the side so the tracked hip is visible.',
      'Engage your core gently before starting.',
    ],
    cues: [
      'Squeeze the glute on the working side.',
      'Extend the leg straight backward, keeping it straight.',
      'Lift only as far as you can without rotating the pelvis.',
      'Return to start with control.',
    ],
    safety: [
      'Stop if you feel pain in the lower back — adjust your posture first.',
      'Keep the standing leg slightly bent.',
    ],
    avoid: ['Arching the lower back.', 'Twisting the hips toward the moving side.'],
    animation: {
      joint: 'right_hip',
      range: [165, 110],
      durationMs: 2600,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    },
  },

  'elbow-curl': {
    oneLiner: 'Curl the forearm up toward the shoulder',
    setup: [
      'Sit or stand with arms at your sides.',
      'Keep the upper arm still — only the forearm moves.',
      'Face the camera at a slight angle so the elbow joint is visible.',
    ],
    cues: [
      'Curl the forearm up smoothly, palm facing you.',
      'Stop just short of the shoulder.',
      'Lower under control — resist gravity.',
      'Breathe out on the way up, in on the way down.',
    ],
    safety: ['Stop if elbow pain is sharp or radiates.'],
    avoid: ['Swinging the elbow forward.', 'Locking the elbow at the bottom.'],
    animation: {
      joint: 'right_elbow',
      range: [160, 50],
      durationMs: 2200,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    },
  },

  'ankle-dorsi': {
    oneLiner: 'Pull the toes up toward the shin',
    setup: [
      'Sit on a chair with both feet flat on the floor.',
      'Keep the heel grounded throughout the motion.',
      'Position the side of the tracked foot toward the camera.',
    ],
    cues: [
      'Pull the toes and forefoot up toward the shin.',
      'Hold the top for a beat, then lower slowly.',
      'Keep the leg still — only the foot moves.',
    ],
    safety: ['Stop if you feel a calf cramp — release and stretch the calf.'],
    avoid: ['Lifting the heel off the floor.', 'Rolling the foot inward or outward.'],
    animation: {
      joint: 'right_ankle',
      range: [120, 80],
      durationMs: 2200,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    },
  },

  'sit-to-stand': {
    oneLiner: 'Stand up from a chair, then sit back down — no hands.',
    setup: [
      'Sit toward the front of a sturdy chair, feet flat under the knees.',
      'Cross your arms over your chest or let them hang at your sides.',
      'Position the camera side-on so the knees and hips are visible.',
    ],
    cues: [
      'Hinge forward at the hips, weight through the heels.',
      'Press into the floor and stand up tall.',
      'Reverse the motion to sit back down — control the descent.',
      'Aim for a smooth tempo, ~3 seconds up and ~3 seconds down.',
    ],
    safety: [
      'Keep a sturdy chair or rail within reach in case you lose balance.',
      'Stop if knee pain is sharp or your form breaks down.',
    ],
    avoid: ['Slamming back into the chair.', 'Pushing off the thighs with your hands.'],
    animation: {
      joint: 'right_knee',
      range: [70, 170],
      durationMs: 3000,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    },
  },

  'wall-shoulder-flex': {
    oneLiner: 'Walk the fingertips up a wall to lift the arm overhead.',
    setup: [
      'Stand facing a wall, close enough that your fingertips reach it with a slight bend in the elbow.',
      'Plant your feet shoulder-width apart, soft knees.',
      'Position the camera so the working shoulder is in frame.',
    ],
    cues: [
      'Place the fingertips on the wall at shoulder height.',
      'Walk them up the wall as high as you comfortably can.',
      'Keep the shoulder pulled away from the ear — no shrugging.',
      'Walk the fingertips back down with control.',
    ],
    safety: [
      'Stop at the first sign of impingement or pinching.',
      'Move slowly — the goal is range, not speed.',
    ],
    avoid: ['Arching the lower back to fake extra range.', 'Hunching the shoulder up.'],
    animation: {
      joint: 'right_shoulder',
      range: [20, 160],
      durationMs: 3200,
      videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    },
  },
};

/**
 * Lookup helper — returns a generic fallback if the exercise isn't in the
 * registry yet (older catalogue entries, custom prescriptions, etc.).
 */
export function getExerciseInstructions(exerciseId: string | null | undefined, fallbackJoint?: JointKey): ExerciseInstructions {
  if (exerciseId && EXERCISE_INSTRUCTIONS[exerciseId]) return EXERCISE_INSTRUCTIONS[exerciseId]!;
  return {
    oneLiner: 'Move slowly through the full range of motion',
    setup: [
      'Position so the tracked joint is fully visible to the camera.',
      'Stand or sit comfortably with neutral posture.',
    ],
    cues: [
      'Move through the full range, slowly and with control.',
      'Avoid bouncing or jerky movement.',
      'Return to the start position before the next rep.',
    ],
    safety: ['Stop if you feel sharp or sudden pain.'],
    animation: {
      joint: fallbackJoint ?? 'right_knee',
      range: [40, 170],
      durationMs: 2400,
    },
  };
}
