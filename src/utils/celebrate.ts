import { create } from 'zustand';
import { playWin, isSoundEnabled } from '@/utils/sound';

const CELEBRATION_KEY = 'aeonian:celebration:enabled';

// ── Celebration preference store ─────────────────────────────────────────────

interface CelebrationPrefState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useCelebrationStore = create<CelebrationPrefState>((set) => ({
  enabled: (() => {
    try {
      const stored = localStorage.getItem(CELEBRATION_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  })(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(CELEBRATION_KEY, String(v));
    } catch {
      // storage unavailable — state still updates in-memory
    }
    set({ enabled: v });
  },
}));

export function isCelebrationEnabled(): boolean {
  return useCelebrationStore.getState().enabled;
}

export function setCelebrationEnabled(v: boolean): void {
  useCelebrationStore.getState().setEnabled(v);
}

// ── Celebration trigger store ─────────────────────────────────────────────────

export interface CelebrationPayload {
  pnl: number;      // USD amount (positive)
  symbol?: string;  // e.g. "SOL-PERP"
}

interface CelebrateState {
  /** Increments on every celebrate() call — CelebrationOverlay watches this. */
  celebrateCount: number;
  payload: CelebrationPayload | null;
  celebrate: (payload: CelebrationPayload) => void;
}

export const useCelebrateStore = create<CelebrateState>((set) => ({
  celebrateCount: 0,
  payload: null,
  celebrate: (payload) => set((s) => ({ celebrateCount: s.celebrateCount + 1, payload })),
}));

/** Call this from anywhere on a profitable position close. */
export function celebrate(pnl: number, symbol?: string): void {
  // Win chime is gated by the SOUND setting
  if (isSoundEnabled()) {
    playWin();
  }
  // Fireworks celebration is gated by the CELEBRATION setting
  if (isCelebrationEnabled()) {
    useCelebrateStore.getState().celebrate({ pnl, symbol });
  }
}
