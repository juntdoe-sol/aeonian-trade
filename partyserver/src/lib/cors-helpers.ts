// ═══════════════════════════════════════════════════════════════
// CORS Configuration and Middleware Utilities
//
// Poof has three deployment tiers, each with its own frontend domain:
//   - Draft (ENV=PREVIEW):          <slug>-preview.poof.new         → uses CORS_DEV_DOMAINS
//   - Mainnet Preview (ENV=LIVE):   <slug>-mainnet-preview.poof.new → uses CORS_PROD_DOMAINS
//   - Live (ENV=LIVE):              <slug>.poof.new + custom domains → uses CORS_PROD_DOMAINS
//
// CORS domains are computed during deployment by corsManager.ts and injected
// into wrangler.toml as CORS_DEV_DOMAINS and CORS_PROD_DOMAINS.
//
// CORS_PROD_DOMAINS includes both <slug>.poof.new AND <slug>-mainnet-preview.poof.new
// so both live and mainnet-preview frontends can call the production-like API.
// ═══════════════════════════════════════════════════════════════

import { Context, Next } from 'hono';

/**
 * CORS configuration options for different environments
 */
export interface CORSConfig {
  /** List of allowed origins for CORS */
  allowedOrigins: string[];
  /** HTTP methods to allow */
  allowedMethods: string[];
  /** Headers to allow in requests */
  allowedHeaders: string[];
  /** Headers to expose to the client */
  exposedHeaders: string[];
  /** Whether to allow credentials */
  allowCredentials: boolean;
  /** Whether to allow localhost origins on any port */
  allowLocalhostOrigins: boolean;
  /** Max age for preflight cache */
  maxAge: number;
}

/**
 * Default CORS configuration
 */
export const DEFAULT_CORS_CONFIG: CORSConfig = {
  allowedOrigins: [], // Will be populated by environment
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'X-Request-ID',
    'X-Wallet-Address',
    'x-api-key',
    'x-schedule-id',
    'x-tarobase-app-id',
  ],
  exposedHeaders: ['X-Request-ID', 'X-Rate-Limit-Remaining'],
  allowCredentials: true,
  allowLocalhostOrigins: false,
  maxAge: 86400, // 24 hours
};

/**
 * Generate CORS configuration based on environment and custom domains
 */
export function generateCORSConfig(
  environment: 'development' | 'production',
  customDomains: string[] = [],
  overrides: Partial<CORSConfig> = {},
): CORSConfig {
  const isDevelopment = environment === 'development';
  const commonOrigins = isDevelopment
    ? [
        // Localhost origins are matched by hostname so any port is allowed.
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'https://localhost:3000',
        'https://localhost:3001',
      ]
    : [];

  // Convert custom domains to full URLs (http only allowed in development)
  const customOrigins = customDomains.flatMap((domain) => [
    `https://${domain}`,
    ...(isDevelopment ? [`http://${domain}`] : []),
  ]);

  // Combine all origins
  const allOrigins = [...commonOrigins, ...customOrigins];

  return {
    ...DEFAULT_CORS_CONFIG,
    allowedOrigins: allOrigins,
    allowLocalhostOrigins: isDevelopment,
    ...overrides,
  };
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOCALHOST_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Check if an origin is allowed based on the CORS config
 */
export function isOriginAllowed(origin: string | null, config: CORSConfig): boolean {
  if (!origin) return false;

  if (config.allowLocalhostOrigins && isLocalhostOrigin(origin)) {
    return true;
  }

  // Check exact matches
  if (config.allowedOrigins.includes(origin)) {
    return true;
  }

  return false;
}

// Cached CORS config - initialized lazily on first request
let cachedCORSConfig: CORSConfig | null = null;

/**
 * Get or initialize CORS config (lazy initialization to ensure process.env is populated)
 *
 * IMPORTANT: This must be lazy because Cloudflare Workers don't populate process.env
 * until the first request comes in, even with nodejs_compat_populate_process_env flag.
 */
function getOrInitCORSConfig(providedConfig?: CORSConfig): CORSConfig {
  if (providedConfig && providedConfig !== DEFAULT_CORS_CONFIG) {
    return providedConfig;
  }
  if (!cachedCORSConfig) {
    cachedCORSConfig = initializeCORS();
  }
  return cachedCORSConfig;
}

/**
 * CORS middleware for Hono
 */
export function corsMiddleware(config?: CORSConfig) {
  return async (c: Context, next: Next) => {
    // Lazy initialization - ensures process.env is populated in Cloudflare Workers
    const effectiveConfig = getOrInitCORSConfig(config);
    const isWebSocketUpgrade = c.req.header('Upgrade')?.toLowerCase() === 'websocket';

    const origin = c.req.header('Origin');

    // Handle preflight OPTIONS requests
    if (c.req.method === 'OPTIONS') {
      const isAllowed = origin ? isOriginAllowed(origin, effectiveConfig) : false;

      if (origin && isAllowed) {
        c.res.headers.set('Access-Control-Allow-Origin', origin);

        if (effectiveConfig.allowCredentials) {
          c.res.headers.set('Access-Control-Allow-Credentials', 'true');
        }

        c.res.headers.set('Access-Control-Allow-Methods', effectiveConfig.allowedMethods.join(', '));
        c.res.headers.set('Access-Control-Allow-Headers', effectiveConfig.allowedHeaders.join(', '));
        c.res.headers.set('Access-Control-Max-Age', effectiveConfig.maxAge.toString());

        return new Response('', { status: 204 });
      } else {
        console.warn('[CORS] Preflight rejected:', { origin, allowedCount: effectiveConfig.allowedOrigins.length });
        return new Response('CORS preflight failed', { status: 403 });
      }
    }

    await next();

    // WebSocket handshakes do not use CORS response headers, and 101 upgrade
    // responses can be fragile to post-route header mutation.
    if (isWebSocketUpgrade) return;

    // Set CORS headers for actual requests
    const isAllowed = origin ? isOriginAllowed(origin, effectiveConfig) : false;

    if (origin && isAllowed) {
      // Responses returned from Durable Object fetch() (used by the agent
      // framework for /agents/<name>/<session> routes) have immutable
      // headers — mutating them throws "Can't modify immutable headers".
      // Clone into a fresh mutable Response before adding CORS headers.
      const newHeaders = new Headers(c.res.headers);
      newHeaders.set('Access-Control-Allow-Origin', origin);

      if (effectiveConfig.allowCredentials) {
        newHeaders.set('Access-Control-Allow-Credentials', 'true');
      }

      if (effectiveConfig.exposedHeaders.length > 0) {
        newHeaders.set('Access-Control-Expose-Headers', effectiveConfig.exposedHeaders.join(', '));
      }

      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });
    }
  };
}

/**
 * Utility to get CORS domains from environment variables
 */
export function getCORSDomainsFromEnv(): {
  development: string[];
  production: string[];
  taskId?: string;
  appId?: string;
} {
  // These are set during deployment via wrangler.toml [vars]
  const devDomains = process.env.CORS_DEV_DOMAINS?.split(',').filter(Boolean) || [];
  const prodDomains = process.env.CORS_PROD_DOMAINS?.split(',').filter(Boolean) || [];
  const taskId = process.env.CORS_TASK_ID;
  const appId = process.env.CORS_APP_ID;

  return {
    development: devDomains,
    production: prodDomains,
    taskId,
    appId,
  };
}

/**
 * Initialize CORS configuration based on environment
 *
 * Uses ENV variable (PREVIEW/LIVE) to determine which domain list to use:
 *   - ENV=PREVIEW (draft, mainnet-preview) → CORS_DEV_DOMAINS
 *   - ENV=LIVE (production) → CORS_PROD_DOMAINS
 *
 * NOTE: We use ENV instead of NODE_ENV because Cloudflare Workers override
 * NODE_ENV to "production" regardless of wrangler.toml settings.
 */
export function initializeCORS(environment?: 'development' | 'production'): CORSConfig {
  // Use ENV (PREVIEW/LIVE) instead of NODE_ENV since Cloudflare Workers overrides NODE_ENV
  const env = environment || (process.env.ENV === 'LIVE' ? 'production' : 'development');
  const corsInfo = getCORSDomainsFromEnv();

  // For development (draft + mainnet-preview), include task and app specific domains
  const developmentDomains = [
    ...corsInfo.development,
    ...(corsInfo.taskId ? [`${corsInfo.taskId}.poof.new`] : []),
    ...(corsInfo.appId ? [`${corsInfo.appId}.poof.new`] : []),
  ];

  // Select domains based on environment
  const domains = env === 'production' ? corsInfo.production : developmentDomains;

  // Hardcoded custom domains — pinned regardless of Cloud → Domains settings
  const pinnedCustomDomains = ['aeonian.trade', 'www.aeonian.trade', 'xphoenix.trade', 'www.xphoenix.trade'];

  const config = generateCORSConfig(env, [...domains, ...pinnedCustomDomains]);

  return config;
}

/**
 * Route-specific CORS configuration override
 * Use this to customize CORS for specific routes
 */
export function routeCORS(routeOverrides: Partial<CORSConfig>, baseConfig?: CORSConfig) {
  const base = baseConfig || initializeCORS();
  return corsMiddleware({
    ...base,
    ...routeOverrides,
  });
}
