// 3D joint-angle math, One-Euro smoothing, peak-based rep counter.

export type Pt3 = { x: number; y: number; z: number; visibility?: number };

export function angleAt(a: Pt3, b: Pt3, c: Pt3): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAB = Math.hypot(ab.x, ab.y, ab.z);
  const magCB = Math.hypot(cb.x, cb.y, cb.z);
  if (magAB === 0 || magCB === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function jointConfidence(a: Pt3, b: Pt3, c: Pt3): number {
  // Use min instead of mean — a single low-visibility landmark is enough
  // to make the computed angle untrustworthy, so we don't want a high
  // average to mask it.
  const va = a.visibility ?? 0;
  const vb = b.visibility ?? 0;
  const vc = c.visibility ?? 0;
  return Math.min(va, vb, vc);
}

/**
 * Rolling median filter — robust to MediaPipe's occasional landmark jumps
 * (e.g. when an arm crosses the body or briefly leaves frame).
 */
export class MedianFilter {
  private buf: number[] = [];
  constructor(private readonly size = 5) {}

  filter(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  reset() {
    this.buf = [];
  }
}

/**
 * 3-component (x, y, z) median filter for a single landmark. Cheaper than
 * running three independent MedianFilters because we share the ring buffer
 * length check.
 */
export class LandmarkMedianFilter {
  private x: MedianFilter;
  private y: MedianFilter;
  private z: MedianFilter;
  constructor(window = 3) {
    this.x = new MedianFilter(window);
    this.y = new MedianFilter(window);
    this.z = new MedianFilter(window);
  }
  filter(p: Pt3): Pt3 {
    return {
      x: this.x.filter(p.x),
      y: this.y.filter(p.y),
      z: this.z.filter(p.z),
      visibility: p.visibility,
    };
  }
  reset() {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

/** Clamp an angle to anatomically plausible bounds. */
export function clampAngle(deg: number, min = 0, max = 180): number {
  if (!isFinite(deg)) return min;
  if (deg < min) return min;
  if (deg > max) return max;
  return deg;
}

function alpha(dt: number, cutoff: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private prev?: number;
  private prevDeriv = 0;
  private prevT?: number;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.05,
    private dCutoff = 1.0,
  ) {}

  /**
   * Standard One-Euro filter step.
   *
   * @param confidence optional 0-1 quality estimate for this sample. Below
   *   ~0.5 we *increase* smoothing (lower effective min-cutoff) so noisy
   *   low-visibility frames don't pull the filtered value around.
   */
  filter(value: number, tMs: number, confidence = 1): number {
    if (this.prev === undefined || this.prevT === undefined) {
      this.prev = value;
      this.prevT = tMs;
      return value;
    }
    const dt = Math.max(1, tMs - this.prevT) / 1000;
    const dx = (value - this.prev) / dt;
    const aD = alpha(dt, this.dCutoff);
    const edx = aD * dx + (1 - aD) * this.prevDeriv;
    // Confidence scaling: at conf=1, use the configured minCutoff. As conf
    // drops toward 0, multiply minCutoff by the confidence so the cutoff
    // gets smaller (more lag, more stability).
    const confScale = Math.max(0.15, confidence);
    const cutoff = this.minCutoff * confScale + this.beta * Math.abs(edx);
    const a = alpha(dt, cutoff);
    const out = a * value + (1 - a) * this.prev;
    this.prev = out;
    this.prevDeriv = edx;
    this.prevT = tMs;
    return out;
  }

  reset() {
    this.prev = undefined;
    this.prevDeriv = 0;
    this.prevT = undefined;
  }
}

export type RepEvent = {
  /** rep number (1-indexed) */
  index: number;
  /** ms from session start at which the rep completed */
  tMs: number;
  /** ms since previous rep */
  intervalMs: number;
  /** range of motion (max angle - min angle) during this rep */
  romDeg: number;
  /** peak (max) angle reached during the rep */
  peakAngle: number;
  /** trough (min) angle reached during the rep */
  troughAngle: number;
  /** mean angular speed during the rep (deg/s) */
  meanSpeedDegPerSec: number;
  /** symmetry of up/down phases (closer to 1 = more symmetric) */
  symmetry: number;
};

/**
 * Peak-detection rep counter.
 *
 * A rep = the angle reached a maximum (peak), then descended past
 * `extendedAbove` minus a small return margin, then climbed back past
 * `flexedBelow + margin` again — confirming a full down-up cycle.
 *
 * Compared to the old zero-crossing approach, this:
 *  - is robust to wobble around the threshold
 *  - records per-rep timing, ROM, and symmetry
 *  - only emits at the *completion* of a rep
 */
export class RepCounter {
  // Tracking state
  private phase: 'idle' | 'rising' | 'falling' = 'idle';
  private repIndex = 0;

  // Current cycle stats
  private cycleStartT = 0;
  private cyclePeakT = 0;
  private cyclePeakAngle = -Infinity;
  private cycleTroughAngle = Infinity;
  private samples = 0;
  private speedAccum = 0;
  private prevAngle = NaN;
  private prevT = 0;
  private lastEmitT = 0;

  // History
  private reps: RepEvent[] = [];

  constructor(
    /** angle below which we consider the joint "flexed" (e.g. knee bent) */
    public flexedBelow: number,
    /** angle above which we consider the joint "extended" */
    public extendedAbove: number,
    /** hysteresis margin (degrees) — keeps the counter from chattering near thresholds */
    public margin: number = 5,
    /** confidence below which a frame is ignored — low-visibility data is noise */
    public minConfidence: number = 0.4,
    /** debounce so two reps can't fire within this many ms (rejects double-counts) */
    public minRepIntervalMs: number = 500,
    /** reject angle samples that jump more than this in a single frame (deg/100ms) */
    public maxJumpDegPer100Ms: number = 40,
  ) {}

  /**
   * Feed a new (filtered) angle reading.
   * Returns `null` on most frames, or a `RepEvent` when a full rep just completed.
   *
   * @param confidence optional 0-1 visibility score; frames below
   *   `minConfidence` are silently ignored so a brief occlusion doesn't
   *   produce a spurious peak.
   */
  update(angleDeg: number, tMs: number, confidence = 1): RepEvent | null {
    // Confidence gate — ignore noisy frames.
    if (confidence < this.minConfidence) return null;

    // Outlier gate — MediaPipe occasionally flips a landmark and we get a
    // single-frame jump of 50-90 degrees. Skip it; the median filter on
    // the input will smooth subsequent frames.
    if (!isNaN(this.prevAngle) && this.prevT) {
      const dt = Math.max(1, tMs - this.prevT);
      const jumpPer100 = (Math.abs(angleDeg - this.prevAngle) / dt) * 100;
      if (jumpPer100 > this.maxJumpDegPer100Ms) return null;
    }

    // Update rolling speed
    if (!isNaN(this.prevAngle) && this.prevT) {
      const dt = (tMs - this.prevT) / 1000;
      if (dt > 0) {
        this.speedAccum += Math.abs(angleDeg - this.prevAngle) / dt;
        this.samples += 1;
      }
    }
    this.prevAngle = angleDeg;
    this.prevT = tMs;

    // State machine
    switch (this.phase) {
      case 'idle': {
        // Wait for the angle to enter the "extended" range — that's the start
        if (angleDeg > this.extendedAbove - this.margin) {
          this.startCycle(angleDeg, tMs);
          this.phase = 'falling';
        }
        return null;
      }
      case 'falling': {
        // Looking for the descent into flexion
        if (angleDeg < this.cycleTroughAngle) this.cycleTroughAngle = angleDeg;
        if (angleDeg < this.flexedBelow + this.margin) {
          this.cyclePeakT = tMs;
          this.phase = 'rising';
        }
        return null;
      }
      case 'rising': {
        // Looking for return to extension — completes the rep
        if (angleDeg > this.cyclePeakAngle) this.cyclePeakAngle = angleDeg;
        if (angleDeg > this.extendedAbove - this.margin) {
          // Debounce — protect against threshold chatter when the motion
          // barely crosses the extension band.
          if (tMs - this.lastEmitT < this.minRepIntervalMs) return null;
          const event = this.completeRep(tMs);
          this.lastEmitT = tMs;
          this.startCycle(angleDeg, tMs);
          this.phase = 'falling';
          return event;
        }
        return null;
      }
    }
  }

  private startCycle(angleDeg: number, tMs: number) {
    this.cycleStartT = tMs;
    this.cyclePeakT = tMs;
    this.cyclePeakAngle = angleDeg;
    this.cycleTroughAngle = angleDeg;
    this.samples = 0;
    this.speedAccum = 0;
  }

  private completeRep(tMs: number): RepEvent {
    this.repIndex += 1;
    const romDeg = Math.max(0, this.cyclePeakAngle - this.cycleTroughAngle);
    const prev = this.reps[this.reps.length - 1];
    const intervalMs = prev ? tMs - prev.tMs : tMs - this.cycleStartT;
    const meanSpeed = this.samples > 0 ? this.speedAccum / this.samples : 0;
    const fall = Math.max(1, this.cyclePeakT - this.cycleStartT);
    const rise = Math.max(1, tMs - this.cyclePeakT);
    const symmetry = 1 - Math.abs(fall - rise) / (fall + rise);
    const ev: RepEvent = {
      index: this.repIndex,
      tMs,
      intervalMs,
      romDeg,
      peakAngle: this.cyclePeakAngle,
      troughAngle: this.cycleTroughAngle,
      meanSpeedDegPerSec: meanSpeed,
      symmetry,
    };
    this.reps.push(ev);
    if (this.reps.length > 100) this.reps.shift();
    return ev;
  }

  count(): number {
    return this.repIndex;
  }

  history(): readonly RepEvent[] {
    return this.reps;
  }

  /** Mean inter-rep interval (ms). 0 until 2+ reps. */
  cadenceMs(): number {
    if (this.reps.length < 2) return 0;
    let s = 0;
    let n = 0;
    for (let i = 1; i < this.reps.length; i++) {
      s += this.reps[i]!.intervalMs;
      n += 1;
    }
    return n > 0 ? s / n : 0;
  }

  /** Standard deviation of inter-rep intervals (ms) — regularity. */
  cadenceVarMs(): number {
    if (this.reps.length < 3) return 0;
    const intervals: number[] = [];
    for (let i = 1; i < this.reps.length; i++) intervals.push(this.reps[i]!.intervalMs);
    const mean = intervals.reduce((s, x) => s + x, 0) / intervals.length;
    const variance = intervals.reduce((s, x) => s + (x - mean) ** 2, 0) / intervals.length;
    return Math.sqrt(variance);
  }

  reset() {
    this.phase = 'idle';
    this.repIndex = 0;
    this.reps = [];
    this.prevAngle = NaN;
    this.prevT = 0;
    this.samples = 0;
    this.speedAccum = 0;
    this.lastEmitT = 0;
  }
}
