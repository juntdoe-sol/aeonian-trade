// ─── Shared Phoenix trading types ────────────────────────────────────────────

export interface TraderPosition {
  symbol?: string;
  side?: string;
  size?: number;
  entryPrice?: number;
  markPrice?: number;
  pnl?: number;
  leverage?: number;
  liquidationPrice?: number;
  subaccountIndex?: number;
  // Active exit triggers attached to the position (Phoenix /trader/state).
  // Present only when the trader has set a stop-loss / take-profit; 0 / undefined otherwise.
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface TraderOrder {
  orderId?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  size?: number;
  price?: number;
  createdAt?: number;
}

export interface TraderTrigger {
  symbol?: string;
  side?: string;
  triggerPrice?: number;
  size?: number;
  orderId?: string;
  triggerType?: string; // "stop_loss" | "take_profit"
}

/**
 * Raw Phoenix /trader/:address/trades-history fill.
 *
 * IMPORTANT — the live upstream does NOT return `size`/`side`, and `timestamp`
 * is an ISO 8601 STRING, not a numeric epoch. The authoritative per-fill fields
 * are: `baseLotsDelta`, `virtualQuoteLotsDelta`, `price`, `realizedPnl`, `fees`,
 * `liquidity`, `timestamp` (ISO string). A per-fill `symbol`/`market` is usually
 * NOT present. See .claude/memory/reference_phoenix_trades_history_notional.md.
 *
 * The legacy numeric `size`/`side`/`timestamp` fields below are kept optional for
 * back-compat with other call sites, but normalize raw fills (see
 * `src/utils/trader-profile.ts` → normalizeFills) before relying on them.
 */
export interface TradeFill {
  tradeId?: string;
  orderId?: string;
  symbol?: string;
  market?: string;
  pair?: string;
  // Authoritative live API fields:
  baseLotsDelta?: number;
  virtualQuoteLotsDelta?: number;
  realizedPnl?: number;
  fees?: number;
  liquidity?: string;
  // Legacy / normalized fields (may be absent on raw upstream fills):
  side?: string;
  size?: number;
  price?: number;
  fee?: number;
  /** Raw upstream timestamp is an ISO 8601 string; normalized to unix seconds. */
  timestamp?: number | string;
  marketMaker?: boolean;
}

export interface OrderHistoryEntry {
  orderId?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  size?: number;
  filledSize?: number;
  price?: number;
  status?: string; // "filled" | "cancelled" | "expired" | "partial"
  createdAt?: number;
  updatedAt?: number;
}

export interface TraderFundingEntry {
  symbol?: string;
  fundingRate?: number;
  payment?: number;
  positionSize?: number;
  side?: string;
  timestamp?: number;
}

// ─── Liquidation risk ────────────────────────────────────────────────────────

// Shared tier colors — keep in sync with the inline PnL / side colors used
// throughout the trading UI.
export const LIQ_RISK_HEALTHY = '#4ADE80'; // green  — >= 15% distance
export const LIQ_RISK_CAUTION = '#FBBF24'; // amber  — 5–15% distance
export const LIQ_RISK_DANGER = '#FF5252';  // red    — < 5% distance

export interface LiqRisk {
  /** Distance from mark to liquidation as a % of mark, or null if not computable. */
  distancePct: number | null;
  /** Tier color for the distance (green/amber/red). Defaults to healthy when no data. */
  color: string;
  /** Risk tier label. */
  tier: 'healthy' | 'caution' | 'danger';
}

/**
 * Single source of truth for liquidation-distance % and its color tier.
 * Used by both the positions-row liq-distance bar and the inline close
 * confirmation button so they never drift apart.
 *
 * Risk tiers: > 15% healthy (green), 5–15% caution (amber), < 5% danger (red).
 */
export function getLiqRisk({
  effectiveMark,
  liq,
}: {
  effectiveMark?: number | null;
  liq?: number | null;
}): LiqRisk {
  const valid =
    effectiveMark != null && isFinite(effectiveMark) && effectiveMark > 0 &&
    liq != null && isFinite(liq) && liq > 0;
  const distancePct = valid
    ? Math.abs(effectiveMark! - liq!) / effectiveMark! * 100
    : null;
  let color = LIQ_RISK_HEALTHY;
  let tier: LiqRisk['tier'] = 'healthy';
  if (distancePct != null) {
    if (distancePct < 5) {
      color = LIQ_RISK_DANGER;
      tier = 'danger';
    } else if (distancePct < 15) {
      color = LIQ_RISK_CAUTION;
      tier = 'caution';
    }
  }
  return { distancePct, color, tier };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatUsd(v: number | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPrice(p: number | string | undefined | null): string {
  if (p == null) return '—';
  const n = typeof p === 'number' ? p : Number(p);
  if (!isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function formatSize(v: number | string | undefined | null, digits = 4): string {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function formatFunding(r: number | undefined): string {
  if (r == null) return '—';
  const pct = r * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

export function formatTime(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
