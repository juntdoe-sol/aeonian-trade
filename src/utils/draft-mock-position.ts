/**
 * Draft-only mock position for testing the win-celebration flow.
 *
 * Guard: draft = NOT LIVE environment AND offchain chain (Poofnet/local).
 * This matches the condition used in getRpcUrl() in config.ts.
 *
 * The mock is injected into the positions list on draft so the user can click
 * "Close" and trigger celebrate(). It must NEVER appear on preview or live.
 */
import type { RisePosition } from '@/utils/phoenix-mappers';

/** True only on the Poofnet/draft build (VITE_ENV !== 'LIVE' AND VITE_CHAIN === 'offchain'). */
export const isDraftEnv: boolean =
  import.meta.env.VITE_ENV !== 'LIVE' &&
  import.meta.env.VITE_CHAIN === 'offchain';

/**
 * A single fake profitable SOL-PERP long that satisfies mapPosition:
 *   side  = 'long'  (positionSize.ui > 0)
 *   pnl   = 5       (unrealizedPnl.ui = '5.0')
 * The [key: string]: unknown index signature is satisfied by the spread.
 */
export const MOCK_DRAFT_POSITION: RisePosition = {
  symbol: 'SOL-PERP',
  positionSize:     { value: 1000000,   decimals: 6, ui: '1.0'    },
  entryPrice:       { value: 100000000, decimals: 6, ui: '100.00' },
  markPrice:        { value: 105000000, decimals: 6, ui: '105.00' },
  unrealizedPnl:    { value: 5000000,   decimals: 6, ui: '5.0'    },
  liquidationPrice: { value: 50000000,  decimals: 6, ui: '50.00'  },
  positionValue:    { value: 105000000, decimals: 6, ui: '105.00' },
  initialMargin:    { value: 10000000,  decimals: 6, ui: '10.00'  },
  subaccountIndex:  0,
  /** Marker used by handleClosePosition to short-circuit the real Phoenix close. */
  _isMockDraftPosition: true,
};

/** Returns true when a mapped position originated from MOCK_DRAFT_POSITION. */
export function isMockPosition(rawPos: RisePosition): boolean {
  return rawPos._isMockDraftPosition === true;
}
