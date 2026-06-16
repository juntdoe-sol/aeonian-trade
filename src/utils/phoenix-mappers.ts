/**
 * Shared Phoenix API types and mapping helpers.
 *
 * The /api/phoenix/trader/:authority endpoint selects a PRIMARY sub-account from
 * Phoenix's /trader/{authority}/state for all scalar/balance fields (collateral,
 * PnL, margin, etc.), but its `positions` array is the UNION of positions across
 * ALL sub-account entries — each position carrying its owning entry's
 * `subaccountIndex` so isolated positions (index > 0) render alongside cross
 * (index 0). The overall shape matches TraderData below.
 *
 * Both PortfolioPage and TradePage import from here to stay in sync.
 */

import type { TraderOrder, TraderPosition } from '@/components/trading/types';

// ─── Raw API shapes ───────────────────────────────────────────────────────────

export interface TokenAmount {
  value: number;
  decimals: number;
  ui: string;
}

export interface RisePosition {
  symbol: string;
  positionSize: TokenAmount;
  entryPrice: TokenAmount;
  unrealizedPnl: TokenAmount;
  liquidationPrice: TokenAmount;
  positionValue: TokenAmount;
  initialMargin: TokenAmount;
  maintenanceMargin?: TokenAmount;
  takeProfitPrice?: TokenAmount | null;
  stopLossPrice?: TokenAmount | null;
  markPrice?: TokenAmount;
  [key: string]: unknown;
}

export interface RiseLimitOrder {
  price: TokenAmount;
  side: string;
  orderSequenceNumber: string;
  initialTradeSize: TokenAmount;
  tradeSizeRemaining: TokenAmount;
  marginRequirement: TokenAmount;
  marginFactor: TokenAmount;
  isReduceOnly: boolean;
  [key: string]: unknown;
}

/**
 * Full TraderData shape returned by /api/phoenix/trader/:authority.
 * Scalar fields come from the selected primary sub-account; `positions` is the
 * union of positions across all sub-accounts (each tagged with subaccountIndex).
 * Fields that may not exist on all accounts are marked optional.
 */
export interface TraderData {
  // Core balances
  collateralBalance: TokenAmount;
  effectiveCollateral: TokenAmount;
  effectiveCollateralForWithdrawals: TokenAmount;
  availableCash?: TokenAmount;

  // Positions & orders
  positions: RisePosition[];
  limitOrders: Record<string, RiseLimitOrder[]>;

  // PnL
  unrealizedPnl: TokenAmount;
  realizedPnl?: TokenAmount;
  portfolioValue: TokenAmount;

  // Fees & funding
  totalFees?: TokenAmount;
  totalFunding?: TokenAmount;

  // Margin
  crossInitialMargin?: TokenAmount;
  crossMaintenanceMargin?: TokenAmount;

  // Lifetime stats
  totalDeposited?: TokenAmount;
  totalWithdrawn?: TokenAmount;
  totalVolume?: TokenAmount;
  totalTraded?: TokenAmount;

  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the numeric USD/USDC value from a TokenAmount (reads `.ui` string). */
export function toNumber(t: TokenAmount | null | undefined): number {
  if (!t) return 0;
  const parsed = parseFloat(t.ui);
  return isNaN(parsed) ? 0 : parsed;
}

/** Convert a RisePosition to the flat TraderPosition shape used by UI components. */
export function mapPosition(pos: RisePosition): TraderPosition {
  const sizeVal = toNumber(pos.positionSize);
  const side = sizeVal >= 0 ? 'long' : 'short';
  const entryPrice = toNumber(pos.entryPrice);
  // markPrice is optional on RisePosition and is omitted for the newly-surfaced
  // isolated-subaccount positions. Fall back to entryPrice when it's absent/zero —
  // consistent with computeTotalExposure / computePortfolioBreakdown below — so the
  // UI never renders an empty Mark Price.
  const mark = pos.markPrice ? toNumber(pos.markPrice) : 0;
  // Surface any active stop-loss / take-profit trigger levels so the chart can
  // draw them alongside Entry / Liq. Both are optional TokenAmounts on the raw
  // position and are 0 / null when no trigger is set.
  const sl = pos.stopLossPrice ? toNumber(pos.stopLossPrice) : 0;
  const tp = pos.takeProfitPrice ? toNumber(pos.takeProfitPrice) : 0;
  return {
    symbol: pos.symbol,
    side,
    size: Math.abs(sizeVal),
    entryPrice,
    markPrice: mark > 0 ? mark : entryPrice,
    pnl: toNumber(pos.unrealizedPnl),
    liquidationPrice: toNumber(pos.liquidationPrice),
    subaccountIndex: typeof pos.subaccountIndex === 'number' ? pos.subaccountIndex : undefined,
    stopLossPrice: sl > 0 ? sl : undefined,
    takeProfitPrice: tp > 0 ? tp : undefined,
  };
}

/** Flatten limitOrders Record<Symbol, LimitOrder[]> into TraderOrder[]. */
export function flattenLimitOrders(
  limitOrders: Record<string, RiseLimitOrder[]> | null | undefined,
): TraderOrder[] {
  if (!limitOrders || typeof limitOrders !== 'object') return [];
  const result: TraderOrder[] = [];
  for (const [symbol, orders] of Object.entries(limitOrders)) {
    if (!Array.isArray(orders)) continue;
    for (const order of orders) {
      result.push({
        orderId: order.orderSequenceNumber,
        symbol,
        side: order.side,
        orderType: order.isReduceOnly ? 'reduce_only' : 'limit',
        size: toNumber(order.tradeSizeRemaining),
        price: toNumber(order.price),
      });
    }
  }
  return result;
}

/**
 * Compute total exposure: sum of |positionValue| across all positions.
 * Uses positionValue directly (which already accounts for mark price × size),
 * or falls back to |size × markPrice|, or |size × entryPrice| if markPrice = 0.
 */
export function computeTotalExposure(positions: RisePosition[]): number {
  return positions.reduce((sum, pos) => {
    const posValue = toNumber(pos.positionValue);
    if (posValue > 0) return sum + posValue;
    const size = Math.abs(toNumber(pos.positionSize));
    const mark = pos.markPrice ? toNumber(pos.markPrice) : 0;
    const price = mark > 0 ? mark : toNumber(pos.entryPrice);
    return sum + size * price;
  }, 0);
}

/** Compute total unrealized PnL across all positions. */
export function computeTotalUnrealizedPnl(positions: RisePosition[]): number {
  return positions.reduce((sum, pos) => sum + toNumber(pos.unrealizedPnl), 0);
}

/** Compute unrealized PnL per subaccount index (0 = cross margin). */
export function computeSubaccountUnrealizedPnls(positions: RisePosition[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const pos of positions) {
    const idx = typeof pos.subaccountIndex === 'number' ? pos.subaccountIndex : 0;
    const pnl = toNumber(pos.unrealizedPnl);
    map.set(idx, (map.get(idx) ?? 0) + pnl);
  }
  return map;
}

// ─── Portfolio Breakdown helpers ─────────────────────────────────────────────

export interface BreakdownSlice {
  symbol: string;
  side: 'long' | 'short';
  exposure: number;
  pct: number;
}

export interface PortfolioBreakdown {
  longTotal: number;
  shortTotal: number;
  totalExposure: number;
  longPct: number;
  shortPct: number;
  slices: BreakdownSlice[];
}

/**
 * Build the breakdown data for the donut chart and per-token list.
 * Groups positions by symbol+side, computes exposure and % of total.
 */
export function computePortfolioBreakdown(positions: RisePosition[]): PortfolioBreakdown {
  const sliceMap = new Map<string, BreakdownSlice>();

  for (const pos of positions) {
    const sizeVal = toNumber(pos.positionSize);
    const side: 'long' | 'short' = sizeVal >= 0 ? 'long' : 'short';
    const symbol = (pos.symbol ?? '').replace(/-PERP$/i, '');

    // Prefer positionValue; fallback to size × markPrice or entryPrice
    const posValue = toNumber(pos.positionValue);
    const size = Math.abs(sizeVal);
    const mark = pos.markPrice ? toNumber(pos.markPrice) : 0;
    const price = mark > 0 ? mark : toNumber(pos.entryPrice);
    const exposure = posValue > 0 ? posValue : size * price;

    const key = `${symbol}-${side}`;
    const existing = sliceMap.get(key);
    if (existing) {
      existing.exposure += exposure;
    } else {
      sliceMap.set(key, { symbol, side, exposure, pct: 0 });
    }
  }

  const slices = Array.from(sliceMap.values());
  const totalExposure = slices.reduce((s, sl) => s + sl.exposure, 0);
  const longTotal = slices.filter(s => s.side === 'long').reduce((s, sl) => s + sl.exposure, 0);
  const shortTotal = slices.filter(s => s.side === 'short').reduce((s, sl) => s + sl.exposure, 0);

  // Assign percentage of total for each slice
  for (const sl of slices) {
    sl.pct = totalExposure > 0 ? (sl.exposure / totalExposure) * 100 : 0;
  }

  return {
    longTotal,
    shortTotal,
    totalExposure,
    longPct: totalExposure > 0 ? (longTotal / totalExposure) * 100 : 0,
    shortPct: totalExposure > 0 ? (shortTotal / totalExposure) * 100 : 0,
    slices: slices.sort((a, b) => b.exposure - a.exposure),
  };
}
