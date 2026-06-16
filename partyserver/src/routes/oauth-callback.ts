/**
 * OAuth Callback Route
 *
 * This route handles OAuth callbacks from Poof's OAuth service.
 * When a user completes OAuth with a provider (Twitter, Google, etc.),
 * Poof redirects back here with a signed JWT containing the connection data.
 *
 * To enable this route:
 * 1. Uncomment the import and registration in routes/index.ts
 * 2. Customize the logic below (optional)
 * 3. Deploy your app
 *
 * The route will:
 * 1. Verify the JWT signature (proves it came from Poof)
 * 2. Store the social connection in your database
 * 3. Run any custom logic you add (airdrops, welcome messages, etc.)
 * 4. Redirect back to your frontend
 */

import { set } from '@pooflabs/server';
import type { Context } from 'hono';
import { OAUTH_STORAGE_PATH } from '../lib/config.js';
import { initializeCORS, isLocalhostOrigin, isOriginAllowed } from '../lib/cors-helpers.js';
import { verifyPoofOAuthToken, type PoofOAuthPayload } from '../lib/poof-oauth.js';

/**
 * STORAGE SCHEMA - ONLY these 4 fields are allowed by the Tarobase policy.
 * Adding ANY other fields (tokens, iat, exp, iss, etc.) will cause:
 *   "Document contains invalid value for key: <fieldname>"
 * DO NOT add fields here without updating the Tarobase policy first.
 */
interface SocialLinkRecord {
  wallet: string;
  provider: string;
  profile: string;   // MUST be JSON.stringify'd - policy type is "String"
  linkedAt: number;  // Unix timestamp in ms - policy type is "Int"
}

/**
 * Build a storage-safe record from the OAuth payload.
 * Extracts ONLY the 4 fields permitted by the Tarobase policy.
 * Never spread the full payload - it contains tokens, iat, exp, iss
 * which will be rejected by the policy.
 */
function buildSocialLinkRecord(payload: PoofOAuthPayload): SocialLinkRecord {
  return {
    wallet: payload.wallet,
    provider: payload.provider,
    profile: JSON.stringify({
      id: payload.profile.id,
      username: payload.profile.username,
      email: payload.profile.email,
      avatar: payload.profile.avatar,
      displayName: payload.profile.displayName,
      metadata: payload.profile.metadata,
    }),
    linkedAt: Date.now(),
  };
}

/**
 * Validate redirect URL for OAuth callback.
 *
 * SECURITY: Only allows redirects to domains in the CORS allowlist.
 * This prevents open redirect attacks that could lead to phishing.
 *
 * TO ADD ALLOWED REDIRECT DOMAINS:
 * - Add custom domains via poof's domain management UI (recommended)
 * - Or set CORS_PROD_DOMAINS env var: CORS_PROD_DOMAINS=myapp.com,other.com
 * - Localhost is always allowed for development
 */
const corsConfig = initializeCORS();

function isAllowedRedirect(url: URL): boolean {
  // Allow localhost for development (any port, http or https)
  if (corsConfig.allowLocalhostOrigins && isLocalhostOrigin(url.origin)) {
    return true;
  }

  // Require HTTPS for production
  if (url.protocol !== 'https:') {
    return false;
  }

  // Check against CORS allowlist (same domains trusted for API access)
  return isOriginAllowed(url.origin, corsConfig);
}

/**
 * Get validated redirect URL from request, with logging for blocked domains.
 * Falls back to request origin if redirect is not allowed.
 */
function getValidatedRedirectUrl(redirectParam: string | undefined, requestUrl: string): URL {
  if (redirectParam) {
    try {
      const url = new URL(redirectParam);
      if (isAllowedRedirect(url)) {
        return url;
      }
      // Domain not in CORS allowlist - log for debugging
      console.warn(
        `[OAuth] Redirect blocked: "${url.hostname}" not in allowed domains. ` +
        `Allowed: [${corsConfig.allowedOrigins.join(', ')}]. ` +
        `To fix: Add domain via poof's domain UI, or set CORS_PROD_DOMAINS=${url.hostname}`
      );
    } catch {
      // Invalid URL format
    }
  }
  return new URL('/', requestUrl);
}

export async function oauthCallbackHandler(c: Context) {
  let token = c.req.query('token');
  const otp = c.req.query('otp');
  const provider = c.req.query('provider');

  // v2: exchange one-time OTP for JWT (token never appears in URL)
  if (otp && !token) {
    try {
      const response = await fetch('https://poof-apps-oauth.buildwithtarobase.workers.dev/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp }),
      });

      if (!response.ok) {
        console.error('OAuth OTP exchange failed:', response.status);
        const redirectUrl = getValidatedRedirectUrl(c.req.query('redirect'), c.req.url);
        redirectUrl.searchParams.set('oauth_error', 'true');
        redirectUrl.searchParams.set('message', 'code_exchange_failed');
        return c.redirect(redirectUrl.toString());
      }

      const data: { token: string } = await response.json();
      token = data.token;
    } catch (error) {
      console.error('OAuth OTP exchange error:', error);
      const redirectUrl = getValidatedRedirectUrl(c.req.query('redirect'), c.req.url);
      redirectUrl.searchParams.set('oauth_error', 'true');
      redirectUrl.searchParams.set('message', 'code_exchange_failed');
      return c.redirect(redirectUrl.toString());
    }
  }

  // Validate required parameters
  if (!token) {
    console.error('OAuth callback missing token and otp parameters');
    return c.redirect('/?error=missing_token');
  }

  if (!provider) {
    console.error('OAuth callback missing provider parameter');
    return c.redirect('/?error=missing_provider');
  }

  try {
    const payload = verifyPoofOAuthToken(token);

    if (payload.provider !== provider) {
      throw new Error('Provider mismatch');
    }

    const storageKey = `social:${payload.wallet}:${provider}`;

    await set(`${OAUTH_STORAGE_PATH}/${storageKey}`, buildSocialLinkRecord(payload));

    await handleOAuthSuccess(payload);

    // Get validated redirect URL (falls back to origin if domain not allowed)
    const redirectUrl = getValidatedRedirectUrl(c.req.query('redirect'), c.req.url);
    redirectUrl.searchParams.set('oauth_success', 'true');
    redirectUrl.searchParams.set('provider', provider);

    return c.redirect(redirectUrl.toString());
  } catch (error) {
    // Detect Tarobase policy schema violations (e.g. storing fields not in the policy)
    if (error instanceof Error && error.message.includes('invalid value for key')) {
      console.error(
        `[OAuth] Tarobase policy schema error: ${error.message}. ` +
        `Only 4 fields are allowed: wallet, provider, profile (String), linkedAt (Int). ` +
        `If you added fields, update the Tarobase policy first.`
      );
    }

    // Get validated redirect URL (falls back to origin if domain not allowed)
    const redirectUrl = getValidatedRedirectUrl(c.req.query('redirect'), c.req.url);
    redirectUrl.searchParams.set('oauth_error', 'true');
    // Sanitize error message for the frontend - don't leak internal details
    const errorMessage = error instanceof Error
      ? (error.message.includes('expired') ? 'session_expired'
        : error.message.includes('signature') ? 'verification_failed'
        : error.message.includes('mismatch') ? 'provider_mismatch'
        : 'connection_failed')
      : 'unknown_error';
    redirectUrl.searchParams.set('message', errorMessage);
    return c.redirect(redirectUrl.toString());
  }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOM LOGIC - Modify this function to add your own behavior
// ═══════════════════════════════════════════════════════════════

/**
 * WARNING: Do NOT store data in Tarobase inside this function without
 * creating a separate policy collection for it first. The social-links
 * policy only allows the 4 fields in SocialLinkRecord. Writing arbitrary
 * data to Tarobase without a matching policy will fail silently or throw.
 */
async function handleOAuthSuccess(payload: PoofOAuthPayload): Promise<void> {
  // Add custom logic here (airdrops, webhooks, etc.)
}
