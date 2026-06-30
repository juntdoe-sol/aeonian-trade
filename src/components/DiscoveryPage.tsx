/**
 * DiscoveryPage — AEONIAN front page hub.
 * Four-column Phantom-flat-dark dashboard (desktop) / single-column stack (mobile).
 *
 * Col1: Portfolio summary + Positions / Activity / Follows feed
 * Col2: Markets table (all Phoenix perps)
 * Col3: PnlLeaderboard + Hall of Fame
 * Col4: INTERN vs MARKET articles + Trading News feed + Market Analysis
 *
 * Route: /discovery (App.tsx redirects / → /discovery)
 */

import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { PnlLeaderboard } from './PnlLeaderboard';
import { MonthlyHallOfFame } from './MonthlyHallOfFame';
import { PortfolioPanel } from './discovery/PortfolioPanel';
import { MarketsTable } from './discovery/MarketsTable';
import { NewsPanel } from './discovery/NewsPanel';
import { TradingNewsFeed } from './discovery/TradingNewsFeed';
import { MarketAnalysis } from './discovery/MarketAnalysis';
import { ComingSoonCards } from './discovery/ComingSoonCards';
import { useMobile } from '@/hooks/use-mobile';

const PAGE_BG = '#0d0d0d';

// ─── Column wrappers ──────────────────────────────────────────────────────────

function Col1() {
  return (
    <div className='flex flex-col min-h-0' style={{ minHeight: 420 }}>
      <PortfolioPanel />
    </div>
  );
}

function Col2() {
  return (
    <div className='flex flex-col min-h-0' style={{ minHeight: 480 }}>
      <MarketsTable />
    </div>
  );
}

function Col3() {
  return (
    <div className='space-y-4'>
      {/* Compact leaderboard — top traders */}
      <div
        className='rounded-xl overflow-hidden'
        style={{ background: '#1a1a1f', border: '1px solid #2a2a35' }}
      >
        <div
          className='px-4 py-3 border-b text-sm font-semibold'
          style={{ borderColor: '#2a2a35', color: '#e8e8f0' }}
        >
          Top Traders
        </div>
        <div className='max-h-[480px] overflow-y-auto'>
          <PnlLeaderboard hidePodium />
        </div>
      </div>

      {/* Hall of Fame */}
      <MonthlyHallOfFame />
    </div>
  );
}

function Col4() {
  return (
    <div className='space-y-4'>
      {/* INTERN vs MARKET admin articles */}
      <NewsPanel />

      {/* General trading news RSS */}
      <TradingNewsFeed />

      {/* Community Market Analysis */}
      <MarketAnalysis />

      {/* Coming Soon: Market Predictions */}
      <ComingSoonCards />
    </div>
  );
}

// ─── Desktop layout (4 columns) ───────────────────────────────────────────────

function DesktopLayout() {
  return (
    <div
      className='flex-1 overflow-y-auto'
      style={{ background: PAGE_BG }}
      id='discovery-scroll'
    >
      <div
        className='grid gap-4 px-4 py-4'
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          minHeight: '100%',
          alignItems: 'start',
        }}
      >
        {/* Col1: Portfolio */}
        <div className='min-w-0' style={{ position: 'sticky', top: 16 }}>
          <Col1 />
        </div>

        {/* Col2: Markets */}
        <div className='min-w-0' style={{ minHeight: 600 }}>
          <Col2 />
        </div>

        {/* Col3: Leaderboard + HoF */}
        <div className='min-w-0'>
          <Col3 />
        </div>

        {/* Col4: Articles + News + Analysis + Coming Soon */}
        <div className='min-w-0'>
          <Col4 />
        </div>
      </div>
    </div>
  );
}

// ─── Mobile layout (stacked) ──────────────────────────────────────────────────

function MobileLayout() {
  return (
    <div
      className='flex-1 overflow-y-auto space-y-4 px-3 py-4 pb-24'
      style={{ background: PAGE_BG }}
    >
      {/* 1. Markets first on mobile */}
      <div style={{ height: 420 }}>
        <MarketsTable />
      </div>

      {/* 2. Portfolio feed */}
      <div style={{ height: 480 }}>
        <PortfolioPanel />
      </div>

      {/* 3. Leaderboard snippet */}
      <div
        className='rounded-xl overflow-hidden'
        style={{ background: '#1a1a1f', border: '1px solid #2a2a35' }}
      >
        <div
          className='px-4 py-3 border-b text-sm font-semibold'
          style={{ borderColor: '#2a2a35', color: '#e8e8f0' }}
        >
          Top Traders
        </div>
        <div className='max-h-96 overflow-y-auto'>
          <PnlLeaderboard hidePodium />
        </div>
      </div>

      {/* 4. Hall of Fame */}
      <MonthlyHallOfFame />

      {/* 5. INTERN vs MARKET articles */}
      <NewsPanel />

      {/* 6. Trading News RSS */}
      <TradingNewsFeed />

      {/* 7. Market Analysis */}
      <MarketAnalysis />

      {/* 8. Coming Soon */}
      <ComingSoonCards />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DiscoveryPage() {
  const isMobile = useMobile();

  return (
    <div
      className='flex flex-col h-full'
      style={{ background: PAGE_BG }}
    >
      <AppHeader />

      {isMobile ? <MobileLayout /> : <DesktopLayout />}

      <BottomTabNav />
    </div>
  );
}
