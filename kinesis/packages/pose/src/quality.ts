// Rule-based movement quality scorer. Stable until a trained TFLite model lands.
// Mirrors the 4-class output planned in the implementation guide.

export type Classification = 'normal' | 'compensatory' | 'guarded' | 'abnormal';

export type QualityInput = {
  romDeg: number;
  targetRom: number;
  jerk: number;
  asymmetry: number;
  cadenceMs: number;
  cadenceVar: number;
};

export type QualityResult = {
  score: number;
  classification: Classification;
  probs: Record<Classification, number>;
  reasons: string[];
};

export const CLASS_COLORS: Record<Classification, string> = {
  normal: '#5C8A6E',
  compensatory: '#B89968',
  guarded: '#D4824A',
  abnormal: '#C44545',
};

export const CLASS_LABELS: Record<Classification, string> = {
  normal: 'Normal',
  compensatory: 'Compensatory',
  guarded: 'Guarded',
  abnormal: 'Abnormal',
};

export function scoreQuality(q: QualityInput): QualityResult {
  let score = 100;
  const reasons: string[] = [];

  const romRatio = q.romDeg / Math.max(1, q.targetRom);
  if (romRatio < 0.4) {
    score -= 40;
    reasons.push('ROM well below target — guarded');
  } else if (romRatio < 0.7) {
    score -= 20;
    reasons.push('ROM below target');
  }

  if (q.jerk > 800) {
    score -= 30;
    reasons.push('Movement is jerky');
  } else if (q.jerk > 400) {
    score -= 15;
    reasons.push('Some jerk detected');
  }

  if (q.asymmetry > 0.35) {
    score -= 20;
    reasons.push('Left/right asymmetry');
  } else if (q.asymmetry > 0.18) {
    score -= 10;
    reasons.push('Mild asymmetry');
  }

  if (q.cadenceMs > 0 && q.cadenceVar / q.cadenceMs > 0.45) {
    score -= 10;
    reasons.push('Irregular rep timing');
  }

  score = Math.max(0, Math.min(100, score));

  const guarded = romRatio < 0.5 && q.jerk < 500;
  const compensatory = q.asymmetry > 0.25 || q.jerk > 400;
  const abnormal = score < 35;

  let classification: Classification = 'normal';
  if (abnormal) classification = 'abnormal';
  else if (guarded) classification = 'guarded';
  else if (compensatory) classification = 'compensatory';

  const raw: Record<Classification, number> = {
    normal: score / 100,
    compensatory: compensatory ? 0.6 : 0.1,
    guarded: guarded ? 0.6 : 0.05,
    abnormal: abnormal ? 0.7 : 0.05,
  };
  const sum = raw.normal + raw.compensatory + raw.guarded + raw.abnormal;
  const probs: Record<Classification, number> = {
    normal: raw.normal / sum,
    compensatory: raw.compensatory / sum,
    guarded: raw.guarded / sum,
    abnormal: raw.abnormal / sum,
  };

  return { score: Math.round(score), classification, probs, reasons };
}
