// React hook for the jurisdictional UX banner. Wire this on any UI surface
// that triggers a tx for a restricted program (currently Phoenix Perps) so
// users in restricted countries see an upfront banner instead of a wallet
// popup that fails silently.
//
// Calls Tarobase's centralized `GET /geo` — the platform endpoint that reads
// the viewer's country and returns the list of programs blocked in that
// jurisdiction. The server-side enforcement for txs your partyserver signs
// lives separately in `partyserver/src/lib/geo-gate.ts`
// (`assertProgramAllowed`) — this hook is the UX layer only.
//
// Usage:
//   const { blocked } = useGeoBlocked('phoenix');
//   if (blocked) return <Banner>Trading unavailable in your jurisdiction.</Banner>;
//
// Fails open if the endpoint is unreachable.

import { useEffect, useState } from 'react';
import { TAROBASE_CONFIG } from '../lib/config';

interface BlockedProgram {
  program: string;
  programId: string;
}

interface GeoResponse {
  country: string | null;
  blockedPrograms: BlockedProgram[];
}

async function fetchGeo(signal?: AbortSignal): Promise<GeoResponse> {
  const res = await fetch(`${TAROBASE_CONFIG.apiUrl}/geo`, { method: 'GET', signal });
  if (!res.ok) throw new Error(`Geo lookup failed: ${res.status}`);
  return (await res.json()) as GeoResponse;
}

// Defensive against future API shape drift: if `blockedPrograms` is ever absent
// or non-array, fall through to `false` rather than crash the hook.
function isProgramBlocked(geo: GeoResponse | null, program: string): boolean {
  return geo?.blockedPrograms?.some?.((p) => p?.program === program) ?? false;
}

interface UseGeoBlockedResult {
  blocked: boolean;
  loading: boolean;
  country: string | null;
  error: Error | null;
}

export function useGeoBlocked(program: string): UseGeoBlockedResult {
  const [geo, setGeo] = useState<GeoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchGeo(controller.signal)
      .then((result) => {
        setGeo(result);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return {
    blocked: isProgramBlocked(geo, program),
    loading,
    country: geo?.country ?? null,
    error,
  };
}
