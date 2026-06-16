/**
 * Phoenix Flight builder-code configuration utility.
 *
 * Flight is Phoenix's builder-code layer that lets the app earn a share of
 * taker fees on SDK-routed orders. It ONLY applies to orders placed through
 * the Rise SDK (e.g. `client.ixs.placeLimitOrder`, `client.ixs.placeMarketOrder`).
 *
 * It does NOT apply to onchain policy hooks (e.g. `@PhoenixPerpsPlugin`
 * deposit/withdraw/register) — those are governed by Poof policy rules and
 * do not route through the Rise SDK order-building surface.
 */

import { createPhoenixClient, Side } from '@ellipsis-labs/rise';
import type { PhoenixClientConfig, Authority } from '@ellipsis-labs/rise';
import {
  PHOENIX_API_BASE_URL,
  PHOENIX_BUILDER_AUTHORITY,
  PHOENIX_BUILDER_PDA_INDEX,
  PHOENIX_BUILDER_SUBACCOUNT_INDEX,
} from '../constants.js';

export { Side };

/**
 * Create a Rise SDK Phoenix client with Flight builder routing enabled.
 *
 * Flight config is automatically injected using the project's builder authority
 * and subaccount indices from constants. Any additional `PhoenixClientConfig`
 * options you pass are merged on top.
 *
 * @example
 * ```ts
 * const client = createFlightClient({ rpcUrl: 'https://api.mainnet-beta.solana.com' });
 * ```
 */
export function createFlightClient(
  config?: Omit<PhoenixClientConfig, 'flight'>,
) {
  return createPhoenixClient({
    apiUrl: PHOENIX_API_BASE_URL,
    ...config,
    flight: {
      builderAuthority: PHOENIX_BUILDER_AUTHORITY as Authority,
      builderPdaIndex: Number(PHOENIX_BUILDER_PDA_INDEX),
      builderSubaccountIndex: Number(PHOENIX_BUILDER_SUBACCOUNT_INDEX),
    },
  });
}
