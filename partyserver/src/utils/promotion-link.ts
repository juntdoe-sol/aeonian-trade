// Promotion-link normalization + hashing for the anti-farming duplicate-link guard.
//
// A link submitted by one wallet must collide with trivial variations submitted
// by another wallet so the ownership registry can reject duplicates. We canonicalize
// the link, then SHA-256 hash it (hex) for use as the promotionLinkRegistry doc key.

/**
 * Normalize a promotion link to a canonical form so trivial variations collide.
 *
 * Rules:
 *  - trim whitespace
 *  - force https scheme
 *  - lowercase the host (host only — paths stay case-sensitive)
 *  - strip a leading "www."
 *  - treat x.com and twitter.com as the same host (normalize twitter.com -> x.com)
 *  - drop the URL fragment (#...) and the entire query string (?...)
 *  - remove a trailing slash on the path
 *
 * Throws if the input is not a parseable http(s) URL.
 */
export function normalizePromotionLink(rawLink: string): string {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    throw new Error('Empty link');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must be http(s)');
  }

  // Force https.
  parsed.protocol = 'https:';

  // Lowercase host, strip leading www., unify x.com / twitter.com.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  if (host === 'twitter.com' || host === 'mobile.twitter.com') {
    host = 'x.com';
  }
  parsed.hostname = host;

  // Drop fragment and query.
  parsed.hash = '';
  parsed.search = '';

  // Remove a trailing slash on the path (but keep a bare "/").
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '');
  }
  parsed.pathname = path;

  // Build the canonical string. Drop the default https port if present.
  let normalized = parsed.toString();
  // URL serialization keeps an empty "?" off when search is "", and "#" off when hash is "".
  // Remove a lone trailing slash that URL re-adds for root paths is acceptable to keep.
  return normalized;
}

/** Hex-encode an ArrayBuffer. */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * SHA-256 hex hash of the normalized link. Hex is path-safe for use as a doc key.
 * Uses Web Crypto (available in Cloudflare Workers).
 */
export async function hashNormalizedLink(normalizedLink: string): Promise<string> {
  const data = new TextEncoder().encode(normalizedLink);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}
