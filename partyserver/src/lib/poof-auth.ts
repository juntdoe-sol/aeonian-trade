/**
 * Poof Authentication Utilities
 *
 * Provides secure authentication validation for Poof ID tokens
 * and wallet address verification for protected API endpoints.
 *
 * Note: Internal references to "Tarobase" refer to Poof's authentication service.
 */

import type { Context } from 'hono';
import * as jose from 'jose';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID, TAROBASE_SESSION_API_URL } from './config.js';
import { formatError } from './api-response.js';

/**
 * Error types for authentication failures
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * AWS Cognito User Pool ID (public information)
 * This is used to verify JWT tokens from Cognito for normal user authentication
 */

/**
 * JWKS cache duration (1 hour in seconds)
 */
const JWKS_CACHE_DURATION = 3600;

/**
 * Validates Poof authentication from request headers.
 *
 * For admin routes: Validates via Session API verify-admin endpoint
 * For normal routes: Validates via Cognito ID token verification using public User Pool ID
 * Use at the start of protected routes that require authentication.
 *
 * @param c - Hono context with request headers
 * @param isAdminRoute - If true, requires admin access to the Poof app
 * @returns Validated wallet address and token
 * @throws AuthenticationError on validation failure
 *
 * @example
 * ```typescript
 * const { walletAddress } = await validatePoofAuth(c);
 * const { walletAddress } = await validatePoofAuth(c, true); // For admin routes
 * ```
 *
 * Required headers:
 * - `Authorization: Bearer <poofIdToken>`
 * - `X-Wallet-Address: <walletAddress>`
 */
export async function validatePoofAuth(
  c: Context,
  isAdminRoute?: boolean,
): Promise<{
  walletAddress: string;
  poofIdToken: string;
}> {
  const { walletAddress, poofIdToken } = getAuthenticatedUser(c);

  try {
    if (isAdminRoute) {
      // Admin verification: Use Session API with verify-admin endpoint
      // Try the app's own TAROBASE_APP_ID first. If that fails and POOF_MASTER_APP_ID
      // is configured, retry with Poof's platform appId (for requests from Poof chat/API explorer).
      let verifyResponse = await sessionApi({
        url: 'verify-admin',
        method: 'POST',
        token: poofIdToken,
        body: {
          appId: process.env.TAROBASE_APP_ID
        }
      });

      if (!verifyResponse.isAdmin && process.env.POOF_MASTER_APP_ID && process.env.POOF_ADMIN_ADDRESSES) {
        // Fallback: verify the user's token is valid (normal auth) against Poof's master appId,
        // then check their wallet address is in the allowed admin addresses list.
        const masterVerify = await verifyCognitoToken(poofIdToken, walletAddress, process.env.POOF_MASTER_APP_ID);
        if (masterVerify.valid) {
          const allowedAddresses = process.env.POOF_ADMIN_ADDRESSES.split(',').map(a => a.trim().toLowerCase());
          if (allowedAddresses.includes(walletAddress.toLowerCase())) {
            return { walletAddress, poofIdToken };
          }
        }
      }

      // Response should indicate admin status
      if (!verifyResponse.isAdmin) {
        throw new AuthenticationError('Admin access required');
      }

      if (verifyResponse.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new AuthenticationError('Token address does not match provided wallet address');
      }
    } else {
      // Normal user verification: Use Cognito ID token verification
      const expectedAppId = process.env.TAROBASE_APP_ID;
      const verifyResult = await verifyCognitoToken(poofIdToken, walletAddress, expectedAppId);

      if (!verifyResult.valid) {
        throw new AuthenticationError('Invalid Poof token');
      }

      if (verifyResult.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new AuthenticationError('Token address does not match provided wallet address');
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    console.error('Poof token validation failed:', formatError(error));
    throw new AuthenticationError('Invalid Poof token');
  }

  return {
    walletAddress,
    poofIdToken,
  };
}


/**
 * Calls Poof Session API for admin verification
 */
export async function sessionApi(params: {
  body?: Record<string, unknown>;
  method: string;
  token: string;
  url?: string;
  headers?: Record<string, string>;
}) {
  const { url = '', body, method, token, headers } = params;

  try {
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const response = await fetch(`${TAROBASE_SESSION_API_URL}/${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Session API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(text);
    }
  } catch (error) {
    console.error('Error calling Poof Session API:', formatError(error));
    throw error;
  }
}

/**
 * Gets Cognito JWKS (JSON Web Key Set) for token verification
 * Uses Cloudflare Cache API to persist across worker invocations
 */
async function getCognitoJwks(): Promise<jose.JSONWebKeySet> {
  // Extract region from User Pool ID (format: region_poolId)
  const region = COGNITO_USER_POOL_ID.split('_')[0];
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`;

  try {
    // Try to get from Cloudflare cache first
    const cache = await caches.open('poof-auth-jwks');
    let response = await cache.match(jwksUrl);

    if (!response) {
      // Cache miss - fetch from Cognito
      response = await fetch(jwksUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
      }

      // Clone response to cache it (response body can only be read once)
      const responseToCache = response.clone();

      // Create a new response with cache headers
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: {
          ...Object.fromEntries(responseToCache.headers.entries()),
          'Cache-Control': `public, max-age=${JWKS_CACHE_DURATION}`,
        },
      });

      // Store in cache (fire and forget)
      await cache.put(jwksUrl, cachedResponse);
    }

    const jwks = await response.json() as jose.JSONWebKeySet;
    return jwks;
  } catch (error) {
    console.error('Error fetching Cognito JWKS:', formatError(error));
    throw new AuthenticationError('Failed to verify token');
  }
}

/**
 * Verifies Cognito ID token for normal user authentication
 * Only uses public information (User Pool ID) for verification
 */
async function verifyCognitoToken(idToken: string, walletAddress: string, expectedAppId?: string): Promise<{
  valid: boolean;
  walletAddress?: string;
}> {
  try {
    // Get JWKS for verification
    const jwks = await getCognitoJwks();
    const JWKS = jose.createLocalJWKSet(jwks);

    // Extract region from User Pool ID
    const region = COGNITO_USER_POOL_ID.split('_')[0];
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

    // Verify token signature and claims
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer,
      audience: COGNITO_CLIENT_ID,
    });

    // Extract wallet address from token claims
    const tokenWalletAddress = (payload['custom:walletAddress'] as string)

    if (!tokenWalletAddress) {
      console.error('Wallet address not found in token claims');
      return { valid: false };
    }

    // Verify wallet address matches
    if (tokenWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      console.error('Token wallet address does not match provided wallet address');
      return { valid: false };
    }

    // Verify appId if expected
    if (expectedAppId) {
      const tokenAppId = payload['custom:appId'] as string;
      if (!tokenAppId) {
        console.error('AppId not found in token claims');
        return { valid: false };
      }
      if (tokenAppId !== expectedAppId) {
        console.error('Token appId does not match expected appId');
        return { valid: false };
      }
    }

    return {
      valid: true,
      walletAddress: tokenWalletAddress,
    };
  } catch (error) {
    console.error('Cognito token verification failed:', formatError(error));
    return { valid: false };
  }
}

/**
 * Helper function to extract authenticated user data from request
 *
 * @param c - Hono context object
 * @returns { walletAddress: string; poofIdToken: string }
 */
export function getAuthenticatedUser(c: Context): {
  walletAddress: string;
  poofIdToken: string;
} {
  const authHeader = c.req.header('Authorization');
  const walletAddress = c.req.header('X-Wallet-Address');

  if (!authHeader || !walletAddress) {
    throw new AuthenticationError('Authentication data not found in request');
  }

  return {
    walletAddress,
    poofIdToken: authHeader.substring(7), // Remove "Bearer " prefix
  };
}
