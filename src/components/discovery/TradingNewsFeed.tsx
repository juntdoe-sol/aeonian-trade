/**
 * TradingNewsFeed — general trading/crypto news from free RSS feeds.
 * Fetched server-side via GET /api/news/trading (10 min cache).
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { ExternalLink, Rss } from 'lucide-react';

const BG = '#1a1a1f';
const BORDER = '#2a2a35';
const ACCENT = '#ab9ff2';
const MUTED = '#6b6b7a';

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

function fmtRelativeTime(pubDate: string): string {
  if (!pubDate) return '';
  try {
    const ts = new Date(pubDate).getTime();
    if (!ts) return '';
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  } catch {
    return '';
  }
}

export function TradingNewsFeed() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<{ items: NewsItem[] }>('/api/news/trading')
      .then((data) => {
        if (!cancelled) setItems(data?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Don't render the card at all when loading is done and there are no items
  if (!loading && items.length === 0) return null;

  return (
    <div
      className='rounded-xl overflow-hidden flex flex-col'
      style={{ background: BG, border: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-4 py-3 border-b flex-shrink-0'
        style={{ borderColor: BORDER }}
      >
        <div className='flex items-center gap-2'>
          <Rss size={14} style={{ color: ACCENT }} />
          <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>Trading News</span>
        </div>
        {!loading && items.length > 0 && (
          <span className='text-xs' style={{ color: MUTED }}>{items.length}</span>
        )}
      </div>

      <div
        className='divide-y overflow-y-auto'
        style={{ borderColor: BORDER, maxHeight: '280px' }}
      >
        {loading ? (
          <div className='flex items-center justify-center py-8'>
            <div className='text-xs' style={{ color: MUTED }}>Loading news...</div>
          </div>
        ) : (
          items.map((item, i) => (
            <a
              key={i}
              href={item.link}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] group'
              style={{ borderColor: BORDER }}
            >
              <div className='flex-1 min-w-0'>
                <div
                  className='text-xs font-medium leading-snug mb-1 group-hover:underline line-clamp-2'
                  style={{ color: '#e8e8f0' }}
                >
                  {item.title}
                </div>
                <div className='flex items-center gap-1.5 text-[10px]' style={{ color: MUTED }}>
                  <span style={{ color: ACCENT }}>{item.source}</span>
                  {item.pubDate && (
                    <>
                      <span>·</span>
                      <span>{fmtRelativeTime(item.pubDate)}</span>
                    </>
                  )}
                </div>
              </div>
              <ExternalLink
                size={11}
                className='flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity'
                style={{ color: ACCENT }}
              />
            </a>
          ))
        )}
      </div>
    </div>
  );
}
