import { useState, useEffect, useCallback } from 'react';
import { useAuth, getIdToken } from '@pooflabs/web';
import { TAROBASE_CONFIG } from '../lib/config';

interface MarketAccount {
  marketLedger: string;
  yesMint: string;
  noMint: string;
  isInitialized: boolean;
  redemptionStatus: string | null;
}

export interface DflowMarket {
  ticker: string;
  eventTicker: string;
  marketType: string;
  title: string;
  subtitle: string;
  yesSubTitle: string;
  noSubTitle: string;
  openTime: number;
  closeTime: number;
  expirationTime: number;
  status: string;
  volume: number;
  result: string;
  openInterest: number;
  canCloseEarly: boolean;
  earlyCloseCondition?: string;
  rulesPrimary: string;
  rulesSecondary?: string;
  yesBid: string | null;
  yesAsk: string | null;
  noBid: string | null;
  noAsk: string | null;
  accounts: Record<string, MarketAccount>;
}

interface MarketsResponse {
  markets: DflowMarket[];
  cursor?: number;
}

interface UseDflowMarketsOptions {
  limit?: number;
  cursor?: number;
  status?: string;
}

async function fetchDflowApi<T>(
  path: string,
  appId: string,
  userAddress: string
): Promise<T> {
  const token = await getIdToken();
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`${TAROBASE_CONFIG.apiUrl}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-app-id': appId,
      'x-user-address': userAddress,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DFlow API error: ${errorText}`);
  }

  return response.json();
}

/**
 * Hook to fetch DFlow prediction markets list.
 * Requires user to be authenticated.
 */
export function useDflowMarkets(options: UseDflowMarketsOptions = {}) {
  const { user } = useAuth();
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { limit = 10, cursor, status } = options;

  const refetch = useCallback(async () => {
    if (!user?.address || !TAROBASE_CONFIG.appId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (cursor) params.set('cursor', String(cursor));
      if (status) params.set('status', status);

      const result = await fetchDflowApi<MarketsResponse>(
        `/dflow/markets?${params.toString()}`,
        TAROBASE_CONFIG.appId,
        user.address
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [user?.address, limit, cursor, status]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/**
 * Hook to fetch a single DFlow market by mint or market ledger.
 * Requires user to be authenticated.
 */
export function useDflowMarket(mint: string | undefined) {
  const { user } = useAuth();
  const [data, setData] = useState<DflowMarket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!mint || !user?.address || !TAROBASE_CONFIG.appId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchDflowApi<DflowMarket>(
        `/dflow/market/${mint}`,
        TAROBASE_CONFIG.appId,
        user.address
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [mint, user?.address]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
