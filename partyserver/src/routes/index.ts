/**
 * API Routes - Register all routes here.
 *
 * Two things to do when adding a route:
 * 1. Register the handler with app.get/post/put/delete/patch
 * 2. Add an entry to routeSpec[] so the API spec is generated for the platform
 *
 * For protected routes, use validatePoofAuth:
 *   import { validatePoofAuth } from '../lib/poof-auth.js';
 *   const { walletAddress } = await validatePoofAuth(c);
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import { ApiErrors, sendSuccess } from '../lib/api-response.js';
import { oauthCallbackHandler } from './oauth-callback.js';
import { getSocialLinkHandler, deleteSocialLinkHandler } from './social-links.js';
import { validatePoofAuth } from '../lib/poof-auth.js';
import { PHOENIX_API_BASE_URL, SOL_PERP_MARKET } from '../constants.js';
import { parseFillTimestampSec } from '../utils/parse-fill-timestamp.js';
import { getAllSocialClaims, getSocialClaims, setSocialClaims, updateSocialClaims } from '../collections/socialClaims.js';
import type { SocialClaimsRequest } from '../collections/socialClaims.js';
import {
  getPendingSocialClaims,
  setPendingSocialClaims,
  updatePendingSocialClaims,
  getAllPendingSocialClaims,
} from '../collections/pendingSocialClaims.js';
import { getAllPhoenixOrder } from '../collections/phoenixOrder.js';
import { setPhoenixTradeRecord, getPhoenixTradeRecord, getManyPhoenixTradeRecord } from '../collections/phoenixTradeRecord.js';
import { getAllPhoenixIsoTrade } from '../collections/phoenixIsoTrade.js';
import { setPhoenixWins } from '../collections/phoenixWins.js';
import { notifyFollowers } from '../utils/notify-followers.js';
import { notifyNewFollower } from '../utils/notify-new-follower.js';
import { getAllPhoenixTrader, countPhoenixTrader } from '../collections/phoenixTrader.js';
import { getAllUserPoints, buildUserPoints, buildUpdateUserPoints } from '../collections/userPoints.js';
import { getAllPointsActivity, buildPointsActivity } from '../collections/pointsActivity.js';
import { setMany, Address, Time } from '../db-client.js';
import {
  getPromotionClaims,
  setPromotionClaims,
  updatePromotionClaims,
} from '../collections/promotionClaims.js';
import {
  getPromotionLinkRegistry,
  setPromotionLinkRegistry,
  deletePromotionLinkRegistry,
} from '../collections/promotionLinkRegistry.js';
import { normalizePromotionLink, hashNormalizedLink } from '../utils/promotion-link.js';
import { getManyMonthlyRewardDeposit } from '../collections/monthlyRewardDeposit.js';
import { notifyPotOpen } from '../utils/notify-pot-open.js';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Module-level in-memory cache for markets-overview (20s TTL)
let marketsOverviewCache: { data: unknown; expiresAt: number } | null = null;

// Module-level in-memory cache for total 24h volume across all Phoenix markets (60s TTL)
let totalVolumeCache: { totalVolume24h: number; expiresAt: number } | null = null;

// Module-level in-memory cache for phoenix global stats (5 min TTL)
let phoenixRankingCache: { data: unknown; expiresAt: number } | null = null;

// Module-level in-memory cache for last known non-zero trader state (30s TTL)
// Guards against load-balanced upstream returning stale zeros for funded accounts.
const traderNonZeroCache = new Map<string, { data: unknown; ts: number }>();
const TRADER_CACHE_TTL_MS = 120_000;

// Module-level last-known-good candles cache keyed by "symbol:timeframe"
// Guards against load-balanced upstream returning all-zero candles.
const candlesNonZeroCache = new Map<string, { data: unknown; ts: number }>();
const CANDLES_CACHE_TTL_MS = 60_000;

// Module-level in-memory cache for trading news RSS feed (10 min TTL)
let tradingNewsCache: { items: TradingNewsItem[]; expiresAt: number } | null = null;
const TRADING_NEWS_TTL_MS = 600_000;

interface TradingNewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

// Module-level last-known-good cache for specific subaccount states.
// Cache key = "authority:index". Same TTL as the authority-level cache.
const subaccountNonZeroCache = new Map<string, { data: unknown; ts: number }>();

// Detect a stale-zero read (deposit exists but balance is suspiciously zero).
// Shared by both /trader/:authority and /trader/:authority/subaccount/:index.
//
// Two cases are treated as suspicious:
//   1. Returning funded account: lastDepositSlot > 0, zero collateral, no positions
//      (Phoenix load-balanced upstream intermittently returns stale zeros for funded accounts)
//   2. Brand-new subaccount: lastDepositSlot is absent/null/zero, zero collateral, no positions
//      (freshly-funded subaccounts haven't been indexed yet; a pending deposit looks like an
//       empty account — treat this as possibly-pending rather than definitely-unfunded)
// Case 2 is intentionally conservative: it only activates when collateralBalance is explicitly
// present in the response (the field exists but is zero), so a genuine 404/empty response that
// never populated the field at all will not be misclassified.
const isSuspiciousZero = (trader: unknown): boolean => {
  if (!trader || typeof trader !== 'object') return false;
  const t = trader as Record<string, unknown>;
  const collateral = t.collateralBalance as Record<string, unknown> | undefined;
  const effective = t.effectiveCollateral as Record<string, unknown> | undefined;
  const positions = t.positions;
  const lastDepositSlot = t.lastDepositSlot;
  const collateralZero = collateral && (collateral.value === 0 || collateral.value === '0');
  const effectiveZero = effective && (effective.value === 0 || effective.value === '0');
  const noPositions = !Array.isArray(positions) || positions.length === 0;
  // Case 1: known depositor with stale zero (original protection)
  const hasDeposit = typeof lastDepositSlot === 'number' ? lastDepositSlot > 0
    : typeof lastDepositSlot === 'string' ? Number(lastDepositSlot) > 0
    : false;
  if (collateralZero && effectiveZero && hasDeposit && noPositions) return true;
  // Case 2: brand-new subaccount — collateralBalance field present but zero, no deposit slot yet
  // Only applies when both collateralBalance AND effectiveCollateral fields are present in the
  // response (indicating a real subaccount object was returned, not a missing-data placeholder).
  const depositSlotAbsent = lastDepositSlot === undefined || lastDepositSlot === null
    || lastDepositSlot === 0 || lastDepositSlot === '0';
  const collateralFieldPresent = collateral !== undefined;
  const effectiveFieldPresent = effective !== undefined;
  if (collateralZero && effectiveZero && depositSlotAbsent && noPositions
      && collateralFieldPresent && effectiveFieldPresent) return true;
  return false;
};

// Detect a clearly non-zero response worth caching.
// Shared by both /trader/:authority and /trader/:authority/subaccount/:index.
const isNonZeroTrader = (trader: unknown): boolean => {
  if (!trader || typeof trader !== 'object') return false;
  const t = trader as Record<string, unknown>;
  const collateral = t.collateralBalance as Record<string, unknown> | undefined;
  const positions = t.positions;
  const hasPositions = Array.isArray(positions) && positions.length > 0;
  const hasBalance = collateral && collateral.value !== 0 && collateral.value !== '0' && collateral.value !== undefined;
  return !!(hasBalance || hasPositions);
};

// Phoenix uses `authority` (not `userPublicKey`) and requires `code` for plain activate.
// `code` is required — Phoenix's private beta always gates activation on an access code.
// Without a valid code the API returns success but the account remains inactive.
const InviteActivateSchema = z.object({
  authority: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid Solana address'),
  code: z.string().min(1).max(128),
});

// activate-with-referral uses `authority` + `referral_code` (snake_case per Phoenix API)
const InviteActivateWithReferralSchema = z.object({
  authority: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid Solana address'),
  referral_code: z.string().min(1).max(128),
});

// Unified activate-code: accepts authority + code, tries referral first, falls back to plain activate
const InviteActivateCodeSchema = z.object({
  authority: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid Solana address'),
  code: z.string().min(1).max(128),
});

/**
 * Route spec for API documentation/display.
 * Keep this in sync with the actual route registrations below.
 */
export interface RouteSpec {
  method: string;
  path: string;
  description: string;
  auth: boolean;
}

export const routeSpec: RouteSpec[] = [
  { method: 'GET', path: '/health', description: 'Health check', auth: false },
  // Phoenix proxy routes
  { method: 'GET', path: '/api/phoenix/snapshot', description: 'Phoenix exchange snapshot (all markets)', auth: false },
  { method: 'GET', path: '/api/phoenix/markets-overview', description: 'All markets with live prices and 24h change in one call', auth: false },
  { method: 'GET', path: '/api/phoenix/total-volume', description: 'Total 24h trading volume across all active Phoenix markets (server-aggregated from candles, cached 60s)', auth: false },
  { method: 'GET', path: '/api/phoenix/candles', description: 'Phoenix candles (live prices) for a symbol', auth: false },
  { method: 'GET', path: '/api/phoenix/market/:symbol', description: 'Phoenix market details by symbol', auth: false },
  { method: 'GET', path: '/api/phoenix/orderbook/:symbol', description: 'Phoenix orderbook for a symbol', auth: false },
  { method: 'GET', path: '/api/phoenix/trader/:authority', description: 'Phoenix trader info by authority', auth: false },
  { method: 'GET', path: '/api/phoenix/trader/:authority/subaccount/:index', description: 'Phoenix trader info for a specific subaccount index', auth: false },
  { method: 'GET', path: '/api/phoenix/funding/:symbol', description: 'Phoenix funding history for a symbol', auth: false },
  { method: 'GET', path: '/api/phoenix/trader/:authority/trades-history', description: 'Phoenix trader trade/fill history', auth: false },
  { method: 'GET', path: '/api/phoenix/trader/:authority/order-history', description: 'Phoenix trader order history (filled/cancelled/expired)', auth: false },
  { method: 'GET', path: '/api/phoenix/trader/:authority/funding-history', description: 'Phoenix trader funding payment history', auth: false },
  { method: 'POST', path: '/api/phoenix/invite/activate', description: 'Activate Phoenix invite code', auth: true },
  { method: 'POST', path: '/api/phoenix/invite/activate-with-referral', description: 'Activate Phoenix invite with referral', auth: true },
  { method: 'POST', path: '/api/phoenix/invite/activate-code', description: 'Unified code activation: tries referral first, falls back to plain invite', auth: true },
  // Rankings routes
  { method: 'GET', path: '/api/rankings/phoenix', description: 'Solana Perps ranking for Phoenix protocol', auth: false },
  // Phoenix trade record route (verify + record on-chain order, award points)
  { method: 'POST', path: '/api/phoenix/record-trade', description: 'Verify on-chain Phoenix order tx and record trade for points (backend-signed write)', auth: true },
  { method: 'POST', path: '/api/phoenix/record-follow', description: 'Notify a trader that they gained a new follower (backend-signed notification write)', auth: true },
  // Admin backfill routes
  { method: 'POST', path: '/api/admin/backfill-points', description: 'Backfill missing userPoints and pointsActivity records from historical claims and trades', auth: true },
  { method: 'POST', path: '/api/admin/backfill-trader-record', description: 'Admin: create a phoenixTradeRecord for a wallet that traded but got no points (e.g. Privy/social wallet). Triggers offchain hook to award points.', auth: true },
  { method: 'POST', path: '/api/admin/backfill-trade-records', description: 'Admin: retroactively award trading points by fetching on-chain fill history from Phoenix API and writing missing phoenixTradeRecord docs. Dry-run by default.', auth: true },
  // Monthly prize pot announce (admin-only; fans out a pot-open notification to active traders on the FIRST deposit only)
  { method: 'POST', path: '/api/monthly-pot/announce', description: 'Admin: on a new month pot\'s FIRST deposit, fan out a "prize pot is live" notification to active traders. Idempotent no-op for subsequent deposits.', auth: true },
  // Promotion claim route (vault-signed write + duplicate-link / cooldown enforcement)
  { method: 'POST', path: '/api/promotion/submit', description: 'Submit/resubmit a promotion link (backend-signed write; enforces 24h cooldown + cross-wallet duplicate-link guard via promotionLinkRegistry)', auth: true },
  // Social claim routes
  { method: 'POST', path: '/api/social/claim/twitter', description: 'Claim Twitter follow reward', auth: true },
  { method: 'POST', path: '/api/social/claim/telegram', description: 'Claim Telegram join reward', auth: true },
  // Admin analytics route
  { method: 'GET', path: '/api/admin/analytics', description: 'Admin performance analytics (users, traders, volume) for a given time range', auth: true },
  // Admin social claim routes
  { method: 'POST', path: '/api/admin/social/approve', description: 'Admin: approve pending social claim and award points', auth: true },
  { method: 'GET', path: '/api/admin/social/pending', description: 'Admin: list pending social claims', auth: true },
  // Image proxy — fetches Tarobase public S3 assets server-side to bypass CORS on custom domains
  { method: 'GET', path: '/api/image-proxy', description: 'Proxy a Tarobase public S3 image to avoid CORS on custom domains', auth: false },
  // Token lookup — on-chain decimals + Jupiter metadata for a given SPL mint
  { method: 'GET', path: '/api/token/lookup', description: 'Look up SPL token metadata (decimals, symbol, name, logo) by mint address', auth: false },
  // OAuth routes
  { method: 'GET', path: '/api/oauth/callback', description: 'OAuth callback', auth: false },
  { method: 'GET', path: '/api/social-links/:provider', description: 'Get social link', auth: true },
  { method: 'DELETE', path: '/api/social-links/:provider', description: 'Unlink social account', auth: true },
  // Trading news RSS feed
  { method: 'GET', path: '/api/news/trading', description: 'General trading/crypto news from free RSS feeds, cached 10 minutes', auth: false },
];

export function registerRoutes(app: Hono): void {
  // Health check
  app.get('/health', (c) => sendSuccess(c, { status: 'ok', timestamp: Date.now() }));

  // ── Phoenix Proxy Routes ─────────────────────────────────────────────────

  // Exchange snapshot (all active markets — sourced from authoritative config endpoint)
  app.get('/api/phoenix/snapshot', async (c) => {
    try {
      const res = await fetch('https://public-api.phoenix.trade/exchange');
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const raw = (await res.json()) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown>)?.markets)
          ? (raw as Record<string, unknown>).markets
          : [];
      // Filter to only actively tradeable markets
      const active = (list as Array<Record<string, unknown>>).filter(
        (m) => m.marketStatus === 'active'
      );
      return sendSuccess(c, { markets: active });
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Markets overview — layered price source: OKX batch → Pyth batch → Phoenix candles fallback
  app.get('/api/phoenix/markets-overview', async (c) => {
    if (marketsOverviewCache && Date.now() < marketsOverviewCache.expiresAt) {
      return sendSuccess(c, marketsOverviewCache.data);
    }
    try {
      const res = await fetch('https://public-api.phoenix.trade/exchange');
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const snapshotData = (await res.json()) as unknown;

      const rawList = Array.isArray(snapshotData)
        ? snapshotData
        : Array.isArray((snapshotData as Record<string, unknown>)?.markets)
        ? (snapshotData as Record<string, unknown>).markets
        : [];

      // Filter to only actively tradeable markets
      const list = (rawList as Array<Record<string, unknown>>).filter(
        (m) => m.marketStatus === 'active'
      );

      if (!Array.isArray(list) || list.length === 0) {
        return sendSuccess(c, { markets: [] });
      }

      interface LeverageTier {
        maxLeverage?: number;
        [key: string]: unknown;
      }

      interface SnapshotMarket {
        symbol: string;
        marketPubkey?: string;
        baseLotsDecimals?: number;
        openInterest?: number;
        volume24h?: number;
        leverageTiers?: LeverageTier[];
        isolatedOnly?: boolean;
        [key: string]: unknown;
      }

      const markets = list as SnapshotMarket[];

      // ── LAYER 1: OKX batch (one request for all crypto markets) ──────────
      interface OkxTicker {
        instId: string;
        last: string;
        open24h: string;
        high24h: string;
        low24h: string;
        vol24h: string;
      }
      interface OkxTickerPrice {
        last: number;
        open24h: number;
        high24h: number;
        low24h: number;
        vol24h: number;
        change24h: number;
      }
      const okxMap = new Map<string, OkxTickerPrice>();
      try {
        const okxRes = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT', {
          headers: { 'Accept': 'application/json' },
        });
        if (okxRes.ok) {
          const okxBody = (await okxRes.json()) as { code: string; data?: OkxTicker[] };
          if (okxBody.code === '0' && Array.isArray(okxBody.data)) {
            for (const ticker of okxBody.data) {
              const last = parseFloat(ticker.last);
              const open24h = parseFloat(ticker.open24h);
              if (isNaN(last) || isNaN(open24h) || open24h === 0) continue;
              okxMap.set(ticker.instId, {
                last,
                open24h,
                high24h: parseFloat(ticker.high24h),
                low24h: parseFloat(ticker.low24h),
                vol24h: parseFloat(ticker.vol24h),
                change24h: ((last - open24h) / open24h) * 100,
              });
            }
          }
        }
      } catch {
        // OKX unavailable — fall through to Pyth + candles for all markets
      }

      // ── LAYER 2: Pyth Hermes batch (commodities + equities + crypto) ─────
      // Feed IDs verified 2026-06-29.
      // WTIOIL uses front-month June 2026 (WTIM6) with July 2026 (WTIN6) as secondary.
      // COPPER (Metal.XCU/USD) feed consistently returns price=0 — removed; falls to candle.
      // Equity feeds (Pyth Pro) return 24/7 prices based on last close when markets are shut.
      // SKR, SPCX: no Pyth feed found — fall through to candle.
      const PYTH_FEEDS: Record<string, { ids: string[] }> = {
        // ── Commodities ──────────────────────────────────────────────────────
        GOLD:    { ids: ['765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2'] },
        SILVER:  { ids: ['f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e'] },
        WTIOIL: {
          ids: [
            '6a60b0d1ea6809b47dbe599f24a71c8bda335aa5c77e503e7260cde5ba2f4694', // WTIM6 (June 2026)
            'ce4c15100156d27c8bdd044d9804294e7bc0944dbb5b2b82a61a7aa85b6b3a5e', // WTIN6 (July 2026)
          ],
        },
        // ── US Equities (Pyth Pro) ────────────────────────────────────────────
        AAPL:   { ids: ['49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688'] },
        MSFT:   { ids: ['d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1'] },
        TSLA:   { ids: ['16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1'] },
        NVDA:   { ids: ['b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593'] },
        GOOGL:  { ids: ['5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6'] },
        AMZN:   { ids: ['b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a'] },
        META:   { ids: ['78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe'] },
        AMD:    { ids: ['3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e'] },
        INTC:   { ids: ['c1751e085ee292b8b3b9dd122a135614485a201c35dfc653553f0e28c1baf3ff'] },
        MU:     { ids: ['152244dc24665ca7dd3f257b8f442dc449b6346f48235b7b229268cb770dda2d'] },
        SNDK:   { ids: ['c86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76'] },
        CRWV:   { ids: ['2a78b78189d6d6eff30a825e4698fd14a0b1ca659bb0079bb7e80521c0e8c75d'] },
        // ── Crypto (not on OKX spot or falling through) ──────────────────────
        TAO:      { ids: ['410f41de235f2db824e562ea7ab2d3d3d4ff048316c61d629c0b93f58584e1af'] },
        FARTCOIN: { ids: ['58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608'] },
        VVV:      { ids: ['5ece7483ae221e3645ec0f9b5c6671ac830cb85471744df5d8e7deae152e31a2'] },
      };

      interface PythPrice {
        price: number; // already decoded (price * 10^expo)
      }
      const pythMap = new Map<string, PythPrice>();

      // Collect all feed IDs needed for markets that OKX won't cover
      const allPythIds = Object.values(PYTH_FEEDS).flatMap((f) => f.ids);
      if (allPythIds.length > 0) {
        try {
          const pythUrl = new URL('https://hermes.pyth.network/v2/updates/price/latest');
          for (const id of allPythIds) {
            pythUrl.searchParams.append('ids[]', id);
          }
          const pythRes = await fetch(pythUrl.toString(), {
            headers: { 'Accept': 'application/json' },
          });
          if (pythRes.ok) {
            const pythBody = (await pythRes.json()) as {
              parsed?: Array<{
                id: string;
                price: { price: string; expo: number };
              }>;
            };
            if (Array.isArray(pythBody.parsed)) {
              for (const entry of pythBody.parsed) {
                const rawPrice = parseFloat(entry.price.price);
                const expo = entry.price.expo;
                if (!isNaN(rawPrice) && rawPrice !== 0) {
                  const decoded = rawPrice * Math.pow(10, expo);
                  // Skip feeds returning zero price (stale/inactive feed)
                  if (decoded <= 0) continue;
                  // Map by feed ID (normalized to lowercase for lookup)
                  const normalId = entry.id.toLowerCase().replace(/^0x/, '');
                  // Find the symbol this ID belongs to
                  for (const [symbol, feed] of Object.entries(PYTH_FEEDS)) {
                    const matchedId = feed.ids.find(
                      (id) => id.toLowerCase() === normalId
                    );
                    if (matchedId && !pythMap.has(symbol)) {
                      // Only store the first (primary) successful feed per symbol
                      pythMap.set(symbol, { price: decoded });
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Pyth unavailable — fall through to candle fallback for commodities
        }
      }

      // ── LAYER 3: Phoenix candle fallback (for markets not covered above) ──
      // Helper to fetch current price from Phoenix candle endpoint
      async function fetchCandlePrice(bareSymbol: string): Promise<{
        markPrice?: number;
        lastPrice?: number;
        change24h?: number;
      }> {
        const [minRes, dayRes] = await Promise.allSettled([
          fetch(
            `${PHOENIX_API_BASE_URL}/candles?symbol=${encodeURIComponent(bareSymbol)}&timeframe=1m&limit=1`
          ),
          fetch(
            `${PHOENIX_API_BASE_URL}/candles?symbol=${encodeURIComponent(bareSymbol)}&timeframe=1d&limit=2`
          ),
        ]);

        let markPrice: number | undefined;
        let lastPrice: number | undefined;
        let change24h: number | undefined;

        if (minRes.status === 'fulfilled' && minRes.value.ok) {
          try {
            const raw = (await minRes.value.json()) as unknown;
            const arr = Array.isArray(raw)
              ? raw
              : ((raw as { data?: unknown[] })?.data ?? []);
            if (arr.length > 0) {
              const candle = arr[arr.length - 1] as { close?: number; markClose?: number };
              if (typeof candle.markClose === 'number' && candle.markClose > 0) markPrice = candle.markClose;
              if (typeof candle.close === 'number' && candle.close > 0) lastPrice = candle.close;
            }
          } catch {
            // ignore
          }
        }

        if (dayRes.status === 'fulfilled' && dayRes.value.ok) {
          try {
            const raw = (await dayRes.value.json()) as unknown;
            const arr = Array.isArray(raw)
              ? raw
              : ((raw as { data?: unknown[] })?.data ?? []);
            const refCandle = arr.length > 0 ? (arr[0] as { close?: number }) : null;
            const refPrice = refCandle?.close;
            const currentPrice = markPrice ?? lastPrice;
            if (refPrice != null && refPrice > 0 && currentPrice != null) {
              change24h = ((currentPrice - refPrice) / refPrice) * 100;
            }
          } catch {
            // ignore
          }
        }

        return { markPrice, lastPrice, change24h };
      }

      // ── Resolve price for each market ─────────────────────────────────────
      const results = await Promise.all(
        markets.map(async (m) => {
          const bareSymbol = m.symbol.replace(/-PERP$/i, '').toUpperCase();

          // Derive per-market leverage cap from leverageTiers[0].maxLeverage (the highest tier)
          const rawMaxLev = m.leverageTiers?.[0]?.maxLeverage;
          const maxLeverage = rawMaxLev != null && isFinite(rawMaxLev) && rawMaxLev > 0
            ? Math.floor(rawMaxLev)
            : 1;
          const isolatedOnly = m.isolatedOnly === true;
          // Pass through marketPubkey + baseLotDecimals so the frontend can resolve
          // pubkey/decimals for markets not yet in its static registry
          const marketPubkey = typeof m.marketPubkey === 'string' ? m.marketPubkey : undefined;
          const baseLotDecimals = (m.baseLotsDecimals !== undefined && m.baseLotsDecimals !== null)
            ? (m.baseLotsDecimals as number)
            : undefined;

          // Shared market metadata appended to every price response
          const marketMeta = { maxLeverage, isolatedOnly, marketPubkey, baseLotDecimals };

          // Layer 1: OKX
          const okxTicker = okxMap.get(`${bareSymbol}-USDT`);
          if (okxTicker) {
            return {
              symbol: m.symbol,
              markPrice: okxTicker.last,
              lastPrice: okxTicker.last,
              change24h: okxTicker.change24h,
              openInterest: typeof m.openInterest === 'number' ? m.openInterest : undefined,
              volume24h: typeof m.volume24h === 'number' ? m.volume24h : undefined,
              ...marketMeta,
            };
          }

          // Layer 2: Pyth (commodities)
          const pythPrice = pythMap.get(bareSymbol);
          if (pythPrice) {
            return {
              symbol: m.symbol,
              markPrice: pythPrice.price,
              lastPrice: pythPrice.price,
              change24h: undefined, // Pyth latest doesn't give a clean 24h-open
              openInterest: typeof m.openInterest === 'number' ? m.openInterest : undefined,
              volume24h: typeof m.volume24h === 'number' ? m.volume24h : undefined,
              ...marketMeta,
            };
          }

          // Layer 3: Phoenix candle fallback
          const candle = await fetchCandlePrice(bareSymbol);
          return {
            symbol: m.symbol,
            markPrice: candle.markPrice,
            lastPrice: candle.lastPrice,
            change24h: candle.change24h,
            openInterest: typeof m.openInterest === 'number' ? m.openInterest : undefined,
            volume24h: typeof m.volume24h === 'number' ? m.volume24h : undefined,
            ...marketMeta,
          };
        })
      );

      const result = { markets: results };
      marketsOverviewCache = { data: result, expiresAt: Date.now() + 20_000 };
      return sendSuccess(c, result);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Total 24h volume — server-aggregated sum of volumeQuote from the most recent 1d candle
  // across all active Phoenix markets. Cached 60s so the footer never fans out client-side.
  app.get('/api/phoenix/total-volume', async (c) => {
    if (totalVolumeCache && Date.now() < totalVolumeCache.expiresAt) {
      return sendSuccess(c, { totalVolume24h: totalVolumeCache.totalVolume24h });
    }
    try {
      // Step 1: fetch the authoritative market list from Phoenix /exchange
      const exchangeRes = await fetch('https://public-api.phoenix.trade/exchange');
      if (!exchangeRes.ok) return ApiErrors.internal(c, `Phoenix exchange upstream ${exchangeRes.status}`);
      const exchangeData = (await exchangeRes.json()) as unknown;
      const rawList = Array.isArray(exchangeData)
        ? exchangeData
        : Array.isArray((exchangeData as Record<string, unknown>)?.markets)
        ? (exchangeData as Record<string, unknown>).markets
        : [];
      const activeMarkets = (rawList as Array<Record<string, unknown>>)
        .filter((m) => m.marketStatus === 'active')
        .map((m) => String(m.symbol ?? '').replace(/-PERP$/i, '').toUpperCase())
        .filter(Boolean);

      if (activeMarkets.length === 0) {
        return sendSuccess(c, { totalVolume24h: 0 });
      }

      // Step 2: fetch the most recent 1d candle for each market and sum volumeQuote.
      // Fan-out happens server-side (not client-side) so the browser fires one request.
      type Candle = { time?: number; volumeQuote?: number; volume?: number };
      const candleFetches = activeMarkets.map(async (bareSymbol): Promise<number> => {
        try {
          const url = new URL(`${PHOENIX_API_BASE_URL}/candles`);
          url.searchParams.set('symbol', bareSymbol);
          url.searchParams.set('timeframe', '1d');
          url.searchParams.set('limit', '1');
          const res = await fetch(url.toString());
          if (!res.ok) return 0;
          const raw = (await res.json()) as Candle[] | { data?: Candle[]; candles?: Candle[] };
          const arr: Candle[] = Array.isArray(raw)
            ? raw
            : (raw as { data?: Candle[] }).data ?? (raw as { candles?: Candle[] }).candles ?? [];
          if (arr.length === 0) return 0;
          // Most recent candle is the last element (candles come back oldest-first)
          const sorted = [...arr].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
          const latest = sorted[0];
          const vol = latest?.volumeQuote ?? latest?.volume;
          return typeof vol === 'number' && vol > 0 ? vol : 0;
        } catch {
          return 0;
        }
      });

      const volumes = await Promise.all(candleFetches);
      const totalVolume24h = volumes.reduce((acc, v) => acc + v, 0);

      totalVolumeCache = { totalVolume24h, expiresAt: Date.now() + 60_000 };
      return sendSuccess(c, { totalVolume24h });
    } catch {
      return ApiErrors.internal(c, 'Phoenix total-volume aggregation failed');
    }
  });

  // Candles — proxies https://perp-api.phoenix.trade/candles, forwards symbol/timeframe/limit
  // Most recent candle's close = last-trade price; markClose = mark price
  // Retries up to 2 times on transient 429/5xx before surfacing error to client.
  app.get('/api/phoenix/candles', async (c) => {
    const symbol = c.req.query('symbol');
    const timeframe = c.req.query('timeframe');
    const startTime = c.req.query('startTime');
    const endTime = c.req.query('endTime');
    const limit = c.req.query('limit');
    const enableExternalSource = c.req.query('enableExternalSource');
    if (!symbol) return ApiErrors.badRequest(c, 'symbol query param required');
    if (!timeframe) return ApiErrors.badRequest(c, 'timeframe query param required');
    // Normalize: strip trailing -PERP suffix before forwarding to upstream API
    // (e.g. "SOL-PERP" → "SOL"). The upstream only accepts bare symbols.
    const bareSymbol = symbol.replace(/-PERP$/i, '');

    const url = new URL(`${PHOENIX_API_BASE_URL}/candles`);
    url.searchParams.set('symbol', bareSymbol);
    url.searchParams.set('timeframe', timeframe);
    if (startTime) url.searchParams.set('startTime', startTime);
    if (endTime) url.searchParams.set('endTime', endTime);
    if (limit) url.searchParams.set('limit', limit);
    if (enableExternalSource) url.searchParams.set('enableExternalSource', enableExternalSource);

    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 200; // ~200ms between retries
    const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

    let lastStatus = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          // Simple exponential backoff: 200ms, 400ms
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
        const res = await fetch(url.toString());
        if (res.ok) {
          const raw = await res.json();
          // Filter out zero candles (both close and markClose are 0 = garbage upstream data)
          const arr = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as { data?: unknown[] })?.data)
              ? (raw as { data: unknown[] }).data
              : null;
          const cacheKey = `${bareSymbol}:${timeframe}`;
          if (arr !== null) {
            type RawCandle = { close?: number; markClose?: number; [key: string]: unknown };
            const filtered = (arr as RawCandle[]).filter(
              (c) => !((c.close ?? 0) === 0 && (c.markClose ?? 0) === 0)
            );
            const hasGoodLatest =
              filtered.length > 0 &&
              ((filtered[filtered.length - 1].markClose ?? 0) > 0 ||
                (filtered[filtered.length - 1].close ?? 0) > 0);
            if (filtered.length > 0 && hasGoodLatest) {
              // Cache and return the clean result (preserve original envelope shape)
              const cleanData = Array.isArray(raw) ? filtered : { ...(raw as object), data: filtered };
              candlesNonZeroCache.set(cacheKey, { data: cleanData, ts: Date.now() });
              return sendSuccess(c, cleanData);
            }
            // Filtered to empty or latest candle is zero — serve last-known-good if fresh
            const cached = candlesNonZeroCache.get(cacheKey);
            if (cached && Date.now() - cached.ts < CANDLES_CACHE_TTL_MS) {
              return sendSuccess(c, cached.data);
            }
            // No good cache — return filtered result anyway (may be empty)
            const fallbackData = Array.isArray(raw) ? filtered : { ...(raw as object), data: filtered };
            return sendSuccess(c, fallbackData);
          }
          // Non-array response (unexpected shape) — pass through verbatim
          return sendSuccess(c, raw);
        }
        lastStatus = res.status;
        // 4xx that are NOT transient (e.g. 400 bad params, 404 no data) — no point retrying
        if (!TRANSIENT_STATUSES.has(res.status)) {
          return ApiErrors.badRequest(c, `Upstream ${res.status}`);
        }
        // Transient — loop and retry
      } catch {
        // Network error — retry
        lastStatus = 0;
      }
    }

    // All retries exhausted
    return ApiErrors.internal(c, `Phoenix candles API unavailable (upstream ${lastStatus || 'network error'})`);
  });

  // Market details by symbol
  app.get('/api/phoenix/market/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    // Normalize: strip trailing -PERP suffix before forwarding to upstream API
    const bareSymbol = symbol.replace(/-PERP$/i, '');
    try {
      // Try /v1/markets/{symbol} first (fallback path per spec)
      const res = await fetch(`${PHOENIX_API_BASE_URL}/exchange/market/${encodeURIComponent(bareSymbol)}`);
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const data = await res.json();
      return sendSuccess(c, data);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Orderbook for a symbol
  app.get('/api/phoenix/orderbook/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    // Normalize: strip trailing -PERP suffix before forwarding to upstream API
    const bareSymbol = symbol.replace(/-PERP$/i, '');
    try {
      const res = await fetch(`${PHOENIX_API_BASE_URL}/v1/view/orderbook/${encodeURIComponent(bareSymbol)}`);
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const data = await res.json();
      return sendSuccess(c, data);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Trader info by authority
  // NOTE: /v1/view/trader/{pubkey} takes a trader PDA address, NOT the wallet authority.
  // The correct endpoint for looking up by wallet authority is /v1/trader/{authority}/state,
  // which returns { traders: TraderViewSchema[] }. We extract traders[0] to match the
  // shape the frontend TraderData interface expects (collateralBalance, positions, limitOrders, etc.)
  //
  // Two-layer defense against load-balanced upstream returning stale zeros:
  // 1. Retry up to 2 more times (150ms apart) when response looks like a stale zero:
  //    collateralBalance.value === 0 AND effectiveCollateral.value === 0
  //    AND lastDepositSlot > 0 AND positions is empty.
  // 2. If retries still yield suspicious zeros, serve last known non-zero from
  //    in-memory cache (30s TTL) rather than reporting $0 to the user.
  app.get('/api/phoenix/trader/:authority', async (c) => {
    const authority = c.req.param('authority');
    const validateAddr = z.string().regex(SOLANA_ADDRESS_RE).safeParse(authority);
    if (!validateAddr.success) return ApiErrors.badRequest(c, 'Invalid authority address');

    // Helper: fetch trader state once and select the PRIMARY funded sub-account.
    // A wallet authority can have multiple sub-accounts returned in non-deterministic order.
    // Selection: highest collateralBalance.value; tie-break on lowest traderSubaccountIndex.
    // This is deterministic regardless of upstream array ordering.
    const fetchTrader = async (): Promise<{ trader: unknown; status: number }> => {
      const res = await fetch(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(authority)}/state`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { trader: null, status: res.status };
      const body = await res.json() as { traders?: unknown[] };
      if (!Array.isArray(body.traders) || body.traders.length === 0) {
        return { trader: null, status: res.status };
      }
      // Pick the sub-account with the highest collateralBalance.value.
      // Tie-break: prefer lowest traderSubaccountIndex (primary account).
      type TraderEntry = Record<string, unknown>;
      const getCollateral = (t: TraderEntry): number => {
        const cb = t.collateralBalance as Record<string, unknown> | undefined;
        if (!cb) return 0;
        const v = cb.value;
        return typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0;
      };
      const getSubaccountIndex = (t: TraderEntry): number => {
        const idx = t.traderSubaccountIndex;
        return typeof idx === 'number' ? idx : typeof idx === 'string' ? parseInt(idx, 10) || 0 : 0;
      };
      const traders = body.traders as TraderEntry[];
      const selected = traders.reduce((best, curr) => {
        const bestCollateral = getCollateral(best);
        const currCollateral = getCollateral(curr);
        if (currCollateral > bestCollateral) return curr;
        if (currCollateral === bestCollateral && getSubaccountIndex(curr) < getSubaccountIndex(best)) return curr;
        return best;
      });

      // Scalar/balance fields (collateral, PnL, margin, etc.) stay sourced from the
      // selected primary entry exactly as before. ONLY the positions array is expanded:
      // build the UNION of positions[] across ALL sub-account entries so isolated
      // positions (traderSubaccountIndex > 0) — which the reduce above would otherwise
      // discard — reach the frontend. Each position is tagged with its owning entry's
      // traderSubaccountIndex so the mapper can render the "Isolated-N" badge and close
      // targets the correct sub-account. Cross-margin (index 0) positions are included
      // exactly as before, neither dropped nor duplicated.
      const aggregatedPositions: Record<string, unknown>[] = [];
      for (const entry of traders) {
        const entryIndex = getSubaccountIndex(entry);
        const positions = entry.positions;
        if (!Array.isArray(positions)) continue;
        for (const pos of positions) {
          if (!pos || typeof pos !== 'object') continue;
          aggregatedPositions.push({
            ...(pos as Record<string, unknown>),
            // Normalize to the owning entry's index (authoritative), overriding any
            // pre-existing subaccountIndex on the position object.
            subaccountIndex: entryIndex,
          });
        }
      }

      const merged: TraderEntry = {
        ...(selected as TraderEntry),
        positions: aggregatedPositions,
      };
      return { trader: merged, status: res.status };
    };

    try {
      let { trader, status } = await fetchTrader();

      if (status === 404) return ApiErrors.notFound(c, 'Trader not found');
      if (status !== 200 && status > 0) return ApiErrors.badRequest(c, `Upstream ${status}`);
      if (!trader) return ApiErrors.notFound(c, 'Trader not found');

      // Layer 1: retry on suspicious zero
      if (isSuspiciousZero(trader)) {
        for (let attempt = 0; attempt < 2; attempt++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          const retry = await fetchTrader();
          if (retry.status === 200 && retry.trader && !isSuspiciousZero(retry.trader)) {
            trader = retry.trader;
            break;
          }
        }
      }

      // Layer 2: cache non-zero; serve cached value on persistent suspicious zeros
      if (isNonZeroTrader(trader)) {
        traderNonZeroCache.set(authority, { data: trader, ts: Date.now() });
      } else if (isSuspiciousZero(trader)) {
        const cached = traderNonZeroCache.get(authority);
        if (cached && Date.now() - cached.ts < TRADER_CACHE_TTL_MS) {
          return sendSuccess(c, cached.data);
        }
      }

      return sendSuccess(c, trader);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return ApiErrors.internal(c, 'Phoenix API timed out');
      }
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Trader state for a specific subaccount index.
  // Unlike /api/phoenix/trader/:authority (which picks the highest-collateral sub-account),
  // this route finds the sub-account whose traderSubaccountIndex matches the requested index.
  // Used by the isolated-margin collateral confirmation poller in the order ticket.
  //
  // Two-layer defense against load-balanced upstream returning stale zeros (same pattern as
  // the base /trader/:authority route — see isSuspiciousZero / isNonZeroTrader module helpers):
  // 1. Retry up to 2 more times (150ms apart) when the matched sub-account looks like a stale zero.
  // 2. Serve last known non-zero from subaccountNonZeroCache (keyed "authority:index", same TTL)
  //    if retries still yield a suspicious zero.
  app.get('/api/phoenix/trader/:authority/subaccount/:index', async (c) => {
    const authority = c.req.param('authority');
    const indexParam = c.req.param('index');
    const validateAddr = z.string().regex(SOLANA_ADDRESS_RE).safeParse(authority);
    if (!validateAddr.success) return ApiErrors.badRequest(c, 'Invalid authority address');
    const targetIndex = parseInt(indexParam, 10);
    if (isNaN(targetIndex) || targetIndex < 0) return ApiErrors.badRequest(c, 'Invalid subaccount index');

    const cacheKey = `${authority}:${targetIndex}`;

    // Helper: fetch the upstream traders array and find the sub-account matching targetIndex.
    type TraderEntry = Record<string, unknown>;
    const getSubaccountIndex = (t: TraderEntry): number => {
      const idx = t.traderSubaccountIndex;
      return typeof idx === 'number' ? idx : typeof idx === 'string' ? parseInt(idx, 10) || 0 : 0;
    };
    const fetchSubaccount = async (): Promise<{ match: TraderEntry | null; status: number }> => {
      const res = await fetch(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(authority)}/state`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { match: null, status: res.status };
      const body = await res.json() as { traders?: unknown[] };
      if (!Array.isArray(body.traders) || body.traders.length === 0) return { match: null, status: res.status };
      const found = (body.traders as TraderEntry[]).find((t) => getSubaccountIndex(t) === targetIndex) ?? null;
      return { match: found, status: res.status };
    };

    try {
      let { match, status } = await fetchSubaccount();

      if (status === 404) return ApiErrors.notFound(c, 'Trader not found');
      if (status !== 200 && status > 0) return ApiErrors.badRequest(c, `Upstream ${status}`);
      if (!match) return ApiErrors.notFound(c, `Subaccount ${targetIndex} not found`);

      // Layer 1: retry on suspicious zero
      if (isSuspiciousZero(match)) {
        for (let attempt = 0; attempt < 2; attempt++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          const retry = await fetchSubaccount();
          if (retry.status === 200 && retry.match && !isSuspiciousZero(retry.match)) {
            match = retry.match;
            break;
          }
        }
      }

      // Layer 2: cache non-zero; serve cached value on persistent suspicious zeros
      if (isNonZeroTrader(match)) {
        subaccountNonZeroCache.set(cacheKey, { data: match, ts: Date.now() });
      } else if (isSuspiciousZero(match)) {
        const cached = subaccountNonZeroCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < TRADER_CACHE_TTL_MS) {
          return sendSuccess(c, cached.data);
        }
      }

      return sendSuccess(c, match);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return ApiErrors.internal(c, 'Phoenix API timed out');
      }
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Funding history for a symbol
  app.get('/api/phoenix/funding/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    const range = c.req.query('range');
    // Normalize: strip trailing -PERP suffix before forwarding to upstream API
    const bareSymbol = symbol.replace(/-PERP$/i, '');
    try {
      const url = new URL(`${PHOENIX_API_BASE_URL}/funding/${encodeURIComponent(bareSymbol)}`);
      if (range) url.searchParams.set('range', range);
      const res = await fetch(url.toString());
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const data = await res.json();
      return sendSuccess(c, data);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Trader trade/fill history
  app.get('/api/phoenix/trader/:authority/trades-history', async (c) => {
    const authority = c.req.param('authority');
    const limit = c.req.query('limit');
    const before = c.req.query('before');
    const validateAddr = z.string().regex(SOLANA_ADDRESS_RE).safeParse(authority);
    if (!validateAddr.success) return ApiErrors.badRequest(c, 'Invalid authority address');
    try {
      const url = new URL(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(authority)}/trades-history`);
      if (limit) url.searchParams.set('limit', limit);
      if (before) url.searchParams.set('before', before);
      const res = await fetch(url.toString());
      if (res.status === 404) return sendSuccess(c, []);
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const body = await res.json() as unknown;
      // Normalize: Phoenix may return { trades:[...] }, { fills:[...] }, { data:[...] }, or a bare array
      const list = Array.isArray(body)
        ? body
        : ((body as Record<string, unknown>).trades ?? (body as Record<string, unknown>).fills ?? (body as Record<string, unknown>).data ?? []);
      return sendSuccess(c, list);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Trader order history (filled/cancelled/expired)
  app.get('/api/phoenix/trader/:authority/order-history', async (c) => {
    const authority = c.req.param('authority');
    const limit = c.req.query('limit');
    const before = c.req.query('before');
    const validateAddr = z.string().regex(SOLANA_ADDRESS_RE).safeParse(authority);
    if (!validateAddr.success) return ApiErrors.badRequest(c, 'Invalid authority address');
    try {
      const url = new URL(`${PHOENIX_API_BASE_URL}/v1/trader/${encodeURIComponent(authority)}/order-history`);
      if (limit) url.searchParams.set('limit', limit);
      if (before) url.searchParams.set('before', before);
      const res = await fetch(url.toString());
      if (res.status === 404) return sendSuccess(c, []);
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const body = await res.json() as unknown;
      // Normalize: Phoenix may return { orders:[...] }, { data:[...] }, or a bare array
      const list = Array.isArray(body)
        ? body
        : ((body as Record<string, unknown>).orders ?? (body as Record<string, unknown>).data ?? []);
      return sendSuccess(c, list);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Trader funding payment history
  app.get('/api/phoenix/trader/:authority/funding-history', async (c) => {
    const authority = c.req.param('authority');
    const limit = c.req.query('limit');
    const before = c.req.query('before');
    const validateAddr = z.string().regex(SOLANA_ADDRESS_RE).safeParse(authority);
    if (!validateAddr.success) return ApiErrors.badRequest(c, 'Invalid authority address');
    try {
      const url = new URL(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(authority)}/funding-history`);
      if (limit) url.searchParams.set('limit', limit);
      if (before) url.searchParams.set('before', before);
      const res = await fetch(url.toString());
      if (res.status === 404) return sendSuccess(c, []);
      if (!res.ok) return ApiErrors.badRequest(c, `Upstream ${res.status}`);
      const body = await res.json() as unknown;
      // Normalize: Phoenix may return { payments:[...] }, { data:[...] }, or a bare array
      const list = Array.isArray(body)
        ? body
        : ((body as Record<string, unknown>).payments ?? (body as Record<string, unknown>).data ?? []);
      return sendSuccess(c, list);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Activate invite code
  app.post('/api/phoenix/invite/activate', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }
    const parsed = InviteActivateSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    if (parsed.data.authority !== walletAddress) {
      return ApiErrors.badRequest(c, 'authority must match authenticated wallet');
    }
    try {
      const res = await fetch(`${PHOENIX_API_BASE_URL}/v1/invite/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        let bodyText = '';
        let upstreamMessage = '';
        try {
          const body = await res.json() as Record<string, unknown>;
          bodyText = JSON.stringify(body);
          upstreamMessage = (typeof body.error === 'string' && body.error) ||
            (typeof body.message === 'string' && body.message) ||
            (typeof body.detail === 'string' && body.detail) ||
            bodyText;
        } catch {
          bodyText = await res.text().catch(() => '');
          upstreamMessage = bodyText || `HTTP ${res.status}`;
        }
        console.error(`[phoenix/activate] upstream ${res.status}:`, bodyText);
        return ApiErrors.badRequest(c, upstreamMessage || `Upstream ${res.status}`);
      }
      const data = await res.json();
      return sendSuccess(c, data);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Activate invite with referral
  app.post('/api/phoenix/invite/activate-with-referral', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }
    const parsed = InviteActivateWithReferralSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    if (parsed.data.authority !== walletAddress) {
      return ApiErrors.badRequest(c, 'authority must match authenticated wallet');
    }
    try {
      const res = await fetch(`${PHOENIX_API_BASE_URL}/v1/invite/activate-with-referral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        let bodyText = '';
        let upstreamMessage = '';
        try {
          const body = await res.json() as Record<string, unknown>;
          bodyText = JSON.stringify(body);
          upstreamMessage = (typeof body.error === 'string' && body.error) ||
            (typeof body.message === 'string' && body.message) ||
            (typeof body.detail === 'string' && body.detail) ||
            bodyText;
        } catch {
          bodyText = await res.text().catch(() => '');
          upstreamMessage = bodyText || `HTTP ${res.status}`;
        }
        console.error(`[phoenix/activate-with-referral] upstream ${res.status}:`, bodyText);
        return ApiErrors.badRequest(c, upstreamMessage || `Upstream ${res.status}`);
      }
      const data = await res.json();
      return sendSuccess(c, data);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // Unified activate-code: tries activate-with-referral first, falls back to plain activate
  app.post('/api/phoenix/invite/activate-code', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }
    const parsed = InviteActivateCodeSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    if (parsed.data.authority !== walletAddress) {
      return ApiErrors.badRequest(c, 'authority must match authenticated wallet');
    }

    const { authority, code } = parsed.data;

    // Helper to extract a meaningful error message from a Phoenix API response body
    async function extractUpstreamMessage(res: Response): Promise<{ errorCode: string; message: string }> {
      try {
        const body = await res.json() as Record<string, unknown>;
        const errorCode = (typeof body.error_code === 'string' && body.error_code) ||
          (typeof body.error === 'string' && body.error) || '';
        const message = (typeof body.message === 'string' && body.message) ||
          (typeof body.detail === 'string' && body.detail) ||
          (typeof body.error === 'string' && body.error) ||
          JSON.stringify(body);
        return { errorCode, message };
      } catch {
        const text = await res.text().catch(() => '');
        return { errorCode: '', message: text || `HTTP ${res.status}` };
      }
    }

    // Error codes we treat as "already activated / already has referral" → success
    const ALREADY_ACTIVATED_CODES = new Set([
      'user_already_has_referral',
      'already_activated',
      'user_already_activated',
      'invite_already_used',
    ]);

    // Step 1: try as referral code
    try {
      const referralRes = await fetch(`${PHOENIX_API_BASE_URL}/v1/invite/activate-with-referral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authority, referral_code: code }),
      });

      if (referralRes.ok) {
        return sendSuccess(c, { alreadyActivated: false });
      }

      const { errorCode, message } = await extractUpstreamMessage(referralRes);

      // Already has referral / already activated — treat as success
      if (ALREADY_ACTIVATED_CODES.has(errorCode)) {
        return sendSuccess(c, { alreadyActivated: true });
      }

      // If the code is not a referral code at all, fall through to plain activate
      const isNotReferral = errorCode.includes('referral') ||
        message.toLowerCase().includes('referral') ||
        message.toLowerCase().includes('not a referral') ||
        referralRes.status === 404;

      if (!isNotReferral) {
        // Some other referral-path error — surface it
        console.error(`[phoenix/activate-code] referral path ${referralRes.status}: ${message}`);
        return ApiErrors.badRequest(c, message || `Upstream ${referralRes.status}`);
      }

      // Fall through to plain invite activate
    } catch (err) {
      console.error('[phoenix/activate-code] referral fetch error:', err);
      // Network error on referral attempt — fall through to plain activate
    }

    // Step 2: try as plain invite code
    try {
      const activateRes = await fetch(`${PHOENIX_API_BASE_URL}/v1/invite/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authority, code }),
      });

      if (activateRes.ok) {
        return sendSuccess(c, { alreadyActivated: false });
      }

      const { errorCode, message } = await extractUpstreamMessage(activateRes);

      // Already activated — treat as success
      if (ALREADY_ACTIVATED_CODES.has(errorCode)) {
        return sendSuccess(c, { alreadyActivated: true });
      }

      console.error(`[phoenix/activate-code] plain activate ${activateRes.status}: ${message}`);
      return ApiErrors.badRequest(c, message || `Upstream ${activateRes.status}`);
    } catch {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }
  });

  // ── Rankings Routes ──────────────────────────────────────────────────────

  // Phoenix protocol ranking — computed from Phoenix candles API
  app.get('/api/rankings/phoenix', async (c) => {
    if (phoenixRankingCache && Date.now() < phoenixRankingCache.expiresAt) {
      return sendSuccess(c, phoenixRankingCache.data);
    }

    const TOP_MARKETS = ['SOL', 'BTC', 'ETH', 'XRP', 'HYPE', 'BNB', 'DOGE', 'SUI', 'AAVE', 'JUP'];

    type Candle = {
      time?: number;
      volume?: number;
      volumeQuote?: number;
      tradeCount?: number;
    };

    const fetches = TOP_MARKETS.map(async (symbol): Promise<Candle[]> => {
      const url = new URL(`${PHOENIX_API_BASE_URL}/candles`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('timeframe', '1d');
      url.searchParams.set('limit', '30');
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Upstream ${res.status} for ${symbol}`);
      const data = (await res.json()) as Candle[] | { candles?: Candle[] };
      const candles = Array.isArray(data) ? data : data.candles ?? [];
      return candles;
    });

    const settled = await Promise.allSettled(fetches);
    const allCandles: Candle[][] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') allCandles.push(s.value);
    }

    if (allCandles.length === 0) {
      return ApiErrors.internal(c, 'Phoenix API unreachable');
    }

    let volume24h = 0;
    let volume7d = 0;
    let volume30d = 0;
    let trades = 0;

    for (const candles of allCandles) {
      const sorted = [...candles].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
      if (sorted.length === 0) continue;
      volume24h += sorted[0].volumeQuote ?? 0;
      trades += sorted[0].tradeCount ?? 0;
      for (let i = 0; i < sorted.length && i < 7; i++) {
        volume7d += sorted[i].volumeQuote ?? 0;
      }
      for (const c of sorted) {
        volume30d += c.volumeQuote ?? 0;
      }
    }

    const result = {
      volume24h,
      volume7d,
      volume30d,
      trades,
      markets: 36,
    };

    phoenixRankingCache = { data: result, expiresAt: Date.now() + 300_000 };
    return sendSuccess(c, result);
  });

  // ── Phoenix Trade Record Route ───────────────────────────────────────────

  app.post('/api/phoenix/record-trade', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }

    // Validate body with Zod
    const RecordTradeSchema = z.object({
      txSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,128}$/, 'Invalid transaction signature'),
      trader: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid trader address'),
      market: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid market address'),
      symbol: z.string().min(1).max(64),
      side: z.enum(['long', 'short']),
      sizeBaseLots: z.number().int().positive(),
      leverage: z.number().int().positive(),
      orderType: z.enum(['market', 'limit']),
      limitPrice: z.number().positive().optional(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
      subaccountIndex: z.number().int().min(0),
      sizeUsd: z.number().int().min(0),
      // Notification fan-out hints (optional, additive — older clients omit them).
      // isClose distinguishes a position-close from an open; pnlUsdCents carries
      // the realized PnL (signed cents) for closes so followers see the result.
      isClose: z.boolean().optional(),
      pnlUsdCents: z.number().int().optional(),
      // Realized PnL as a % of margin (e.g. 75 = +75% on margin). Used to flag
      // "big win" notifications when >= +50%. Optional — older clients omit it.
      pnlPct: z.number().optional(),
    });

    const parsed = RecordTradeSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const body = parsed.data;

    // Caller can only record their own trade
    if (walletAddress !== body.trader) {
      return ApiErrors.badRequest(c, 'trader must match authenticated wallet');
    }

    // ── Deduplicate via deterministic keyed lookup (no query interpolation) ─
    // recordId is fully derived from the (txSignature, trader) pair, so a
    // direct keyed get is an injection-free dedup. Never build a where-clause
    // from the user-supplied txSignature — Tarobase where-clauses are raw
    // string interpolation and would be a query-injection sink.
    const recordId = `${body.txSignature.slice(0, 16)}-${body.trader.slice(0, 8)}`;
    const existing = await getPhoenixTradeRecord(recordId);
    if (existing) {
      return ApiErrors.badRequest(c, 'Transaction signature already recorded');
    }

    // ── Verify transaction on-chain ───────────────────────────────────────
    // Phoenix program (mainnet): EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih
    // Flight proxy program:      F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W
    const PHOENIX_PROGRAM = 'EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih';
    const FLIGHT_PROGRAM = 'F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W';

    try {
      const envAny = c.env as Record<string, string | undefined>;
      const procAny = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
      const rpcUrl = envAny.SOLANA_RPC_URL || procAny.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            body.txSignature,
            {
              encoding: 'json',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      });

      if (!rpcRes.ok) {
        return ApiErrors.internal(c, 'RPC request failed');
      }

      const rpcBody = await rpcRes.json() as {
        result?: {
          meta?: { err: unknown; logMessages?: string[] } | null;
          transaction?: {
            message?: {
              accountKeys?: string[];
              instructions?: Array<{ programIdIndex?: number }>;
            };
          } | null;
        } | null;
        error?: unknown;
      };

      if (rpcBody.error) {
        return ApiErrors.badRequest(c, 'RPC error: transaction not found or invalid');
      }

      const txResult = rpcBody.result;
      if (!txResult) {
        return ApiErrors.badRequest(c, 'Transaction not found — it may not be confirmed yet');
      }

      // Must have succeeded (meta.err == null)
      if (txResult.meta?.err !== null && txResult.meta?.err !== undefined) {
        return ApiErrors.badRequest(c, 'Transaction failed on-chain');
      }

      // Verify trader is a signer/account on the transaction
      const accountKeys: string[] = txResult.transaction?.message?.accountKeys ?? [];
      const traderIsPresent = accountKeys.includes(body.trader);
      if (!traderIsPresent) {
        return ApiErrors.badRequest(c, 'Trader wallet is not present in transaction');
      }

      // Verify Phoenix or Flight program is among the invoked programs
      const instructionProgramIndices = (txResult.transaction?.message?.instructions ?? [])
        .map((ix) => ix.programIdIndex)
        .filter((i): i is number => i !== undefined);
      const invokedPrograms = instructionProgramIndices.map((i) => accountKeys[i]).filter(Boolean);
      const hasPhoenixOrFlight =
        invokedPrograms.includes(PHOENIX_PROGRAM) || invokedPrograms.includes(FLIGHT_PROGRAM);
      if (!hasPhoenixOrFlight) {
        return ApiErrors.badRequest(c, 'Transaction does not invoke Phoenix or Flight program');
      }
    } catch (rpcErr) {
      console.error('[record-trade] RPC verification error:', rpcErr);
      return ApiErrors.internal(c, 'Failed to verify transaction on-chain');
    }

    // ── Write the phoenixTradeRecord (backend as vault) ───────────────────
    // The backend signs as PROJECT_VAULT_ADDRESS (the only allowed writer).
    // The offchain create hook awards trading points and writes pointsActivity.
    // recordId was computed above for the dedup lookup.
    const now = Math.floor(Date.now() / 1000);

    const writeSuccess = await setPhoenixTradeRecord(recordId, {
      trader: Address.publicKey(body.trader),
      market: Address.publicKey(body.market),
      symbol: body.symbol,
      side: body.side,
      sizeBaseLots: body.sizeBaseLots,
      leverage: body.leverage,
      orderType: body.orderType,
      ...(body.limitPrice != null ? { limitPrice: body.limitPrice } : {}),
      ...(body.stopLoss != null ? { stopLoss: body.stopLoss } : {}),
      ...(body.takeProfit != null ? { takeProfit: body.takeProfit } : {}),
      subaccountIndex: body.subaccountIndex,
      sizeUsd: body.sizeUsd,
      txSignature: body.txSignature,
      createdAt: now,
    });

    if (!writeSuccess) {
      return ApiErrors.internal(c, 'Failed to write trade record');
    }

    // ── Fan out notifications to this trader's followers ──────────────────────
    // Backend signs as PROJECT_VAULT_ADDRESS (the only allowed notifications
    // writer). Best-effort: a failed fan-out must not fail the recorded trade.
    // record-trade fires for every Flight order (cross + isolated, open + close),
    // so this covers all observable trade events.
    try {
      await notifyFollowers({
        trader: body.trader,
        type: body.isClose ? 'close' : 'open',
        symbol: body.symbol,
        side: body.side,
        ...(body.isClose && typeof body.pnlUsdCents === 'number' ? { pnlUsdCents: body.pnlUsdCents } : {}),
        ...(body.isClose && typeof body.pnlPct === 'number' ? { pnlPct: body.pnlPct } : {}),
      });
    } catch (fanErr) {
      console.error('[record-trade] notification fan-out error (non-fatal):', fanErr);
    }

    // ── Record a public "win" for the Arena Wins ticker ───────────────────────
    // Best-effort and purely additive: phoenixTradeRecord above remains the
    // source of truth. Only profitable closes qualify. recordId is the same
    // deterministic key, and the dedup guard above ensures this runs once per
    // recordId; phoenixWins fields are immutable so a single keyed set is correct.
    if (body.isClose === true && typeof body.pnlUsdCents === 'number' && body.pnlUsdCents > 0) {
      try {
        await setPhoenixWins(recordId, {
          trader: Address.publicKey(body.trader),
          symbol: body.symbol,
          market: Address.publicKey(body.market),
          pnlUsdCents: body.pnlUsdCents,
          createdAt: now,
        });
      } catch (winsErr) {
        console.error('[record-trade] wins write error (non-fatal):', winsErr);
      }
    }

    return sendSuccess(c, { recordId, txSignature: body.txSignature });
  });

  // ── Phoenix Record Follow Route ──────────────────────────────────────────
  // Called by the frontend AFTER a `follows` doc is created (user-signed). The
  // authenticated caller is the FOLLOWER; the body carries the FOLLOWED trader's
  // address (the notification recipient). Backend signs as PROJECT_VAULT_ADDRESS
  // (the only allowed notifications writer) to create a 'follow' notification.
  app.post('/api/phoenix/record-follow', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }

    const RecordFollowSchema = z.object({
      followed: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid followed address'),
    });

    const parsed = RecordFollowSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const follower = walletAddress;
    const followed = parsed.data.followed;

    // Self-follow: no one should be notified that they followed themselves.
    if (follower === followed) {
      return sendSuccess(c, { notified: false });
    }

    // Best-effort: a failed notification must not surface as a follow failure.
    const notified = await notifyNewFollower(follower, followed);
    return sendSuccess(c, { notified });
  });

  // ── Admin Backfill Routes ────────────────────────────────────────────────

  app.post('/api/admin/backfill-points', async (c) => {
    await validatePoofAuth(c, true);

    // 1. Read all collections
    const [socialClaims, phoenixOrders, userPointsList, pointsActivityList] = await Promise.all([
      getAllSocialClaims(),
      getAllPhoenixOrder(),
      getAllUserPoints(),
      getAllPointsActivity(),
    ]);

    // 2. Build lookup maps
    const existingUserPoints = new Map<string, typeof userPointsList[number]>();
    for (const up of userPointsList) {
      existingUserPoints.set(up.address, up);
    }

    const existingActivityIds = new Set<string>();
    for (const pa of pointsActivityList) {
      existingActivityIds.add(pa.id);
    }

    // 3. Compute per-user stats from claims and trades
    type UserStats = {
      socialPoints: number;
      tradingPoints: number;
      latestTimestamp: number;
      twitterClaimed: boolean;
      telegramClaimed: boolean;
      tradeOrderIds: string[];
    };

    const userStats = new Map<string, UserStats>();

    for (const claim of socialClaims) {
      const addr = claim.address;
      if (!addr) continue;
      let stats = userStats.get(addr);
      if (!stats) {
        stats = {
          socialPoints: 0,
          tradingPoints: 0,
          latestTimestamp: 0,
          twitterClaimed: false,
          telegramClaimed: false,
          tradeOrderIds: [],
        };
        userStats.set(addr, stats);
      }
      if (claim.twitterFollowClaimed && claim.twitterFollowClaimedAt) {
        stats.socialPoints += 500;
        stats.twitterClaimed = true;
        stats.latestTimestamp = Math.max(stats.latestTimestamp, claim.twitterFollowClaimedAt);
      }
      if (claim.telegramJoinClaimed && claim.telegramJoinClaimedAt) {
        stats.socialPoints += 500;
        stats.telegramClaimed = true;
        stats.latestTimestamp = Math.max(stats.latestTimestamp, claim.telegramJoinClaimedAt);
      }
    }

    for (const order of phoenixOrders) {
      const addr = order.trader;
      if (!addr) continue;
      let stats = userStats.get(addr);
      if (!stats) {
        stats = {
          socialPoints: 0,
          tradingPoints: 0,
          latestTimestamp: 0,
          twitterClaimed: false,
          telegramClaimed: false,
          tradeOrderIds: [],
        };
        userStats.set(addr, stats);
      }
      stats.tradingPoints += order.sizeUsd ?? 10;
      stats.tradeOrderIds.push(order.id);
      stats.latestTimestamp = Math.max(stats.latestTimestamp, order.tarobase_created_at);
    }

    // 4. Backfill missing records
    const userPointsOps: ReturnType<typeof buildUserPoints>[] = [];
    const activityOps: ReturnType<typeof buildPointsActivity>[] = [];
    const details: string[] = [];
    let usersBackfilled = 0;
    let pointsActivityCreated = 0;
    let skipped = 0;

    for (const [addr, stats] of userStats) {
      const totalPoints = stats.socialPoints + stats.tradingPoints;
      const existing = existingUserPoints.get(addr);
      let needsUserPoints = false;
      let needsAnyActivity = false;

      if (!existing) {
        needsUserPoints = true;
      }

      const twitterId = `backfill-twitter-${addr}`;
      const telegramId = `backfill-telegram-${addr}`;

      if (stats.twitterClaimed && !existingActivityIds.has(twitterId)) {
        needsAnyActivity = true;
      }
      if (stats.telegramClaimed && !existingActivityIds.has(telegramId)) {
        needsAnyActivity = true;
      }
      for (const orderId of stats.tradeOrderIds) {
        const tradeId = `backfill-trade-${orderId}`;
        if (!existingActivityIds.has(tradeId)) {
          needsAnyActivity = true;
        }
      }

      if (!needsUserPoints && !needsAnyActivity) {
        skipped++;
        details.push(`Skipped ${addr}: already up-to-date`);
        continue;
      }

      if (needsUserPoints) {
        userPointsOps.push(
          buildUserPoints(addr, {
            address: Address.publicKey(addr),
            totalPoints,
            tradingPoints: stats.tradingPoints,
            battlePoints: 0,
            socialPoints: stats.socialPoints,
            updatedAt: stats.latestTimestamp || Time.Now,
          })
        );
        usersBackfilled++;
        details.push(
          `Created userPoints for ${addr}: total=${totalPoints}, social=${stats.socialPoints}, trading=${stats.tradingPoints}`
        );
      } else if (existing && stats.tradingPoints > (existing.tradingPoints ?? 0)) {
        const missingTrading = stats.tradingPoints - (existing.tradingPoints ?? 0);
        const newTotal = (existing.totalPoints ?? 0) + missingTrading;
        userPointsOps.push(
          buildUpdateUserPoints(addr, {
            tradingPoints: stats.tradingPoints,
            totalPoints: newTotal,
            updatedAt: Time.Now,
          })
        );
        usersBackfilled++;
        details.push(
          `Updated userPoints for ${addr}: tradingPoints ${existing.tradingPoints ?? 0} → ${stats.tradingPoints}, total ${existing.totalPoints ?? 0} → ${newTotal}`
        );
      } else {
        details.push(`Skipped userPoints for ${addr}: already up-to-date`);
      }

      if (stats.twitterClaimed && !existingActivityIds.has(twitterId)) {
        const claim = socialClaims.find(
          (c) => c.address === addr && c.twitterFollowClaimed
        );
        const createdAt = claim?.twitterFollowClaimedAt || stats.latestTimestamp;
        activityOps.push(
          buildPointsActivity(twitterId, {
            userAddress: Address.publicKey(addr),
            activityType: 'follow_twitter',
            points: 500,
            description: 'Followed on Twitter',
            createdAt,
          })
        );
        pointsActivityCreated++;
        details.push(`Created pointsActivity ${twitterId} for ${addr}: follow_twitter +500`);
      }

      if (stats.telegramClaimed && !existingActivityIds.has(telegramId)) {
        const claim = socialClaims.find(
          (c) => c.address === addr && c.telegramJoinClaimed
        );
        const createdAt = claim?.telegramJoinClaimedAt || stats.latestTimestamp;
        activityOps.push(
          buildPointsActivity(telegramId, {
            userAddress: Address.publicKey(addr),
            activityType: 'join_telegram',
            points: 500,
            description: 'Joined X group chat',
            createdAt,
          })
        );
        pointsActivityCreated++;
        details.push(`Created pointsActivity ${telegramId} for ${addr}: join_telegram +500`);
      }

      for (const orderId of stats.tradeOrderIds) {
        const tradeId = `backfill-trade-${orderId}`;
        if (!existingActivityIds.has(tradeId)) {
          const order = phoenixOrders.find((o) => o.id === orderId);
          const createdAt = order?.tarobase_created_at || stats.latestTimestamp;
          activityOps.push(
            buildPointsActivity(tradeId, {
              userAddress: Address.publicKey(addr),
              activityType: 'trade',
              points: order?.sizeUsd ?? 10,
              description: 'Phoenix trade placed',
              createdAt,
            })
          );
          pointsActivityCreated++;
          details.push(`Created pointsActivity ${tradeId} for ${addr}: trade +10`);
        }
      }
    }

    // 5. Execute writes in batches
    if (userPointsOps.length > 0) {
      await setMany(userPointsOps);
    }
    if (activityOps.length > 0) {
      await setMany(activityOps);
    }

    return sendSuccess(c, {
      usersBackfilled,
      pointsActivityCreated,
      skipped,
      details,
    });
  });

  // ── Admin: Backfill trade record for Privy/social wallet ────────────────
  // Used when a wallet traded through this app but points were never awarded
  // because getIdToken() returned null (Privy/social wallet bug). Creates a
  // phoenixTradeRecord directly (as the vault), triggering the offchain hook
  // that awards tradingPoints and writes pointsActivity. Idempotent: rejects
  // if a backfill record for this wallet already exists.
  app.post('/api/admin/backfill-trader-record', async (c) => {
    await validatePoofAuth(c, true);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }

    const BackfillSchema = z.object({
      walletAddress: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid Solana address'),
      // sizeUsd is the notional USD value (floor) — $1 = 1 point
      sizeUsd: z.number().int().min(1).max(1_000_000),
      // symbol and market are optional; defaults to SOL-PERP if omitted
      symbol: z.string().min(1).max(64).optional(),
      market: z.string().regex(SOLANA_ADDRESS_RE).optional(),
      side: z.enum(['long', 'short']).optional(),
    });

    const parsed = BackfillSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { walletAddress, sizeUsd, symbol, market, side } = parsed.data;

    // Build a deterministic recordId for this backfill so it's idempotent.
    const recordId = `backfill-privy-${walletAddress.slice(0, 12)}`;

    // Reject if already backfilled to prevent double-awarding.
    // Use direct get by recordId (deterministic) — reliable O(1) check.
    const existing = await getPhoenixTradeRecord(recordId);
    if (existing) {
      return ApiErrors.badRequest(c, 'Backfill record already exists for this wallet');
    }

    const now = Math.floor(Date.now() / 1000);
    const writeSuccess = await setPhoenixTradeRecord(recordId, {
      trader: Address.publicKey(walletAddress),
      market: Address.publicKey(market ?? SOL_PERP_MARKET),
      symbol: symbol ?? 'SOL-PERP',
      side: side ?? 'long',
      sizeBaseLots: 1,
      leverage: 1,
      orderType: 'market',
      subaccountIndex: 0,
      sizeUsd,
      // Use recordId as txSignature — this field stores the reference but the offchain hook
      // does not validate it. Only the /api/phoenix/record-trade public route verifies the
      // real on-chain tx; this admin route bypasses that check intentionally for backfills.
      txSignature: recordId,
      createdAt: now,
    });

    if (!writeSuccess) {
      return ApiErrors.internal(c, 'Failed to write backfill trade record. Check vault policy allows phoenixTradeRecord creates.');
    }

    return sendSuccess(c, {
      recordId,
      walletAddress,
      sizeUsd,
      pointsAwarded: sizeUsd,
      message: `Backfill complete. ${sizeUsd} trading points awarded to ${walletAddress} via offchain hook.`,
    });
  });

  // ── Admin: Retroactive trade-record backfill ─────────────────────────────
  // Data-recovery tool: fetches on-chain fill history from the Phoenix API for
  // every registered trader (or a single wallet override), checks which trades
  // are missing a phoenixTradeRecord, and either dry-runs a report or writes the
  // missing records (triggering the offchain hook that awards tradingPoints).
  //
  // dryRun defaults to TRUE — no writes until explicitly set to false.
  app.post('/api/admin/backfill-trade-records', async (c) => {
    await validatePoofAuth(c, true);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }

    const BackfillSchema = z.object({
      dryRun: z.boolean().default(true),
      wallet: z.string().regex(SOLANA_ADDRESS_RE).optional(),
      maxTradesPerWallet: z.number().int().min(1).max(500).default(100),
    });

    const parsed = BackfillSchema.safeParse(raw);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { dryRun, wallet, maxTradesPerWallet } = parsed.data;

    // ── 1. Build wallet list ─────────────────────────────────────────────
    let wallets: string[];
    if (wallet) {
      wallets = [wallet];
    } else {
      const traders = await getAllPhoenixTrader();
      wallets = traders.map((t) => t.id).filter(Boolean);
    }

    console.log(`[backfill-trade-records] Starting: wallets=${wallets.length}, dryRun=${dryRun}, maxTradesPerWallet=${maxTradesPerWallet}`);

    // ── 2. Per-wallet processing ─────────────────────────────────────────
    type WalletSummary = {
      wallet: string;
      totalTradesFetched: number;
      alreadyRecorded: number;
      missingCount: number;
      staleZeroReplaced: number;
      pointsWouldAward: number;
      written: number;
      errors: string[];
    };

    const walletSummaries: WalletSummary[] = [];
    let grandTotalFetched = 0;
    let grandTotalAlreadyRecorded = 0;
    let grandTotalMissing = 0;
    let grandTotalStaleZero = 0;
    let grandTotalPoints = 0;
    let grandTotalWritten = 0;
    let walletsAffected = 0;

    for (const traderWallet of wallets) {
      const summary: WalletSummary = {
        wallet: traderWallet,
        totalTradesFetched: 0,
        alreadyRecorded: 0,
        missingCount: 0,
        staleZeroReplaced: 0,
        pointsWouldAward: 0,
        written: 0,
        errors: [],
      };

      try {
        // ── 2a. Fetch fill history from Phoenix API ──────────────────────
        // Paginate up to maxTradesPerWallet using cursor-based `before` param.
        const allTrades: Record<string, unknown>[] = [];
        let before: string | undefined;
        const pageSize = Math.min(maxTradesPerWallet, 100);

        while (allTrades.length < maxTradesPerWallet) {
          const url = new URL(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(traderWallet)}/trades-history`);
          url.searchParams.set('limit', String(pageSize));
          if (before) url.searchParams.set('before', before);

          let pageData: unknown;
          try {
            const res = await fetch(url.toString());
            if (res.status === 404) break; // No trades for this wallet
            if (!res.ok) {
              summary.errors.push(`Phoenix API returned ${res.status} for page (before=${before ?? 'start'})`);
              break;
            }
            pageData = await res.json();
          } catch (fetchErr) {
            summary.errors.push(`Network error fetching trades: ${String(fetchErr)}`);
            break;
          }

          // Phoenix may return { trades:[...] }, { fills:[...] }, { data:[...] }, or bare array
          const page = Array.isArray(pageData)
            ? (pageData as Record<string, unknown>[])
            : Array.isArray((pageData as Record<string, unknown>).trades)
              ? ((pageData as Record<string, unknown>).trades as Record<string, unknown>[])
              : Array.isArray((pageData as Record<string, unknown>).fills)
                ? ((pageData as Record<string, unknown>).fills as Record<string, unknown>[])
                : Array.isArray((pageData as Record<string, unknown>).data)
                  ? ((pageData as Record<string, unknown>).data as Record<string, unknown>[])
                  : [];

          if (page.length === 0) break; // No more pages

          allTrades.push(...page);

          if (allTrades.length >= maxTradesPerWallet || page.length < pageSize) break;

          // Advance cursor: use the last item's signature or sequence as `before`
          const last = page[page.length - 1];
          const lastSig = (last.signature ?? last.txSignature ?? last.transactionSignature ?? last.tx) as string | undefined;
          if (!lastSig || lastSig === before) break; // No cursor advancement, stop
          before = lastSig;
        }

        // Cap to maxTradesPerWallet
        const trades = allTrades.slice(0, maxTradesPerWallet);
        summary.totalTradesFetched = trades.length;
        grandTotalFetched += trades.length;

        if (trades.length === 0) {
          walletSummaries.push(summary);
          continue;
        }

        // ── 2b. For each trade, check if a record already exists ─────────
        // Dedup uses deterministic keyed gets on the (txSig, trader) recordId
        // (and its "-v2" stale-zero variant) — the same injection-free pattern
        // as the production record-trade route. No where-clause interpolation.
        //
        // Special case for stale zero records: if an existing record has sizeUsd === 0
        // it was written by a prior broken backfill run and awards no points. We treat
        // these as NOT yet recorded so we can create a corrected record.
        // Because update: "false" and delete: "false" in the policy, we cannot overwrite
        // or remove the stale record — instead we write a new one with a "-v2" suffix on
        // the recordId. The old zero record remains (offchain hook already ran with 0 pts,
        // harmless) and the new record triggers the hook with the correct sizeUsd.
        const missingTrades: Record<string, unknown>[] = [];

        for (const trade of trades) {
          // Map Phoenix API field variants to canonical txSignature
          const txSig = (
            trade.signature ?? trade.txSignature ?? trade.transactionSignature ?? trade.tx
          ) as string | undefined;

          // txSig comes from an EXTERNAL Phoenix API response — strictly
          // validate it as base58 before it flows into the dedup lookup AND
          // the record path. Never trust an upstream-supplied signature.
          const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
          if (!txSig || typeof txSig !== 'string' || !BASE58_SIG.test(txSig)) {
            summary.errors.push(`Trade missing or malformed signature, skipping`);
            continue;
          }

          // Dedup via deterministic keyed gets (no query interpolation). A
          // (txSig, traderWallet) pair maps to at most two records: the base
          // recordId and its stale-zero "-v2" variant. Never build a
          // where-clause from the externally-sourced txSig.
          const dedupBase = `${txSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
          const existing = (await Promise.all([
            getPhoenixTradeRecord(dedupBase),
            getPhoenixTradeRecord(`${dedupBase}-v2`),
          ])).filter((r): r is NonNullable<typeof r> => r != null);
          if (existing.length > 0) {
            // Check if ALL existing records for this txSig have sizeUsd === 0 (stale zeros)
            const hasRealRecord = existing.some((r) => typeof r.sizeUsd === 'number' && r.sizeUsd > 0);
            if (hasRealRecord) {
              // A real record exists — skip this trade
              summary.alreadyRecorded++;
              continue;
            }
            // Only stale zero records exist — mark for re-processing with a -v2 suffix
            missingTrades.push({ ...trade, _resolvedSig: txSig, _staleZeroReplace: true });
            continue;
          }

          missingTrades.push({ ...trade, _resolvedSig: txSig, _staleZeroReplace: false });
        }

        grandTotalAlreadyRecorded += summary.alreadyRecorded;
        summary.missingCount = missingTrades.length;
        summary.staleZeroReplaced = missingTrades.filter((t) => t._staleZeroReplace).length;
        grandTotalMissing += missingTrades.length;
        grandTotalStaleZero += summary.staleZeroReplaced;

        // ── 2c. Compute points and optionally write ──────────────────────
        for (const trade of missingTrades) {
          // Map Phoenix fill fields to record-trade's canonical fields.
          // Phoenix fills typically have: sizeUsd / size_usd / notionalUsd, side,
          // symbol / market, timestamp / createdAt / blockTime.
          const txSig = trade._resolvedSig as string;
          const staleZeroReplace = trade._staleZeroReplace as boolean;

          // sizeUsd: notional USD value — floor to int (same as hook expects: $1 = 1 point).
          //
          // The record-trade route receives sizeUsd from the frontend as:
          //   Math.floor(baseTokens * markPrice)   [HyperliquidOrderTicket.tsx / TradePage.tsx]
          // i.e. absolute USD notional of the fill, floored to a whole dollar.
          //
          // The Phoenix trades-history API does NOT return sizeUsd, size_usd, notionalUsd,
          // usdSize, or any of the previously attempted field names. It returns:
          //   baseLotsDelta, virtualQuoteLotsDelta, price, realizedPnl, fees, liquidity
          //
          // virtualQuoteLotsDelta is the fill's USD-quoted value (base × price, already
          // computed by Phoenix). Math.abs() because opens are negative on one side.
          // This is semantically identical to what the frontend computes, so points will match.
          const rawVirtualQuote = trade.virtualQuoteLotsDelta ?? 0;
          const sizeUsd = Math.floor(Math.abs(Number(rawVirtualQuote)));

          // side: Phoenix trades-history does not return a 'side' field. Infer from
          // baseLotsDelta sign: positive = buy (long), negative = sell (short).
          // Fall back to any explicit side/direction field if present.
          const baseLotsDeltaNum = Number(trade.baseLotsDelta ?? 0);
          let side: 'long' | 'short';
          if (trade.side ?? trade.direction ?? trade.orderSide) {
            const rawSide = ((trade.side ?? trade.direction ?? trade.orderSide ?? '') as string).toLowerCase();
            side = rawSide.startsWith('long') || rawSide === 'buy' || rawSide === 'bid' ? 'long' : 'short';
          } else {
            side = baseLotsDeltaNum >= 0 ? 'long' : 'short';
          }

          // symbol: e.g. 'SOL-PERP'
          const symbol = ((trade.symbol ?? trade.market ?? trade.pair ?? 'SOL-PERP') as string).toUpperCase();

          // market: on-chain market pubkey
          const marketPubkey = (trade.marketAddress ?? trade.market_address ?? trade.marketPubkey ?? trade.market_pubkey ?? trade.marketKey ?? SOL_PERP_MARKET) as string;

          // sizeBaseLots: Phoenix trades-history returns this as baseLotsDelta (absolute value).
          // Fall through other variants for robustness.
          const sizeBaseLots = Math.abs(Number(trade.baseLotsDelta ?? trade.sizeBaseLots ?? trade.baseLots ?? trade.size_lots ?? trade.baseFilled ?? trade.baseQuantity ?? 0));

          // timestamp: prefer on-chain blockTime; fall back to API createdAt.
          // Phoenix returns `timestamp` as an ISO 8601 string — parse robustly to seconds.
          const rawTs = trade.blockTime ?? trade.timestamp ?? trade.createdAt ?? trade.created_at ?? trade.time ?? 0;
          const tradeTs = parseFillTimestampSec(rawTs);
          const createdAt = tradeTs > 0 ? tradeTs : Math.floor(Date.now() / 1000);

          summary.pointsWouldAward += sizeUsd;

          if (!dryRun) {
            // Use the same recordId pattern as the production record-trade route.
            // For stale-zero replacements (existing record has sizeUsd === 0), append "-v2"
            // to create a fresh document. Policy blocks update/delete so we cannot overwrite
            // the old zero record — but its offchain hook already fired with 0 pts (harmless),
            // and the new record's hook fires correctly with the real sizeUsd.
            const recordIdBase = `${txSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
            const recordId = staleZeroReplace ? `${recordIdBase}-v2` : recordIdBase;
            const now = Math.floor(Date.now() / 1000);

            const writeSuccess = await setPhoenixTradeRecord(recordId, {
              trader: Address.publicKey(traderWallet),
              market: Address.publicKey(marketPubkey),
              symbol,
              side,
              sizeBaseLots,
              leverage: 1,            // Not available from fill history; set neutral default
              orderType: 'market',    // Fill history = filled orders; treat as market fill
              subaccountIndex: 0,
              sizeUsd,
              txSignature: txSig,
              createdAt: tradeTs > 0 ? createdAt : now,
            });

            if (writeSuccess) {
              summary.written++;
              grandTotalWritten++;
            } else {
              summary.errors.push(`setPhoenixTradeRecord failed for txSig=${txSig.slice(0, 16)}…`);
            }
          }
        }

        grandTotalPoints += summary.pointsWouldAward;
        if (summary.missingCount > 0) walletsAffected++;

        console.log(
          `[backfill-trade-records] wallet=${traderWallet.slice(0, 8)}… fetched=${summary.totalTradesFetched} already=${summary.alreadyRecorded} missing=${summary.missingCount} staleZeroReplace=${summary.staleZeroReplaced} pts=${summary.pointsWouldAward} written=${summary.written}`
        );
      } catch (walletErr) {
        summary.errors.push(`Unhandled error: ${String(walletErr)}`);
        console.error(`[backfill-trade-records] wallet=${traderWallet.slice(0, 8)}… error:`, walletErr);
      }

      walletSummaries.push(summary);
    }

    console.log(
      `[backfill-trade-records] Done: walletsAffected=${walletsAffected} totalMissing=${grandTotalMissing} staleZeroReplace=${grandTotalStaleZero} totalPoints=${grandTotalPoints} written=${grandTotalWritten} dryRun=${dryRun}`
    );

    return sendSuccess(c, {
      dryRun,
      grandTotals: {
        walletsProcessed: wallets.length,
        walletsAffected,
        totalTradesFetched: grandTotalFetched,
        totalAlreadyRecorded: grandTotalAlreadyRecorded,
        totalMissingTrades: grandTotalMissing,
        totalStaleZeroReplaced: grandTotalStaleZero,
        totalPointsWouldAward: grandTotalPoints,
        totalWritten: grandTotalWritten,
      },
      wallets: walletSummaries,
    });
  });

  // ── Social Claim Routes ──────────────────────────────────────────────────

  app.post('/api/social/claim/twitter', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);

    const existingClaim = await getSocialClaims(walletAddress);
    if (existingClaim?.twitterFollowClaimed) {
      return ApiErrors.badRequest(c, 'Already claimed');
    }

    const existingPending = await getPendingSocialClaims(walletAddress);
    if (existingPending?.twitterFollowPending) {
      return ApiErrors.badRequest(c, 'Claim already pending');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!existingPending) {
      const success = await setPendingSocialClaims(walletAddress, {
        address: Address.publicKey(walletAddress),
        twitterFollowPending: true,
        twitterFollowRequestedAt: now,
        telegramJoinPending: false,
      });
      if (!success) return ApiErrors.internal(c, 'Failed to create pending claim');
    } else {
      const success = await updatePendingSocialClaims(walletAddress, {
        twitterFollowPending: true,
        twitterFollowRequestedAt: now,
      });
      if (!success) return ApiErrors.internal(c, 'Failed to update pending claim');
    }

    return sendSuccess(c, { pending: true });
  });

  app.post('/api/social/claim/telegram', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);

    const existingClaim = await getSocialClaims(walletAddress);
    if (existingClaim?.telegramJoinClaimed) {
      return ApiErrors.badRequest(c, 'Already claimed');
    }

    const existingPending = await getPendingSocialClaims(walletAddress);
    if (existingPending?.telegramJoinPending) {
      return ApiErrors.badRequest(c, 'Claim already pending');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!existingPending) {
      const success = await setPendingSocialClaims(walletAddress, {
        address: Address.publicKey(walletAddress),
        twitterFollowPending: false,
        telegramJoinPending: true,
        telegramJoinRequestedAt: now,
      });
      if (!success) return ApiErrors.internal(c, 'Failed to create pending claim');
    } else {
      const success = await updatePendingSocialClaims(walletAddress, {
        telegramJoinPending: true,
        telegramJoinRequestedAt: now,
      });
      if (!success) return ApiErrors.internal(c, 'Failed to update pending claim');
    }

    return sendSuccess(c, { pending: true });
  });

  app.post('/api/admin/social/approve', async (c) => {
    await validatePoofAuth(c, true);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body');
    }

    const parsed = z.object({
      walletAddress: z.string().regex(SOLANA_ADDRESS_RE, 'Invalid Solana address'),
      claimType: z.enum(['twitter', 'telegram']),
    }).safeParse(raw);

    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { walletAddress: targetWallet, claimType } = parsed.data;

    const pending = await getPendingSocialClaims(targetWallet);
    if (!pending) {
      return ApiErrors.notFound(c, 'Pending claim not found');
    }

    if (claimType === 'twitter' && !pending.twitterFollowPending) {
      return ApiErrors.badRequest(c, 'Twitter claim is not pending');
    }
    if (claimType === 'telegram' && !pending.telegramJoinPending) {
      return ApiErrors.badRequest(c, 'Telegram claim is not pending');
    }

    const existingClaim = await getSocialClaims(targetWallet);
    if (claimType === 'twitter' && existingClaim?.twitterFollowClaimed) {
      return ApiErrors.badRequest(c, 'Already approved');
    }
    if (claimType === 'telegram' && existingClaim?.telegramJoinClaimed) {
      return ApiErrors.badRequest(c, 'Already approved');
    }

    const now = Math.floor(Date.now() / 1000);

    if (!existingClaim) {
      const success = await setSocialClaims(targetWallet, {
        address: Address.publicKey(targetWallet),
        twitterFollowClaimed: claimType === 'twitter',
        ...(claimType === 'twitter' ? { twitterFollowClaimedAt: now } : {}),
        telegramJoinClaimed: claimType === 'telegram',
        ...(claimType === 'telegram' ? { telegramJoinClaimedAt: now } : {}),
      });
      if (!success) return ApiErrors.internal(c, 'Failed to approve claim');
    } else {
      // Build a COMPLETE document (spread all existing fields) to avoid partial-overwrite data loss.
      // set() is an overwrite, not a merge — omitting required fields (address, *Claimed booleans)
      // causes the DB to reject the write and return false.
      const fullDoc: SocialClaimsRequest = {
        address: Address.publicKey(targetWallet),
        twitterFollowClaimed: claimType === 'twitter' ? true : existingClaim.twitterFollowClaimed,
        telegramJoinClaimed: claimType === 'telegram' ? true : existingClaim.telegramJoinClaimed,
        ...(existingClaim.twitterFollowClaimed || claimType === 'twitter' ? { twitterFollowClaimedAt: claimType === 'twitter' ? now : existingClaim.twitterFollowClaimedAt } : {}),
        ...(existingClaim.telegramJoinClaimed || claimType === 'telegram' ? { telegramJoinClaimedAt: claimType === 'telegram' ? now : existingClaim.telegramJoinClaimedAt } : {}),
      };
      const success = await setSocialClaims(targetWallet, fullDoc);
      if (!success) return ApiErrors.internal(c, 'Failed to approve claim');
    }

    const clearUpdate: Record<string, unknown> = {};
    if (claimType === 'twitter') {
      clearUpdate.twitterFollowPending = false;
    } else {
      clearUpdate.telegramJoinPending = false;
    }
    await updatePendingSocialClaims(targetWallet, clearUpdate);

    return sendSuccess(c, { approved: true });
  });

  app.get('/api/admin/social/pending', async (c) => {
    await validatePoofAuth(c, true);

    const allPending = await getAllPendingSocialClaims();
    const filtered = allPending.filter(
      (p) => p.twitterFollowPending || p.telegramJoinPending
    );

    return sendSuccess(c, { claims: filtered });
  });

  // ── Admin Analytics Route ────────────────────────────────────────────────
  // Returns trading platform metrics for a given time range.
  // Uses tarobase_created_at on phoenixTrader (no explicit createdAt field)
  // and createdAt on phoenixTradeRecord (set by the backend at record write time).
  // Trading Volume combines:
  //   - Cross-margin: phoenixTradeRecord.sizeUsd, filtered by createdAt >= cutoff
  //   - Isolated-margin: phoenixIsoTrade.sizeUsd, filtered in JS by tarobase_created_at >= cutoff
  //     (phoenixIsoTrade is a frontend-signed onchain passthrough with no explicit createdAt)
  app.get('/api/admin/analytics', async (c) => {
    const { walletAddress: _adminWallet } = await validatePoofAuth(c, true);

    // Parse and validate range param
    const rangeParam = c.req.query('range') ?? '7d';
    const RANGE_SECONDS: Record<string, number> = {
      '24h': 86400,
      '7d': 604800,
      '1m': 2592000,
      '3m': 7776000,
      '6m': 15552000,
      '1y': 31536000,
    };
    const rangeSeconds = RANGE_SECONDS[rangeParam] ?? RANGE_SECONDS['7d'];
    const effectiveRange = RANGE_SECONDS[rangeParam] ? rangeParam : '7d';
    const cutoffSeconds = Math.floor(Date.now() / 1000) - rangeSeconds;

    // Fetch all trade records, traders, and iso trades concurrently.
    // Trade records: filter by createdAt >= cutoff (set explicitly by backend at write time).
    // Traders: fetched all at once; we filter for newUsers using tarobase_created_at in JS.
    // Iso trades: fetched all at once; filter by tarobase_created_at in JS (no createdAt field).
    const [allTraders, allTradeRecords, allIsoTrades] = await Promise.all([
      getAllPhoenixTrader(),
      getManyPhoenixTradeRecord(`createdAt >= ${cutoffSeconds}`),
      getAllPhoenixIsoTrade(),
    ]);

    // totalUsers: all registered traders regardless of range
    const totalUsers = allTraders.length;

    // newUsers: traders registered within the range (tarobase_created_at is the only timestamp)
    const newUsers = allTraders.filter(
      (t) => typeof t.tarobase_created_at === 'number' && t.tarobase_created_at >= cutoffSeconds,
    ).length;

    // Build per-wallet trade counts from cross-margin records in range
    // Also bucket by calendar day (UTC) for the daily active traders chart.
    const walletTradeCounts = new Map<string, number>();
    // dayKey -> Set of distinct trader wallets that traded that day
    const dailyWallets = new Map<string, Set<string>>();
    let tradingVolumeCross = 0;

    for (const record of allTradeRecords) {
      const wallet = typeof record.trader === 'string' ? record.trader : '';
      if (!wallet) continue;
      walletTradeCounts.set(wallet, (walletTradeCounts.get(wallet) ?? 0) + 1);
      tradingVolumeCross += typeof record.sizeUsd === 'number' ? record.sizeUsd : 0;

      // Bucket into calendar day (UTC). createdAt is Unix seconds.
      const ts = typeof record.createdAt === 'number' ? record.createdAt : 0;
      if (ts > 0) {
        // Format as YYYY-MM-DD in UTC
        const d = new Date(ts * 1000);
        const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        if (!dailyWallets.has(dayKey)) dailyWallets.set(dayKey, new Set());
        dailyWallets.get(dayKey)!.add(wallet);
      }
    }

    // Build a dense day-by-day series over the selected range so the chart
    // has a data point for every day (zero-filling days with no trades).
    // For ranges ≤ 30 days we enumerate every calendar day; for longer ranges
    // we still enumerate every day — the frontend can decide how to render.
    const nowMs = Date.now();
    const dailyActiveTraders: { date: string; count: number }[] = [];
    // Walk from the cutoff day to today (UTC), inclusive on both ends.
    const startDayMs = new Date(cutoffSeconds * 1000);
    // Normalise to midnight UTC of the cutoff day
    const startMidnightMs = Date.UTC(
      startDayMs.getUTCFullYear(),
      startDayMs.getUTCMonth(),
      startDayMs.getUTCDate(),
    );
    const MS_PER_DAY = 86400_000;
    for (let dayMs = startMidnightMs; dayMs <= nowMs; dayMs += MS_PER_DAY) {
      const d = new Date(dayMs);
      const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      dailyActiveTraders.push({
        date: dayKey,
        count: dailyWallets.get(dayKey)?.size ?? 0,
      });
    }

    // Isolated-margin volume: filter in JS by tarobase_created_at (no explicit createdAt field)
    let tradingVolumeIsolated = 0;
    for (const isoTrade of allIsoTrades) {
      if (
        typeof isoTrade.tarobase_created_at === 'number' &&
        isoTrade.tarobase_created_at >= cutoffSeconds
      ) {
        tradingVolumeIsolated += typeof isoTrade.sizeUsd === 'number' ? isoTrade.sizeUsd : 0;
      }
    }

    // Combined volume for the headline number
    const tradingVolume = tradingVolumeCross + tradingVolumeIsolated;

    // activeTraders: unique wallets with any trade in range (cross-margin only, per scope)
    const activeTraders = walletTradeCounts.size;

    // returningUsers: wallets with more than 1 trade in range (cross-margin only, per scope)
    let returningUsers = 0;
    for (const count of walletTradeCounts.values()) {
      if (count > 1) returningUsers++;
    }

    return sendSuccess(c, {
      range: effectiveRange,
      totalUsers,
      newUsers,
      activeTraders,
      returningUsers,
      tradingVolume,
      tradingVolumeCross,
      tradingVolumeIsolated,
      dailyActiveTraders,
    });
  });

  // ── Image Proxy Route ────────────────────────────────────────────────────
  // Fetches a Tarobase public S3 image server-side (no CORS restriction) and
  // streams it back. This solves the problem where custom domains (e.g.
  // aeonian.trade) are not in the S3 bucket's CORS allowlist, causing
  // fetch(..., { mode: 'cors' }) in share-card modals to throw.
  //
  // SSRF protection: only allows fetching from Tarobase public storage hosts
  // (hostnames ending in .amazonaws.com AND containing tarobase-app-storage-public).
  app.get('/api/image-proxy', async (c) => {
    const urlParam = c.req.query('url');
    if (!urlParam) return ApiErrors.badRequest(c, 'Missing url parameter');

    // Parse and validate the URL — reject anything that is not a Tarobase public S3 asset
    let parsed: URL;
    try {
      parsed = new URL(urlParam);
    } catch {
      return ApiErrors.badRequest(c, 'Invalid url parameter');
    }

    const { hostname } = parsed;
    // Strict allowlist — only well-known hosts the app actually uses for images.
    // Extend here (never open to arbitrary hosts — SSRF risk).
    const isAllowed =
      // Tarobase public S3 assets
      (hostname.endsWith('.amazonaws.com') && hostname.includes('tarobase-app-storage-public')) ||
      // CoinGecko token logos
      hostname === 'assets.coingecko.com' ||
      hostname === 'coin-images.coingecko.com' ||
      // Solana token-list / community logos (raw GitHub / githack CDN)
      hostname === 'raw.githubusercontent.com' ||
      hostname === 'raw.githack.com';

    if (!isAllowed) {
      return ApiErrors.badRequest(c, 'URL host not allowed');
    }

    try {
      const upstream = await fetch(urlParam);
      if (!upstream.ok) {
        return ApiErrors.internal(c, `Upstream returned ${upstream.status}`);
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const body = upstream.body;

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      return ApiErrors.internal(c, 'Failed to fetch upstream image');
    }
  });

  // ── Promotion Submit Route ───────────────────────────────────────────────────
  //
  // The browser can no longer write promotionClaims directly (policy now requires the
  // PROJECT_VAULT_ADDRESS writer). This route is the SOLE authority: it signs as the
  // vault, enforces the 24h resubmit cooldown server-side, and enforces the cross-wallet
  // duplicate-link guard via the promotionLinkRegistry.
  app.post('/api/promotion/submit', async (c) => {
    const { walletAddress } = await validatePoofAuth(c);

    let body: { link?: unknown };
    try {
      body = (await c.req.json()) as { link?: unknown };
    } catch {
      return ApiErrors.badRequest(c, 'Invalid request body.');
    }

    const rawLink = typeof body.link === 'string' ? body.link.trim() : '';
    if (!rawLink) {
      return ApiErrors.badRequest(c, 'Please enter a promotion link.');
    }

    // Normalize + validate (throws on non-http(s) / unparseable URLs).
    let normalized: string;
    try {
      normalized = normalizePromotionLink(rawLink);
    } catch {
      return ApiErrors.badRequest(c, 'Please enter a valid http(s) link.');
    }

    const linkHash = await hashNormalizedLink(normalized);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const COOLDOWN_SECS = 24 * 3600;

    try {
      // 1) Existing claim → enforce 24h cooldown server-side.
      const existingClaim = await getPromotionClaims(walletAddress);
      if (existingClaim) {
        const meta = existingClaim as unknown as {
          tarobase_updated_at?: number;
          tarobase_created_at?: number;
        };
        const lastWriteSec =
          meta.tarobase_updated_at ||
          meta.tarobase_created_at ||
          existingClaim.updatedAt ||
          existingClaim.createdAt ||
          0;
        const elapsed = nowSeconds - lastWriteSec;
        if (lastWriteSec > 0 && elapsed < COOLDOWN_SECS) {
          const remaining = COOLDOWN_SECS - elapsed;
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.ceil((remaining % 3600) / 60);
          const human = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          return ApiErrors.badRequest(
            c,
            `You can submit again in ~${human}.`
          );
        }
      }

      // 2) Core duplicate-link check against the registry.
      const existingRegistry = await getPromotionLinkRegistry(linkHash);
      if (existingRegistry && existingRegistry.owner !== walletAddress) {
        return ApiErrors.badRequest(
          c,
          'This promotion link has already been submitted by another user.'
        );
      }

      // 3) If the caller previously submitted a DIFFERENT link, free the old registry entry.
      if (existingClaim && existingClaim.link) {
        try {
          const oldNormalized = normalizePromotionLink(existingClaim.link);
          const oldHash = await hashNormalizedLink(oldNormalized);
          if (oldHash !== linkHash) {
            await deletePromotionLinkRegistry(oldHash);
          }
        } catch {
          // Old link was unparseable — nothing to release.
        }
      }

      // 4) Reserve the new link for this wallet.
      const reserved = await setPromotionLinkRegistry(linkHash, {
        link: normalized,
        owner: Address.publicKey(walletAddress),
        createdAt: nowSeconds,
      });
      if (!reserved) {
        return ApiErrors.internal(c, 'Could not reserve the promotion link. Please try again.');
      }

      // 5) Write the claim. Store the ORIGINAL submitted link so users see their real link.
      let written: boolean;
      if (existingClaim) {
        // Resubmit → partial update of mutable fields ONLY (do not re-send
        // userAddress/createdAt/pointsAwarded — immutable, would silently fail).
        written = await updatePromotionClaims(walletAddress, {
          link: rawLink,
          status: 'pending',
          updatedAt: nowSeconds,
        });
      } else {
        written = await setPromotionClaims(walletAddress, {
          userAddress: Address.publicKey(walletAddress),
          link: rawLink,
          status: 'pending',
          pointsAwarded: 1000,
          createdAt: nowSeconds,
          updatedAt: nowSeconds,
        });
      }

      if (!written) {
        return ApiErrors.internal(c, 'Could not submit your promotion. Please try again.');
      }

      return sendSuccess(c, {
        status: 'pending',
        link: rawLink,
        submittedAt: nowSeconds,
      });
    } catch {
      return ApiErrors.internal(c, 'Something went wrong submitting your promotion.');
    }
  });

  // ── Monthly Prize Pot Announce ───────────────────────────────────────────────
  // Admin-only. Called by the admin UI after EVERY successful deposit; the backend
  // decides whether this is the pot's FIRST deposit and only fans out then. Repeat
  // calls are idempotent no-ops so they never re-spam traders.
  app.post('/api/monthly-pot/announce', async (c) => {
    // 1. Admin only.
    await validatePoofAuth(c, true);

    // 2. Validate body.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return ApiErrors.badRequest(c, 'Invalid JSON body.');
    }
    const schema = z.object({
      monthKey: z.string().regex(/^\d{4}_\d{2}$/, 'monthKey must be "YYYY_MM"'),
      potAccountId: z.string().min(1).max(128),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return ApiErrors.badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid request.');
    }
    const { monthKey, potAccountId } = parsed.data;

    // potAccountId must match the deterministic shape for the given monthKey.
    if (potAccountId !== `monthlyPot_${monthKey}`) {
      return ApiErrors.badRequest(c, 'potAccountId does not match monthKey.');
    }

    // 3. First-deposit guard (idempotent): only announce when EXACTLY one deposit
    //    exists for this pot. Zero → too early (shouldn't happen post-deposit);
    //    more than one → already past the first deposit, no-op so we never re-spam.
    let depositCount = 0;
    try {
      // potAccountId is a server-built deterministic string (validated above to be
      // `monthlyPot_<YYYY_MM>`), so interpolating it here has no injection surface.
      const deposits = await getManyMonthlyRewardDeposit(`where potAccountId = '${potAccountId}'`);
      depositCount = (deposits ?? []).length;
    } catch (err) {
      console.error('[monthly-pot/announce] failed reading deposits:', err);
      return ApiErrors.internal(c, 'Could not read pot deposits.');
    }

    if (depositCount !== 1) {
      return sendSuccess(c, {
        announced: false,
        reason: depositCount > 1 ? 'not_first_deposit' : 'no_deposit_yet',
        notified: 0,
      });
    }

    // 4. Fan out the announcement to active traders (best-effort; never throws).
    const notified = await notifyPotOpen(monthKey);
    return sendSuccess(c, { announced: true, notified });
  });

  // ── Token Lookup ─────────────────────────────────────────────────────────────
  // Public route: given an SPL mint address, return its on-chain decimals
  // + symbol/name/logo.
  //
  // Strategy: Jupiter v2 search is the primary source — it is always real
  // mainnet regardless of which environment the worker runs in (draft workers
  // have SOLANA_RPC_URL pointing at Poofnet's simulated ledger, not mainnet).
  // Jupiter v2 supports both legacy SPL and Token-2022 mints.
  //
  // If Jupiter v2 doesn't index the token (very new / untraded), we fall back
  // to getParsedAccountInfo against the real Solana mainnet RPC. We try the
  // worker's configured SOLANA_RPC_URL first (Helius on preview/live), then
  // fall back to the public Solana mainnet cluster so draft environments still
  // resolve real mainnet mints even when their SOLANA_RPC_URL is Poofnet.
  app.get('/api/token/lookup', async (c) => {
    const mint = (c.req.query('mint') ?? '').trim();
    if (!mint || !SOLANA_ADDRESS_RE.test(mint)) {
      return ApiErrors.badRequest(c, 'Invalid or missing mint address.');
    }

    let decimals: number | null = null;
    let symbol: string | null = null;
    let name: string | null = null;
    let logoUri: string | null = null;

    // ── Step 1: Jupiter v2 (primary, always real mainnet) ──────────────────
    const jupUrl = `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`;
    const jupHeaders = { accept: 'application/json' };

    const tryJupiter = async (): Promise<boolean> => {
      const jupRes = await fetch(jupUrl, {
        headers: jupHeaders,
        signal: AbortSignal.timeout(5000),
      });
      if (!jupRes.ok) {
        console.warn(`[token/lookup] Jupiter returned ${jupRes.status} for ${mint}`);
        return false;
      }
      const jupData = await jupRes.json() as unknown;
      // v2/search returns an array; find the exact mint match.
      const arr = Array.isArray(jupData) ? jupData : [];
      const token = arr.find(
        (t: Record<string, unknown>) => t.id === mint || t.mint === mint,
      ) as Record<string, unknown> | undefined;
      if (token && typeof token.decimals === 'number') {
        decimals = token.decimals;
        symbol = typeof token.symbol === 'string' ? token.symbol : null;
        name = typeof token.name === 'string' ? token.name : null;
        // v2 uses "icon" for logo URL; v1 used "logoURI".
        logoUri =
          (typeof token.icon === 'string' ? token.icon : null) ??
          (typeof token.logoURI === 'string' ? token.logoURI : null);
        return true;
      }
      return false;
    };

    try {
      const jupOk = await tryJupiter();
      if (!jupOk && decimals === null) {
        // Retry once after a short backoff before falling through to RPC.
        await new Promise((r) => setTimeout(r, 400));
        await tryJupiter();
      }
    } catch (err) {
      // Timeout or network error — fall through to RPC.
      console.warn(`[token/lookup] Jupiter fetch failed for ${mint}:`, err instanceof Error ? err.message : String(err));
    }

    // ── Step 2: RPC fallback (real mainnet) ────────────────────────────────
    // Only needed if Jupiter v2 didn't resolve decimals (token not indexed).
    // We attempt up to two RPC endpoints:
    //   a) SOLANA_RPC_URL from env — Helius mainnet on preview/live; may be
    //      Poofnet on draft (will return value: null for real mainnet mints).
    //   b) Public Solana mainnet cluster — always real mainnet, rate-limited
    //      but fine for low-frequency admin lookups.
    if (decimals === null) {
      const rpcCandidates: string[] = [];
      const envRpc = (c.env as Record<string, string>).SOLANA_RPC_URL;
      if (envRpc) rpcCandidates.push(envRpc);
      rpcCandidates.push('https://api.mainnet-beta.solana.com');

      const rpcBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getParsedAccountInfo',
        params: [mint, { encoding: 'jsonParsed' }],
      });

      for (const rpcUrl of rpcCandidates) {
        if (decimals !== null) break;
        try {
          const rpcRes = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: rpcBody,
            signal: AbortSignal.timeout(5000),
          });
          if (!rpcRes.ok) continue;
          const rpcJson = await rpcRes.json() as Record<string, unknown>;
          const result = rpcJson?.result as Record<string, unknown> | undefined;
          const value = result?.value as Record<string, unknown> | undefined;
          if (!value) continue; // account not found on this RPC (e.g. Poofnet)
          const data = value.data as Record<string, unknown> | undefined;
          // jsonParsed path (legacy SPL + Token-2022 on supported RPCs).
          const parsed = data?.parsed as Record<string, unknown> | undefined;
          const info = parsed?.info as Record<string, unknown> | undefined;
          if (typeof info?.decimals === 'number') {
            decimals = info.decimals;
            // RPC doesn't return symbol/name/logo — those stay null.
          }
        } catch {
          // This RPC unreachable — try next.
        }
      }
    }

    if (decimals === null) {
      return ApiErrors.notFound(c, 'That address is not a valid SPL token mint.');
    }

    c.header('Cache-Control', 'public, max-age=86400');
    return sendSuccess(c, {
      mint,
      decimals,
      symbol,
      name,
      logoUri,
    });
  });

  // ── Trading News RSS ──────────────────────────────────────────────────────────
  app.get('/api/news/trading', async (c) => {
    const now = Date.now();
    if (tradingNewsCache && now < tradingNewsCache.expiresAt) {
      return sendSuccess(c, { items: tradingNewsCache.items });
    }

    const feeds: Array<{ url: string; source: string }> = [
      { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
      { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', source: 'WSJ Markets' },
    ];

    const parseItems = (xml: string, source: string): TradingNewsItem[] => {
      const items: TradingNewsItem[] = [];
      // Extract all <item> blocks
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
      let m: RegExpExecArray | null;
      while ((m = itemRegex.exec(xml)) !== null) {
        const block = m[1];
        const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const linkMatch = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)
          || block.match(/<link\s+[^>]*href="([^"]+)"/i);
        const dateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)
          || block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
        const title = titleMatch?.[1]?.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const link = linkMatch?.[1]?.trim();
        const pubDate = dateMatch?.[1]?.trim() ?? '';
        if (title && link) {
          items.push({ title, link, pubDate, source });
        }
      }
      return items;
    };

    const allItems: TradingNewsItem[] = [];
    for (const feed of feeds) {
      try {
        const resp = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AEONIAN/1.0)' },
          signal: AbortSignal.timeout(6_000),
        });
        if (resp.ok) {
          const xml = await resp.text();
          allItems.push(...parseItems(xml, feed.source));
        }
      } catch {
        // Ignore individual feed errors — just skip that feed
      }
    }

    // Sort by pubDate desc (most recent first), take top 12
    allItems.sort((a, b) => {
      const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return tb - ta;
    });
    const items = allItems.slice(0, 12);

    tradingNewsCache = { items, expiresAt: now + TRADING_NEWS_TTL_MS };
    return sendSuccess(c, { items });
  });

  // ── OAuth Routes ─────────────────────────────────────────────────────────────
  app.get('/api/oauth/callback', oauthCallbackHandler);
  app.get('/api/social-links/:provider', getSocialLinkHandler);
  app.delete('/api/social-links/:provider', deleteSocialLinkHandler);
}
