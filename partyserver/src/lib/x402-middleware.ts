/**
 * x402 Payment Middleware
 *
 * Global Hono middleware that enforces payment on specific routes using @x402/hono.
 * Applied globally in index.ts but only activates for configured paid routes.
 *
 * Example usage in index.ts:
 * ```typescript
 * import { x402Middleware } from './lib/x402-middleware.js';
 * app.use('*', x402Middleware);
 * ```
 *
 * To protect a route, add it to the paidRoutes object below:
 * ```typescript
 * 'POST /api/generate': {
 *   accepts: {
 *     scheme: 'exact',
 *     network,
 *     payTo: PROJECT_VAULT_ADDRESS,
 *     price: { asset: 'USDC', amount: '100000' }, // $0.10
 *   },
 * },
 * ```
 */

import { paymentMiddlewareFromConfig } from '@x402/hono';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import type { Context, Next } from 'hono';
import * as constants from '../constants';

const PROJECT_VAULT_ADDRESS = (constants as any).PROJECT_VAULT_ADDRESS;

const env = process.env.ENV || 'PREVIEW';
const network = env === 'LIVE'
  ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
  : 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

/**
 * Configure paid routes here. Key format: 'METHOD /path'
 * Amounts are in USDC base units (6 decimals): '100000' = $0.10
 */
const paidRoutes = {
  // Example:
  // 'POST /api/generate': {
  //   accepts: {
  //     scheme: 'exact',
  //     network,
  //     payTo: PROJECT_VAULT_ADDRESS,
  //     price: { asset: 'USDC', amount: '100000' }, // $0.10
  //   },
  // },
} as const;

let _x402Inner: ((c: Context, next: Next) => Promise<Response | void>) | null = null;

export const x402Middleware = Object.keys(paidRoutes).length > 0
  ? async (c: Context, next: Next) => {
      if (!_x402Inner) {
        _x402Inner = paymentMiddlewareFromConfig(
          paidRoutes as any,
          undefined,
          [{ network, server: new ExactSvmScheme() }],
        );
      }
      try {
        return await _x402Inner(c, next);
      } catch (error: any) {
        console.error('[x402] Payment middleware error:', error?.message);
        return c.json(
          { success: false, error: 'Payment processing temporarily unavailable' },
          500,
        );
      }
    }
  : (_c: Context, next: Next) => next();
