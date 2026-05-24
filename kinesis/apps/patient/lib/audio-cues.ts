'use client';

/**
 * Minimal Web Audio cue system — short tones + countdown numbers via
 * SpeechSynthesis. No audio assets. Plays only when armed.
 */

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithWebkitAudio;
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // The browser may suspend the context until the user gestures.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, durationMs: number, gain = 0.06) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.value = 0;
  osc.connect(g).connect(c.destination);
  const now = c.currentTime;
  // Quick attack, exponential decay to avoid clicks
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function unlockAudio() {
  // Call inside a user-gesture handler to unlock iOS Safari.
  getCtx();
}

export function repBeep() {
  tone(880, 120);
}

export function goBeep() {
  tone(440, 180);
  setTimeout(() => tone(880, 220), 200);
}

export function warningBeep() {
  tone(220, 240, 0.05);
}

export function speak(text: string) {
  if (typeof window === 'undefined') return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
  } catch {
    // ignore — speech is best-effort
  }
}

/**
 * Spoken 3-2-1-GO countdown returning a Promise that resolves on "GO".
 * Falls back to tone-only if SpeechSynthesis is unavailable.
 */
export function countdown(seconds = 3): Promise<void> {
  return new Promise((resolve) => {
    let n = seconds;
    const beep = (low: boolean) => tone(low ? 440 : 880, 140);
    const tick = () => {
      if (n <= 0) {
        speak('Go');
        goBeep();
        resolve();
        return;
      }
      speak(String(n));
      beep(true);
      n -= 1;
      setTimeout(tick, 900);
    };
    tick();
  });
}
