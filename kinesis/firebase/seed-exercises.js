// Seed the global exercise catalog + one demo clinic.
// Run with:  node firebase/seed-exercises.js
// Requires:  GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON
//            (download from Firebase console → Project Settings → Service accounts).

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const EXERCISES = [
  { id: 'knee-flexion',         name: 'Knee Flexion',         description: 'Bend the knee then extend back to straight. Keep the hip stable.', category: 'leg',     difficulty: 'beginner',     defaultJoints: ['right_knee'], targetRom: 135, durationMin: 8 },
  { id: 'knee-extension',       name: 'Knee Extension',       description: 'From seated, straighten the knee fully then control the return.', category: 'leg',     difficulty: 'beginner',     defaultJoints: ['right_knee'], targetRom: 135, durationMin: 6 },
  { id: 'heel-slides',          name: 'Heel Slides',          description: 'Slide the heel toward the buttock, bending the knee, then extend.', category: 'leg',     difficulty: 'beginner',     defaultJoints: ['right_knee'], targetRom: 90,  durationMin: 8 },
  { id: 'wall-slides',          name: 'Wall Slides',          description: 'Stand with back to wall, slide down into a squat, then back up.',  category: 'leg',     difficulty: 'intermediate', defaultJoints: ['right_knee','left_knee'], targetRom: 120, durationMin: 14 },
  { id: 'sit-to-stand',         name: 'Sit-to-Stand',         description: 'From a chair, stand using both legs evenly, then sit back with control.', category: 'leg', difficulty: 'intermediate', defaultJoints: ['left_knee','right_knee','left_hip','right_hip'], targetRom: 90, durationMin: 10 },
  { id: 'hip-flexion-march',    name: 'Hip Flexion (Marching)', description: 'Standing tall, lift the knee toward the chest, then lower.',     category: 'leg',     difficulty: 'beginner',     defaultJoints: ['right_hip','right_knee'], targetRom: 120, durationMin: 8 },
  { id: 'ankle-dorsiflexion',   name: 'Ankle Dorsiflexion',   description: 'Seated, pull the foot up toward the shin, then point it away.',   category: 'leg',     difficulty: 'beginner',     defaultJoints: ['right_ankle'], targetRom: 30, durationMin: 6 },
  { id: 'elbow-flexion',        name: 'Elbow Flexion',        description: 'Bend the elbow, bringing hand toward the shoulder, then extend.', category: 'arm',     difficulty: 'beginner',     defaultJoints: ['right_elbow'], targetRom: 150, durationMin: 6 },
  { id: 'shoulder-abduction',   name: 'Shoulder Abduction',   description: 'Raise the arm sideways from the body up to ear level, then lower with control.', category: 'arm', difficulty: 'intermediate', defaultJoints: ['right_shoulder'], targetRom: 180, durationMin: 8 },
  { id: 'shoulder-flexion',     name: 'Shoulder Flexion',     description: 'Raise the arm forward and up overhead, then lower.',               category: 'arm',     difficulty: 'intermediate', defaultJoints: ['right_shoulder'], targetRom: 180, durationMin: 8 },
  { id: 'bilateral-arm-raise',  name: 'Bilateral Arm Raise',  description: 'Raise both arms forward to shoulder height, then lower. Track symmetry.', category: 'arm', difficulty: 'intermediate', defaultJoints: ['left_shoulder','right_shoulder'], targetRom: 120, durationMin: 8 },
  { id: 'step-ups',             name: 'Step-Ups · 6 inch',    description: 'Step up onto a 6 inch box, then back down. Alternate legs.',      category: 'balance', difficulty: 'intermediate', defaultJoints: ['right_knee','right_hip'], targetRom: 90, durationMin: 10 },
  { id: 'single-leg-balance',   name: 'Single-Leg Balance',   description: 'Stand on one leg for 30 seconds at a time. Keep hips level.',     category: 'balance', difficulty: 'intermediate', defaultJoints: ['right_hip'], targetRom: 30,  durationMin: 8 },
  { id: 'cycling-stationary',   name: 'Cycling · Stationary', description: 'Steady-state cycling for cardiovascular conditioning.',           category: 'cardio',  difficulty: 'advanced',     defaultJoints: ['left_knee','right_knee'], targetRom: 110, durationMin: 20 },
];

async function main() {
  console.log('Seeding exercises…');
  for (const ex of EXERCISES) {
    await db.collection('exercises').doc(ex.id).set({
      ...ex,
      clinicId: null,
      thumbnailUrl: null,
      demoVideoUrl: null,
    }, { merge: true });
    console.log(`  ✓ ${ex.id}`);
  }
  console.log('Seeding demo clinic…');
  await db.collection('clinics').doc('demo-clinic').set({
    name: 'KINESIS Demo Clinic',
    inviteCode: 'KINESIS-DEMO',
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('  ✓ demo-clinic · invite code: KINESIS-DEMO');
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
