/**
 * launch-rocket — global trigger store for the rocket launch celebration.
 *
 * Mirrors the shape of celebrate.ts so it can be consumed from anywhere.
 * Call launchRocket(symbol?) after a successful position OPEN.
 */
import { create } from 'zustand';
import { isSoundEnabled, playRocket } from '@/utils/sound';

export interface RocketLaunchPayload {
  symbol?: string; // e.g. "SOL-PERP"
}

interface RocketLaunchState {
  /** Increments on every launchRocket() call — RocketLaunchOverlay watches this. */
  launchCount: number;
  payload: RocketLaunchPayload | null;
  triggerLaunch: (payload: RocketLaunchPayload) => void;
}

export const useRocketLaunchStore = create<RocketLaunchState>((set) => ({
  launchCount: 0,
  payload: null,
  triggerLaunch: (payload) =>
    set((s) => ({ launchCount: s.launchCount + 1, payload })),
}));

/** Call this from anywhere on a successful position open. */
export function launchRocket(symbol?: string): void {
  if (isSoundEnabled()) {
    playRocket();
  }
  useRocketLaunchStore.getState().triggerLaunch({ symbol });
}
