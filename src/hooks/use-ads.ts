/**
 * Singleton ads subscription hook.
 *
 * Uses a module-level shared subscription so:
 * - Only one WebSocket/SSE connection is opened regardless of how many components call this hook.
 * - The subscription starts the instant the first caller mounts — before auth resolves —
 *   so the carousel has data ready the moment it becomes visible.
 * - Ad media for the first slide is preloaded via <link rel="preload"> injected into <head>
 *   as soon as the first ad URL arrives.
 */

import { subscribeManyAds } from '@/lib/collections/ads';
import type { AdsResponse } from '@/lib/collections/ads';
import { useEffect, useState } from 'react';

// ─── Module-level singleton state ───────────────────────────────────────────

type Listener = (ads: AdsResponse[]) => void;

let sharedAds: AdsResponse[] = [];
let subscriptionStarted = false;
let unsubscribeFn: (() => void) | null = null;
const listeners = new Set<Listener>();

function notifyListeners(ads: AdsResponse[]) {
  listeners.forEach((fn) => fn(ads));
}

/**
 * Starts the shared subscription exactly once; subsequent calls are no-ops.
 * Called eagerly (before the carousel mounts) so the data arrives early.
 */
export function startAdsSubscription() {
  if (subscriptionStarted) return;
  subscriptionStarted = true;

  subscribeManyAds((data) => {
    sharedAds = Array.isArray(data) ? data : [];
    notifyListeners(sharedAds);
    // Preload the first active ad's media immediately when data arrives.
    preloadFirstAdMedia(sharedAds);
  })
    .then((unsub) => {
      unsubscribeFn = unsub;
    })
    .catch((err) => {
      console.error('[useAds] subscription error:', err);
    });
}

// ─── Media preloading ────────────────────────────────────────────────────────

const preloadedUrls = new Set<string>();

function preloadFirstAdMedia(ads: AdsResponse[]) {
  const activeAds = ads
    .filter((a) => a.active)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (activeAds.length === 0) return;

  // Preload the first ad, and optionally the second (next-slide preload).
  const toPreload = activeAds.slice(0, 2);

  toPreload.forEach((ad, idx) => {
    const { mediaUrl, mediaType } = ad;
    if (!mediaUrl || preloadedUrls.has(mediaUrl)) return;
    preloadedUrls.add(mediaUrl);

    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = mediaUrl;
    link.as = mediaType === 'video' ? 'video' : 'image';
    // Highest priority for the first (visible) ad; lower for the upcoming slide.
    if (idx === 0) {
      link.setAttribute('fetchpriority', 'high');
    }
    document.head.appendChild(link);
  });
}

// ─── React hook ─────────────────────────────────────────────────────────────

export function useAds(): AdsResponse[] {
  // Initialise from the already-populated singleton so there's no empty-flash
  // on first render even if data arrived before this component mounted.
  const [ads, setAds] = useState<AdsResponse[]>(sharedAds);

  useEffect(() => {
    // Ensure the subscription is running (idempotent).
    startAdsSubscription();

    // Sync with current singleton value in case data arrived between render + effect.
    setAds(sharedAds);

    const listener: Listener = (newAds) => setAds(newAds);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return ads;
}
