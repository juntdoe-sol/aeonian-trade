// Server-side geo gate for jurisdictionally-restricted on-chain programs.
// Use in any partyserver route that signs a restricted-program tx on the
// user's behalf (vault via createWalletClient, strategy bot, server-mediated
// trade route, admin action, etc.) — those requests don't carry
// Sec-Fetch-Site so Tarobase's own 451 gate doesn't fire for them. This
// helper closes that gap by reading the user's country from the partyserver's
// incoming request (Cloudflare sets cf-ipcountry) and blocking restricted
// jurisdictions before any signing happens.
//
// Currently registered: Phoenix Perps. To gate another program later, add a
// new entry to RESTRICTIONS — the rest of the file is generic and unchanged.
//
// The frontend hook (`useGeoBlocked`) does NOT call this partyserver — it
// hits Tarobase's centralized /geo for the UI banner. The two layers are
// independent reads of the same underlying Cloudflare signal.

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

interface ProgramRestriction {
  programId: string;            // Solana program pubkey (base58)
  errorCode: string;            // matches Tarobase's error_code shape
  envVar: string;               // env var override for the country list
  defaultCountries: string[];   // ISO-2 codes
  label: string;                // human label used in the 451 message
}

const RESTRICTIONS: Record<string, ProgramRestriction> = {
  phoenix: {
    programId: 'EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih',
    errorCode: 'GEO_RESTRICTED_PHOENIX',
    envVar: 'GEO_RESTRICTED_PHOENIX_COUNTRIES',
    defaultCountries: ['US'],
    label: 'Phoenix Perps trading',
  },
};

// Reads the viewer's country from the incoming request. Cloudflare Workers
// set cf-ipcountry on every request and also expose request.cf.country as a
// fallback. Returns uppercase ISO-2 or null if unknown.
export function getViewerCountry(c: Context): string | null {
  const header = c.req.header('cf-ipcountry');
  if (header && header.trim().length > 0) {
    return header.trim().toUpperCase();
  }
  const cfMeta = (c.req.raw as unknown as { cf?: { country?: string } }).cf;
  const cfCountry = cfMeta?.country;
  if (typeof cfCountry === 'string' && cfCountry.trim().length > 0) {
    return cfCountry.trim().toUpperCase();
  }
  return null;
}

function getRestrictedCountries(env: unknown, restriction: ProgramRestriction): Set<string> {
  const raw =
    env && typeof env === 'object'
      ? (env as Record<string, string | undefined>)[restriction.envVar]
      : undefined;
  if (raw && raw.trim().length > 0) {
    return new Set(raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean));
  }
  return new Set(restriction.defaultCountries);
}

export function isProgramBlocked(c: Context, program: string): boolean {
  const restriction = RESTRICTIONS[program];
  if (!restriction) return false;
  const country = getViewerCountry(c);
  if (country == null) return false;
  return getRestrictedCountries(c.env, restriction).has(country);
}

// Drop into any route handler that initiates a restricted-program tx. Throws
// 451 with a structured body mirroring Tarobase's mutate-enforcement shape —
// error_code, blocked_program, country — so frontends can switch on
// error_code uniformly.
//
// 451 is the HTTP-spec status for legal geo-restriction. It is the one and
// only exception to the project's "5 status codes only" rule (200/400/401/404/500);
// don't reach for 451 anywhere else.
export function assertProgramAllowed(c: Context, program: string): void {
  const restriction = RESTRICTIONS[program];
  if (!restriction) return;
  if (!isProgramBlocked(c, program)) return;
  const country = getViewerCountry(c);
  const message = `${restriction.label} is not available in your jurisdiction.`;
  throw new HTTPException(451, {
    message,
    res: c.json(
      {
        success: false,
        error: {
          code: restriction.errorCode,
          message,
          details: { blocked_program: program, country },
        },
        timestamp: Date.now(),
      },
      451,
    ),
  });
}
