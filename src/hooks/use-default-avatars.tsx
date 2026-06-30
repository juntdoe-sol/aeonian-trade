/**
 * useDefaultAvatars — subscribe to the admin-managed default avatar pool
 * and return a stably sorted list of URLs.
 *
 * Sort order: createdAt ascending, tiebreak by id ascending.
 * This stable order ensures pickDefaultAvatar() maps wallets to the SAME
 * index across all clients and reloads.
 */

import { useMemo } from 'react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyDefaultAvatars,
  type DefaultAvatarsResponse,
} from '@/lib/collections/defaultAvatars';

export function useDefaultAvatars(): string[] {
  const { data: avatars } = useRealtimeData<DefaultAvatarsResponse[]>(
    subscribeManyDefaultAvatars,
    true,
  );

  return useMemo(() => {
    if (!avatars || avatars.length === 0) return [];
    const sorted = [...avatars].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return sorted.map((a) => a.url);
  }, [avatars]);
}
