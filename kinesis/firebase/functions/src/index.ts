/**
 * Firebase Cloud Functions for KINESIS.
 *
 * generateSessionSummary — triggered when a session transitions from live to
 * finalized (`isLive: true → false`). Calls Google Gemini to produce a short
 * clinician-friendly summary and writes it back to `aiSummary` on the session
 * document. Idempotent: skips if `aiSummary` already exists.
 *
 * Setup (one-time, per Firebase project):
 *   1) `firebase init functions` from the repo root
 *      (or just `cd firebase/functions && npm install`)
 *   2) Provide the Gemini key as a Cloud Functions secret:
 *      `firebase functions:secrets:set GEMINI_API_KEY`
 *      (Or set the GEMINI_API_KEY env var locally for the emulator.)
 *   3) `firebase deploy --only functions`
 *
 * Cost: one Gemini call per finalized session. Using gemini-1.5-flash which
 * is free for the small volumes we generate and cheap above the free tier.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// gemini-1.5-flash has a generous free tier and is plenty for short summaries.
// If the user wants higher quality, switch to gemini-1.5-pro (still free at
// low volumes).
const GEMINI_MODEL = 'gemini-1.5-flash';

type SessionDoc = {
  isLive?: boolean;
  aiSummary?: string | null;
  reps?: number;
  durationSeconds?: number;
  avgQuality?: number;
  classification?: string | null;
  jointKeys?: string[];
  peakRom?: Record<string, number>;
  exerciseId?: string | null;
  repStats?: Array<{
    index: number;
    romDeg: number;
    peakAngle: number;
    troughAngle: number;
    meanSpeed: number;
    symmetry: number;
  }>;
};

export const generateSessionSummary = onDocumentUpdated(
  {
    document: 'sessions/{sessionId}',
    secrets: [GEMINI_API_KEY],
    // Keep cold-start latency low — summaries should land within a few seconds
    // of session finalization so they're visible on the patient's report screen.
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before.data() as SessionDoc | undefined;
    const after = event.data?.after.data() as SessionDoc | undefined;
    if (!before || !after) return;

    // Trigger only on the live→finalized transition, and only if we haven't
    // already written a summary (avoids loops + repeat charges).
    const justFinalized = before.isLive === true && after.isLive === false;
    if (!justFinalized) return;
    if (after.aiSummary && after.aiSummary.trim().length > 0) return;

    const sessionId = event.params.sessionId;
    logger.info(`Generating summary for session ${sessionId}`);

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      logger.warn(`GEMINI_API_KEY not set — skipping summary for ${sessionId}`);
      return;
    }

    const prompt = buildPrompt(after);
    const systemPreamble =
      'You are a rehabilitation clinician writing concise summaries of patient ' +
      'exercise sessions for other clinicians. Use plain language. Cite the ' +
      'numbers you were given — never invent statistics. 4-6 sentences. ' +
      'No emoji, no bullet points, no headings.';

    try {
      const summary = await callGemini(apiKey, systemPreamble, prompt);
      if (!summary) {
        logger.warn(`Empty summary returned for session ${sessionId}`);
        return;
      }

      await db.collection('sessions').doc(sessionId).update({
        aiSummary: summary,
        aiSummaryGeneratedAt: new Date().toISOString(),
      });
      logger.info(`Saved summary for session ${sessionId} (${summary.length} chars)`);
    } catch (err: unknown) {
      logger.error('Gemini call failed', err instanceof Error ? err.message : err);
      // Don't rethrow — failing here would retry the trigger forever.
    }
  },
);

async function callGemini(apiKey: string, system: string, user: string): Promise<string> {
  // REST call — keeps the function dependency-light (no extra SDK in the
  // bundle, faster cold starts).
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 600,
      topP: 0.9,
    },
    // Default safety settings are fine for clinical summary text.
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${json.promptFeedback.blockReason}`);
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

function buildPrompt(s: SessionDoc): string {
  const durMin = Math.round((s.durationSeconds ?? 0) / 60);
  const reps = s.reps ?? 0;
  const quality = s.avgQuality ?? 0;
  const joints = (s.jointKeys ?? []).join(', ') || 'unspecified joints';
  const peakRomLines = Object.entries(s.peakRom ?? {})
    .map(([k, v]) => `  - ${k}: ${Math.round(v)}°`)
    .join('\n');
  const cls = s.classification ?? 'normal';
  const exercise = s.exerciseId ?? 'custom exercise';

  // Per-rep breakdown (last few reps if many)
  const reps_ = s.repStats ?? [];
  const repsBlock =
    reps_.length === 0
      ? '(no per-rep data)'
      : reps_
          .slice(-Math.min(reps_.length, 8))
          .map(
            (r) =>
              `  rep ${r.index}: ROM ${Math.round(r.romDeg)}°, peak ${Math.round(
                r.peakAngle,
              )}°, symmetry ${r.symmetry.toFixed(2)}`,
          )
          .join('\n');

  return `Write a short clinician-facing summary for this rehab session.

Exercise: ${exercise}
Tracked joints: ${joints}
Duration: ${durMin} min
Reps: ${reps}
Average movement quality: ${quality}/100
Classification: ${cls}
Peak ROM per joint:
${peakRomLines || '  (none recorded)'}

Per-rep data (most recent first; trimmed if long):
${repsBlock}

Write 4–6 sentences. State what the patient did, comment on movement quality, note any asymmetry or compensation if the data suggests it, and end with one short observation a clinician could act on. If the per-rep symmetry varies a lot, mention it. Do not invent metrics that aren't in the data above.`;
}
