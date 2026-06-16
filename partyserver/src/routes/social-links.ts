/**
 * Social Links Routes
 *
 * These routes allow querying and managing linked social accounts.
 * Users can view their connected providers and unlink accounts.
 *
 * To enable these routes:
 * 1. Uncomment the imports and registrations in routes/index.ts
 * 2. Deploy your app
 */

import { get, set } from '@pooflabs/server';
import type { Context } from 'hono';
import { OAUTH_STORAGE_PATH } from '../lib/config.js';
import type { OAuthProvider } from '../lib/poof-oauth.js';
import { validatePoofAuth } from '../lib/poof-auth.js';
import { formatError, sendSuccess, ApiErrors } from '../lib/api-response.js';

const VALID_PROVIDERS: OAuthProvider[] = ['twitter', 'google', 'discord', 'github'];

export async function getSocialLinkHandler(c: Context) {
  try {
    const { walletAddress } = await validatePoofAuth(c);
    const provider = c.req.param('provider') as OAuthProvider;

    // Validate provider
    if (!VALID_PROVIDERS.includes(provider)) {
      return ApiErrors.badRequest(c, `Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }

    const storageKey = `social:${walletAddress}:${provider}`;
    const data = await get(`${OAUTH_STORAGE_PATH}/${storageKey}`);

    if (!data) {
      return ApiErrors.notFound(c, `No ${provider} account linked`);
    }

    const profile = typeof data.profile === 'string' ? JSON.parse(data.profile) : data.profile;

    return sendSuccess(c, { provider, profile, linkedAt: data.linkedAt });
  } catch (error) {
    console.error('Error getting social link:', formatError(error));
    return ApiErrors.internal(c, 'Failed to get social link');
  }
}

export async function deleteSocialLinkHandler(c: Context) {
  try {
    const { walletAddress } = await validatePoofAuth(c);
    const provider = c.req.param('provider') as OAuthProvider;

    // Validate provider
    if (!VALID_PROVIDERS.includes(provider)) {
      return ApiErrors.badRequest(c, `Invalid provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }

    const storageKey = `social:${walletAddress}:${provider}`;

    // Check if link exists
    const data = await get(`${OAUTH_STORAGE_PATH}/${storageKey}`);
    if (!data) {
      return ApiErrors.notFound(c, `No ${provider} account linked`);
    }

    // Delete by setting to null (no deleteItem in @pooflabs/server)
    await set(`${OAUTH_STORAGE_PATH}/${storageKey}`, null);

    return sendSuccess(c, { message: `Unlinked ${provider} account`, provider });
  } catch (error) {
    console.error('Error deleting social link:', formatError(error));
    return ApiErrors.internal(c, 'Failed to delete social link');
  }
}
