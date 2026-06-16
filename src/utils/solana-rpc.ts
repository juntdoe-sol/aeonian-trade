/**
 * Returns a genuine Solana RPC node URL safe for direct web3.js Connection use.
 *
 * IMPORTANT: Never use TAROBASE_CONFIG.rpcUrl for raw web3.js Connection calls.
 * On draft/Poofnet that resolves to the Tarobase offchain simulation proxy
 * (`/app/<appId>/rpc`) which only accepts the Poof SDK's own authenticated
 * calls. A bare JSON-RPC POST (e.g. getLatestBlockhash) gets CORS-rejected,
 * producing "Failed to fetch" / status 0 in the browser.
 *
 * Use this helper for:
 *   - new Connection(getSolanaRpcUrl())  — direct web3.js usage
 *   - createFlightClient({ rpcUrl: getSolanaRpcUrl() }) — Rise SDK RPC config
 *
 * Returns VITE_RPC_URL if explicitly configured, otherwise the Helius mainnet
 * endpoint that is already used as the non-offchain fallback in config.ts.
 *
 * This is correct for ALL environments:
 *   - draft/Poofnet: Rise SDK still targets mainnet Phoenix contracts; the
 *     Poof SDK's signAndSubmitTransaction handles Poofnet simulation internally
 *     and does NOT require the blockhash to come from the proxy.
 *   - preview/live: same Helius endpoint, works as before.
 */
export function getSolanaRpcUrl(): string {
  if (import.meta.env.VITE_RPC_URL) {
    return import.meta.env.VITE_RPC_URL;
  }
  return 'https://celestia-cegncv-fast-mainnet.helius-rpc.com';
}
