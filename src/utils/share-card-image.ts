import { PARTYSERVER_URL } from '@/lib/config';

/**
 * Hardcoded Aeonian-branded background image (1200x675) used by ALL shareable
 * cards (PnL, Open Position, Promo). This replaces the former admin-uploadable
 * background. Pre-fetch it to a base64 data URL via `remoteUrlToDataUrl` before
 * passing it into a captured card node — raw cross-origin S3 URLs render in the
 * live preview but are silently dropped from the html-to-image PNG export.
 */
export const SHARE_CARD_BG_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2cbe702631ad6eb9346a83';

/**
 * Build the backend proxy URL for a given remote image URL.
 * The proxy fetches the image server-side, bypassing CORS restrictions
 * on custom domains (e.g. aeonian.trade) where the S3 bucket does not
 * return Access-Control-Allow-Origin headers for that origin.
 */
function buildProxyUrl(url: string): string {
  const protocol = PARTYSERVER_URL.includes('localhost') ? 'http' : 'https';
  const base = `${protocol}://${PARTYSERVER_URL}`;
  return `${base}/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Fetch a remote image URL via the backend image proxy and return a base64
 * data URL. Using the proxy avoids cross-origin CORS issues when the remote
 * S3 host does not send Access-Control-Allow-Origin for the current domain.
 *
 * The resulting data: URL is required for html-to-image / toPng capture —
 * raw cross-origin URLs are silently dropped in SVG foreignObject context
 * (notably on mobile Safari).
 *
 * On failure, falls back to the raw remote URL so that on-screen <img> /
 * CSS background-image display still works (those use the browser's normal
 * image loading which is not CORS-restricted). The PNG capture will still
 * fail for cross-origin images in that case, but the preview stays visible.
 */
export async function remoteUrlToDataUrl(url: string): Promise<string> {
  const proxyUrl = buildProxyUrl(url);
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Module-level cache for the hardcoded share-card background data URL.
 *
 * SHARE_CARD_BG_URL is the single fixed image shared by ALL share cards, so we fetch +
 * base64-convert it at most once per page session. All share modals
 * (PnL, Open Position, Promo) reuse the same resolved data URL instantly
 * on subsequent opens instead of re-fetching through the proxy every time.
 *
 * Only SUCCESSFUL conversions are cached. On failure the cached value is
 * left undefined and the in-flight promise is cleared, so a later call can
 * retry the fetch. Callers should fall back to the raw SHARE_CARD_BG_URL
 * for the on-screen preview while/if the data URL is unavailable.
 */
let cachedBgDataUrl: string | undefined;
let bgDataUrlPromise: Promise<string> | undefined;

export function getShareCardBgDataUrl(): Promise<string> {
  // Already resolved successfully — return instantly.
  if (cachedBgDataUrl) return Promise.resolve(cachedBgDataUrl);
  // A fetch is already in flight — reuse it so we never fetch twice concurrently.
  if (bgDataUrlPromise) return bgDataUrlPromise;

  bgDataUrlPromise = remoteUrlToDataUrl(SHARE_CARD_BG_URL)
    .then((dataUrl) => {
      cachedBgDataUrl = dataUrl; // cache only on success
      bgDataUrlPromise = undefined;
      return dataUrl;
    })
    .catch((err) => {
      // Do NOT poison the cache — clear the in-flight promise so a later
      // call can retry. Re-throw so the caller can fall back to the raw URL.
      bgDataUrlPromise = undefined;
      throw err;
    });

  return bgDataUrlPromise;
}
