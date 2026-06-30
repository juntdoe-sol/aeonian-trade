/**
 * Sound manager for AEONIAN — programmatic Web Audio API synthesis.
 * No external audio files or packages required.
 *
 * Two sounds:
 *  - playClick(): a very subtle soft-sine tick (~40ms, gain 0.06)
 *  - playWin():   a gentle ascending 3-note chime (~500ms, gain 0.07)
 *
 * Mute preference is persisted to localStorage under SOUND_KEY.
 * The zustand store lets any React component subscribe to the enabled state.
 */

import { create } from 'zustand';

const SOUND_KEY = 'aeonian:sound:enabled';

// ── State store ──────────────────────────────────────────────────────────────

interface SoundState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useSoundStore = create<SoundState>((set) => ({
  enabled: (() => {
    try {
      const stored = localStorage.getItem(SOUND_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  })(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(SOUND_KEY, String(v));
    } catch {
      // storage unavailable — state still updates in-memory
    }
    set({ enabled: v });
  },
}));

export function isSoundEnabled(): boolean {
  return useSoundStore.getState().enabled;
}

export function setSoundEnabled(v: boolean): void {
  useSoundStore.getState().setEnabled(v);
}

// ── AudioContext singleton ────────────────────────────────────────────────────

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) {
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => null);
    }
    return ctx;
  }
  try {
    ctx = new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

// ── playClick ─────────────────────────────────────────────────────────────────
// A very soft, short sine blip — subtle haptic-feel button confirmation.

export function playClick(): void {
  if (!isSoundEnabled()) return;
  const ac = getCtx();
  if (!ac) return;

  try {
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.04);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // no-op — audio failure should never break the UI
  }
}

// ── playWin ───────────────────────────────────────────────────────────────────
// A bright, upbeat victory fanfare — quick ascending major-key run with a
// sparkling top note. Five notes: C5 → E5 → G5 → C6 → E6, each 90ms apart,
// using a sine+square blend for brightness. Total duration ~1.1s.

const WIN_NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
const WIN_NOTE_GAP = 0.09;  // seconds between note starts (snappy)
const WIN_NOTE_DECAY = 0.28; // each note fades in this window

export function playWin(): void {
  if (!isSoundEnabled()) return;
  const ac = getCtx();
  if (!ac) return;

  try {
    const now = ac.currentTime;

    WIN_NOTES.forEach((freq, i) => {
      const startAt = now + i * WIN_NOTE_GAP;
      const isFinalNote = i === WIN_NOTES.length - 1;
      // Final top note rings a little longer for emphasis
      const decay = isFinalNote ? WIN_NOTE_DECAY * 2.2 : WIN_NOTE_DECAY;
      // Peak volume ramps up slightly across the run — builds excitement
      const peakGain = 0.05 + i * 0.016;

      // Sine oscillator — clean fundamental
      const oscSine = ac.createOscillator();
      const gainSine = ac.createGain();
      oscSine.type = 'sine';
      oscSine.frequency.setValueAtTime(freq, startAt);
      gainSine.gain.setValueAtTime(0.0001, startAt);
      gainSine.gain.linearRampToValueAtTime(peakGain, startAt + 0.012);
      gainSine.gain.exponentialRampToValueAtTime(0.0001, startAt + decay);
      oscSine.connect(gainSine);
      gainSine.connect(ac.destination);
      oscSine.start(startAt);
      oscSine.stop(startAt + decay + 0.02);

      // Square oscillator at half volume for brightness/sparkle
      const oscSq = ac.createOscillator();
      const gainSq = ac.createGain();
      oscSq.type = 'square';
      oscSq.frequency.setValueAtTime(freq, startAt);
      gainSq.gain.setValueAtTime(0.0001, startAt);
      gainSq.gain.linearRampToValueAtTime(peakGain * 0.28, startAt + 0.012);
      gainSq.gain.exponentialRampToValueAtTime(0.0001, startAt + decay * 0.6);

      // Lowpass filter on the square to soften harsh harmonics
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, startAt);

      oscSq.connect(lp);
      lp.connect(gainSq);
      gainSq.connect(ac.destination);
      oscSq.start(startAt);
      oscSq.stop(startAt + decay + 0.02);
    });
  } catch {
    // no-op
  }
}

// ── playRocket ────────────────────────────────────────────────────────────────
// Rocket takeoff whoosh — a rising broadband noise sweep with a low rumble.
// Synthesized entirely in Web Audio: no external files, no network.
// ~1.8s total: initial low roar ramps into a high-frequency rush as the rocket
// accelerates off-screen.

export function playRocket(): void {
  if (!isSoundEnabled()) return;
  const ac = getCtx();
  if (!ac) return;

  try {
    const now = ac.currentTime;
    const DURATION = 1.85;

    // ── 1. White noise layer (the "whoosh" air-rush component) ──────────────
    const bufSize = ac.sampleRate * DURATION;
    const noiseBuffer = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = ac.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bandpass filter — starts low, sweeps up (engine → air-rush)
    const bpFilter = ac.createBiquadFilter();
    bpFilter.type = 'bandpass';
    bpFilter.frequency.setValueAtTime(180, now);
    bpFilter.frequency.exponentialRampToValueAtTime(3200, now + DURATION);
    bpFilter.Q.setValueAtTime(0.8, now);

    // Highpass filter to clean up very low rumble bleed
    const hpFilter = ac.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.setValueAtTime(80, now);

    const noiseGain = ac.createGain();
    // Attack: quick ramp up, then fade as rocket exits
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    noiseGain.gain.linearRampToValueAtTime(0.22, now + 0.5);
    noiseGain.gain.linearRampToValueAtTime(0.12, now + 1.2);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION);

    noiseSource.connect(bpFilter);
    bpFilter.connect(hpFilter);
    hpFilter.connect(noiseGain);
    noiseGain.connect(ac.destination);
    noiseSource.start(now);
    noiseSource.stop(now + DURATION);

    // ── 2. Low-frequency rumble (engine body) ─────────────────────────────
    const rumbleOsc = ac.createOscillator();
    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.setValueAtTime(55, now);
    rumbleOsc.frequency.linearRampToValueAtTime(90, now + DURATION);

    // Slight distortion via waveshaper to add harmonics
    const waveShaper = ac.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x));
    }
    waveShaper.curve = curve;

    const rumbleLp = ac.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.setValueAtTime(220, now);

    const rumbleGain = ac.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.09, now + 0.1);
    rumbleGain.gain.linearRampToValueAtTime(0.06, now + 0.9);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION);

    rumbleOsc.connect(waveShaper);
    waveShaper.connect(rumbleLp);
    rumbleLp.connect(rumbleGain);
    rumbleGain.connect(ac.destination);
    rumbleOsc.start(now);
    rumbleOsc.stop(now + DURATION);

    // ── 3. Short ignition transient ───────────────────────────────────────
    const kickOsc = ac.createOscillator();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(140, now);
    kickOsc.frequency.exponentialRampToValueAtTime(30, now + 0.18);

    const kickGain = ac.createGain();
    kickGain.gain.setValueAtTime(0.0001, now);
    kickGain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    kickOsc.connect(kickGain);
    kickGain.connect(ac.destination);
    kickOsc.start(now);
    kickOsc.stop(now + 0.25);

  } catch {
    // no-op — audio failure should never break the UI
  }
}
