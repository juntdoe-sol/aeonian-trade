import { ChevronLeft, Zap, Swords, Trophy, Users, TrendingUp, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: TrendingUp,
    color: '#b794f6',
    title: 'Perpetual Futures Trading',
    description:
      'Long or short SOL, BTC, ETH, and other major assets with leverage — powered by Phoenix Exchange on Solana. USDC is your collateral.',
  },
  {
    icon: Swords,
    color: '#b794f6',
    title: 'Trading Battles',
    description:
      '1v1 battles and Royal Rumble multiplayer modes. Challenge other traders, compete on PnL over a set window, and climb the ranks.',
  },
  {
    icon: Trophy,
    color: '#F59E0B',
    title: 'Points & Leaderboard',
    description:
      'Earn points for every trade, battle win, and social action. Track your rank on the live leaderboard.',
  },
  {
    icon: Users,
    color: '#10B981',
    title: 'Social Rewards',
    description:
      'Follow AEONIAN on X and join the community group chat to earn bonus points. Share trade cards to earn even more.',
  },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Aeonian Trade?',
    a: 'Aeonian Trade is a perpetual futures trading platform built on Solana. It lets you trade leveraged long and short positions on major crypto assets — SOL, BTC, ETH, and more — using USDC as collateral, all powered by Phoenix Exchange.',
  },
  {
    q: 'What are perpetual futures?',
    a: 'Perpetual futures ("perps") are derivative contracts that let you speculate on an asset\'s price without holding the underlying token. Unlike dated futures, they never expire. Leverage amplifies both gains and losses, so only trade what you can afford to lose.',
  },
  {
    q: 'What collateral do I need to trade?',
    a: 'All positions are collateralized in USDC. Deposit USDC into your trading account to open and manage positions. There is no minimum deposit beyond what Phoenix Exchange requires to meet margin requirements.',
  },
  {
    q: 'How do Battles work?',
    a: 'Battles are head-to-head (1v1) or multiplayer (Royal Rumble) trading competitions. Participants trade over a defined time window, and rankings are determined by PnL percentage. Winning earns battle points toward your leaderboard rank.',
  },
  {
    q: 'What are points and how do I earn them?',
    a: 'Points track your overall activity on Aeonian. You earn trading points for every trade, battle points for wins, and social points for community actions like following AEONIAN on X, joining the group chat, or sharing a branded trade card. Points determine your leaderboard position.',
  },
  {
    q: 'What wallet do I need to get started?',
    a: 'Aeonian supports Phantom wallet (and other Solana-compatible wallets). Connect your wallet via the wallet button, fund your account with USDC on Solana, and you\'re ready to trade.',
  },
  {
    q: 'Is there geographic restriction on trading?',
    a: 'Yes. Perpetual futures trading via Phoenix Exchange is not available to users in the United States due to regulatory requirements. US-based users will see a geo-restriction notice and are unable to open positions.',
  },
  {
    q: 'Is Aeonian safe to use?',
    a: 'Aeonian is in beta. Trading perpetual futures carries significant risk — leverage can result in the loss of your entire collateral. Always trade responsibly. Aeonian itself does not custody your funds; positions are settled on-chain via Phoenix Exchange.',
  },
  {
    q: 'When is the TGE (Token Generation Event)?',
    a: 'The AEONIAN TGE will launch once the platform reaches 1,000+ active daily users. Points you accumulate now — through trading, battles, and social actions — are designed to translate into meaningful TGE allocations. Keep earning.',
  },
];

// ─── Accordion item ───────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className='glass-card rounded-xl overflow-hidden transition-all'
      style={{ borderColor: open ? 'rgba(183,148,246,0.25)' : undefined }}
    >
      <button
        onClick={() => setOpen(!open)}
        className='w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left'
      >
        <span className='text-sm font-semibold leading-snug' style={{ color: '#E5E5E5' }}>
          {q}
        </span>
        <span
          className='flex-shrink-0 transition-transform duration-200 mt-0.5'
          style={{
            color: '#8A8A8A',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronLeft
            size={15}
            style={{ transform: 'rotate(-90deg)' }}
          />
        </span>
      </button>

      {open && (
        <div
          className='px-4 pb-4 text-sm leading-relaxed'
          style={{ color: '#8A8A8A', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p className='pt-3'>{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AboutPage() {
  return (
    <div className='min-h-screen pb-28 text-white'>
      <AppHeader />

      {/* Page header */}
      <div className='px-4 pt-4 pb-4' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link
          to='/trade/SOL-PERP'
          className='flex items-center gap-1 text-xs mb-3 transition-colors hover:text-white'
          style={{ color: '#8A8A8A' }}
        >
          <ChevronLeft size={14} />
          Back to Trade
        </Link>
        <div className='flex items-center gap-2'>
          <Info size={18} style={{ color: '#b794f6' }} />
          <h1 className='font-bold text-xl'>About Aeonian</h1>
        </div>
        <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
          Perpetual futures trading on Solana, powered by Phoenix Exchange.
        </p>
      </div>

      <div className='px-4 pt-5 space-y-6'>

        {/* Overview */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <p className='text-sm leading-relaxed' style={{ color: '#CCCCCC' }}>
            <strong style={{ color: '#FFFFFF' }}>Aeonian Trade</strong> is a leveraged perpetual
            futures platform on Solana. Trade long and short positions on SOL, BTC, ETH, and
            more using USDC collateral — settled on-chain through{' '}
            <strong style={{ color: '#b794f6' }}>Phoenix Exchange</strong>, one of Solana's
            premier on-chain derivatives venues.
          </p>
          <p className='text-sm leading-relaxed' style={{ color: '#8A8A8A' }}>
            Beyond trading, Aeonian offers competitive Battles, a points-based rewards system,
            and social incentives to keep things interesting whether the market is moving or not.
          </p>
        </div>

        {/* Core features */}
        <div>
          <h2 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
            Core Features
          </h2>
          <div className='space-y-3'>
            {FEATURES.map((f) => (
              <div key={f.title} className='glass-card rounded-xl p-4 flex items-start gap-3'>
                <div
                  className='glass-inner w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0'
                >
                  <f.icon size={17} style={{ color: f.color }} />
                </div>
                <div>
                  <div className='text-sm font-semibold mb-0.5' style={{ color: '#E5E5E5' }}>
                    {f.title}
                  </div>
                  <div className='text-xs leading-relaxed' style={{ color: '#8A8A8A' }}>
                    {f.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h2 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
            <span className='flex items-center gap-1.5'>
              <Zap size={12} style={{ color: '#F59E0B' }} />
              Frequently Asked Questions
            </span>
          </h2>
          <div className='space-y-2'>
            {FAQ.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div
          className='text-center text-xs pb-2'
          style={{ color: '#4A4A4A' }}
        >
          &copy; {new Date().getFullYear()} AEONIAN &mdash; Beta
        </div>

      </div>

      <BottomTabNav />
    </div>
  );
}

export default AboutPage;
