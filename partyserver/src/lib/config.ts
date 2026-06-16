/**
 * Tarobase Server Configuration
 *
 * Always uses this worker's fixed TAROBASE_APP_ID from environment.
 * Never trust caller-supplied app IDs on user-facing routes.
 */

// ═════════════════════════════════════════════════════════════
// TAROBASE API URL CONFIGURATION
// ═════════════════════════════════════════════════════════════

const apiUrl = process.env.API_URL || 'https://api.tarobase.com';
const wsApiUrl = process.env.WS_API_URL || 'wss://api.tarobase.com/ws/v2';
const authApiUrl = process.env.AUTH_API_URL || 'https://auth.tarobase.com';

/**
 * Get RPC URL - uses this worker's fixed app ID for offchain RPC
 * @param _headerAppId — deprecated, ignored. Kept for backwards compatibility.
 */
export function getRpcUrl(_headerAppId?: string | null): string | undefined {
  // Fallback for heartbeat/internal calls on offchain workers
  if (process.env.TAROBASE_CHAIN === 'offchain' && process.env.TAROBASE_APP_ID) {
    return `${apiUrl}/app/${process.env.TAROBASE_APP_ID}/rpc`;
  }
  return process.env.SOLANA_RPC_URL;
}

/**
 * Build Tarobase server config for init()
 * Always uses this worker's fixed TAROBASE_APP_ID — never caller-supplied values.
 * @param _headerAppId — deprecated, ignored. Kept for backwards compatibility.
 */
export function getTarobaseServerConfig(_headerAppId?: string | null) {
  const appId = process.env.TAROBASE_APP_ID;
  const rpcUrl = getRpcUrl();
  return {
    appId,
    apiUrl,
    wsApiUrl,
    authApiUrl,
    ...(process.env.TAROBASE_CHAIN === 'offchain' ? { chain: 'offchain' } : {}),
    ...(rpcUrl ? { rpcUrl } : {}),
  };
}

/**
 * Tarobase server configuration for init()
 * Static config using this worker's fixed environment values.
 */
export const TAROBASE_SERVER_CONFIG = {
  appId: process.env.TAROBASE_APP_ID,
  apiUrl,
  wsApiUrl,
  authApiUrl,
  ...(process.env.SOLANA_RPC_URL ? { rpcUrl: process.env.SOLANA_RPC_URL } : {}),
} as const;


/**
 * Tarobase Session API URL
 */
export const TAROBASE_SESSION_API_URL = "https://auth.tarobase.com";


/**
 * Cognito User Pool ID AND CLIENT ID
 */
export const COGNITO_USER_POOL_ID = 'us-east-1_Y2DTcFzKs';
export const COGNITO_CLIENT_ID = '3q3pcg96g5euesjgoe282jp6k3';

/**
 * OAuth Storage Path Prefix
 *
 * Path prefix for storing OAuth social links in Tarobase.
 * Default: "socialLinks"
 *
 * If your policy already uses "socialLinks" for other purposes, Claude Code will
 * automatically detect this and update this constant to an alternative path
 * (e.g., "oauthConnections", "oauthLinks") when generating the OAuth policy.
 *
 * The path format in storage will be: {OAUTH_STORAGE_PATH}/social:{wallet}:{provider}
 */
export const OAUTH_STORAGE_PATH = 'socialLinks';

