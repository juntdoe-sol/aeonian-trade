/**
 * NewsPanel — "INTERN vs MARKET" articles panel on DiscoveryPage.
 * Public read-only. Admin compose/delete moved to AdminDashboard.
 */

import { useMemo } from 'react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyArticles,
  type ArticlesResponse,
} from '@/lib/collections/articles';
import { ExternalLink, Newspaper } from 'lucide-react';

const BG = '#1a1a1f';
const BORDER = '#2a2a35';
const ACCENT = '#ab9ff2';
const MUTED = '#6b6b7a';

function fmtTimeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

// ─── Article card ─────────────────────────────────────────────────────────────

function ArticleCard({ article }: { article: ArticlesResponse }) {
  return (
    <div
      className='rounded-xl overflow-hidden transition-all hover:border-white/10'
      style={{ background: '#111116', border: `1px solid ${BORDER}` }}
    >
      {/* Image */}
      {article.imageUrl && (
        <div className='w-full h-32 overflow-hidden'>
          <img
            src={article.imageUrl}
            alt={article.title}
            className='w-full h-full object-cover'
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      <div className='p-3'>
        <div className='flex items-start justify-between gap-2'>
          <a
            href={article.link}
            target='_blank'
            rel='noopener noreferrer'
            className='flex-1 min-w-0 group'
          >
            <div
              className='text-xs font-semibold leading-snug mb-1 group-hover:underline transition-colors'
              style={{ color: '#e8e8f0' }}
            >
              {article.title}
            </div>
            {article.body && (
              <div
                className='text-[11px] leading-relaxed line-clamp-2'
                style={{ color: MUTED }}
              >
                {article.body}
              </div>
            )}
          </a>

          <a
            href={article.link}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:opacity-80 flex-shrink-0'
            style={{ background: `${ACCENT}18`, color: ACCENT }}
          >
            <ExternalLink size={11} />
          </a>
        </div>

        <div className='mt-2 text-[10px]' style={{ color: '#444455' }}>
          {fmtTimeAgo(article.createdAt)}
        </div>
      </div>
    </div>
  );
}

// ─── Main NewsPanel ───────────────────────────────────────────────────────────

export function NewsPanel() {
  const { data: articles } = useRealtimeData<ArticlesResponse[]>(
    subscribeManyArticles,
    true,
  );

  const sorted = useMemo(
    () => [...(articles ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [articles],
  );

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
          <Newspaper size={14} style={{ color: ACCENT }} />
          <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>INTERN vs MARKET</span>
        </div>
        {sorted.length > 0 && (
          <span className='text-xs' style={{ color: MUTED }}>{sorted.length}</span>
        )}
      </div>

      <div className='p-3 space-y-3'>
        {sorted.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8 gap-2'>
            <Newspaper size={22} style={{ color: MUTED }} />
            <div className='text-xs' style={{ color: MUTED }}>No articles yet</div>
          </div>
        ) : (
          sorted.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
            />
          ))
        )}
      </div>
    </div>
  );
}
