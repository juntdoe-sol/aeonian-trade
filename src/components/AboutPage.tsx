import { ChevronLeft, Zap, Swords, Trophy, Users, TrendingUp, Info, Ban, BookOpen, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';

// ─── Brand Guide constants ─────────────────────────────────────────────────────

const FULL_LOGO_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2ad652d3980483add4a6c8';

// Logo mark only (no text)
const LOGO_MARK_PURPLE_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1b969daf4c99cdbcd6e';
const LOGO_MARK_WHITE_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1b065ed135dbf0b54f7';
const LOCKUP_PURPLE_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1b369daf4c99cdbcd6d';
const LOCKUP_WHITE_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1b565ed135dbf0b54f8';
const APP_ICON_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1ab7f45fccc2a855da7';
const WORDMARK_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3ca1b7d3980483add4a751';

// ─── Download helper ───────────────────────────────────────────────────────────

async function downloadAsset(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
    toast.success(`Downloading ${filename}`);
  } catch {
    toast.error('Download failed. Please try again.');
  }
}

const BRAND_COLORS = [
  { name: 'White', hex: '#FFFFFF', light: true },
  { name: 'Orchid', hex: '#B09AD9', light: false },
  { name: 'Amethyst', hex: '#6B2FA8', light: false },
  { name: 'Aeonian Royal', hex: '#401368', light: false },
  { name: 'Void', hex: '#120427', light: false },
  { name: 'Mist', hex: '#EFE9F5', light: true },
];

const TYPEFACES = [
  { name: 'ID Grotesk' },
  { name: 'Hanken Grotesk' },
];

const ALPHA_SAMPLE = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz';
const NUM_SAMPLE = '0 1 2 3 4 5 6 7 8 9 @ $ % * ( ) _ + - / =';

const MISUSE_RULES = [
  'Do not stretch or distort the logo',
  'Do not rotate the logo',
  'Do not recolor the logo',
  'Do not place on busy backgrounds',
];

const BRAND_CHIPS = [
  'The perpetuals arena',
  'Built Mobile-first on Solana',
];

// ─── Brand Assets data ─────────────────────────────────────────────────────────

const BRAND_ASSETS = [
  {
    label: 'Logo Mark',
    sublabel: 'Purple on transparent',
    url: LOGO_MARK_PURPLE_URL,
    filename: 'Aeonian_LogoMark_Purple.png',
    previewBg: '#EFE9F5',
    previewImgStyle: { width: '48px', height: '48px' },
    labelColor: '#401368',
  },
  {
    label: 'Logo Mark',
    sublabel: 'White on Royal',
    url: LOGO_MARK_WHITE_URL,
    filename: 'Aeonian_LogoMark_White.png',
    previewBg: '#401368',
    previewImgStyle: { width: '48px', height: '48px', borderRadius: '8px' },
    labelColor: '#EFE9F5',
  },
  {
    label: 'Full Lockup',
    sublabel: 'Purple on white',
    url: LOCKUP_PURPLE_URL,
    filename: 'Aeonian_Lockup_Purple.png',
    previewBg: '#FFFFFF',
    previewImgStyle: { width: '80px', height: '32px', objectFit: 'contain' as const },
    labelColor: '#401368',
  },
  {
    label: 'Full Lockup',
    sublabel: 'White on purple',
    url: LOCKUP_WHITE_URL,
    filename: 'Aeonian_Lockup_White.png',
    previewBg: '#401368',
    previewImgStyle: { width: '80px', height: '32px', objectFit: 'contain' as const },
    labelColor: '#EFE9F5',
  },
  {
    label: 'App Icon',
    sublabel: 'White on purple',
    url: APP_ICON_URL,
    filename: 'Aeonian_AppIcon.png',
    previewBg: '#120427',
    previewImgStyle: { width: '48px', height: '48px', borderRadius: '10px' },
    labelColor: '#B09AD9',
  },
  {
    label: 'Wordmark',
    sublabel: 'Text only, white',
    url: WORDMARK_URL,
    filename: 'Aeonian_Wordmark_White.png',
    previewBg: '#120427',
    previewImgStyle: { width: '80px', height: '24px', objectFit: 'contain' as const },
    labelColor: '#B09AD9',
  },
];

type BrandAsset = typeof BRAND_ASSETS[number];

function BrandAssetButton({ asset }: { asset: BrandAsset }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    await downloadAsset(asset.url, asset.filename);
    setDownloading(false);
  }

  return (
    <div
      className='rounded-xl overflow-hidden flex flex-col'
      style={{ background: '#0d0d0d', border: '1px solid rgba(107,47,168,0.25)' }}
    >
      {/* Preview area */}
      <div
        className='flex items-center justify-center'
        style={{ background: asset.previewBg, height: '80px' }}
      >
        <img src={asset.url} alt={asset.label} style={asset.previewImgStyle} />
      </div>
      {/* Info + download */}
      <div className='px-3 py-2.5 flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='text-xs font-semibold leading-tight' style={{ color: '#E5E5E5' }}>{asset.label}</div>
          <div className='text-xs mt-0.5 leading-tight truncate' style={{ color: '#8A8A8A' }}>{asset.sublabel}</div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className='flex-shrink-0 flex items-center justify-center rounded-lg transition-all active:scale-95'
          style={{
            background: downloading ? 'rgba(107,47,168,0.15)' : 'rgba(107,47,168,0.25)',
            border: '1px solid rgba(176,154,217,0.3)',
            color: downloading ? '#8A8A8A' : '#B09AD9',
            width: '30px',
            height: '30px',
          }}
          aria-label={`Download ${asset.label}`}
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Brand Guide section ───────────────────────────────────────────────────────

function BrandGuideSection() {
  return (
    <div className='space-y-6'>

      {/* Section heading */}
      <div className='flex items-center gap-2 pt-2'>
        <BookOpen size={18} style={{ color: '#B09AD9' }} />
        <h2 className='font-bold text-xl text-white'>Brand Guide</h2>
      </div>
      <p className='text-xs leading-relaxed -mt-3' style={{ color: '#8A8A8A' }}>
        Official Aeonian visual identity — logos, typography, palette, and usage guidelines.
      </p>

      {/* ── 1. Logo Usage ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Logo Usage
        </h3>
        <div className='grid grid-cols-2 gap-3'>
          {/* Lockup on dark */}
          <div className='rounded-xl p-4 flex flex-col items-center gap-3' style={{ background: '#0d0d0d', border: '1px solid rgba(176,154,217,0.15)' }}>
            <img src={FULL_LOGO_URL} alt='Aeonian logo lockup dark' className='h-7 w-auto object-contain' />
            <span className='text-xs font-medium' style={{ color: '#8A8A8A' }}>Lockup — Dark</span>
          </div>
          {/* Lockup on royal purple */}
          <div className='rounded-xl p-4 flex flex-col items-center gap-3' style={{ background: '#401368', border: '1px solid rgba(176,154,217,0.25)' }}>
            <img src={FULL_LOGO_URL} alt='Aeonian logo lockup purple' className='h-7 w-auto object-contain' />
            <span className='text-xs font-medium' style={{ color: '#EFE9F5' }}>Lockup — Royal</span>
          </div>
          {/* Mark on dark */}
          <div className='rounded-xl p-4 flex flex-col items-center justify-center gap-3' style={{ background: '#0d0d0d', border: '1px solid rgba(176,154,217,0.15)', minHeight: '110px' }}>
            <img src={LOGO_MARK_WHITE_URL} alt='Aeonian logo mark on dark' className='object-contain' style={{ width: '96px', height: '96px', borderRadius: '12px' }} />
            <span className='text-xs font-medium' style={{ color: '#8A8A8A' }}>Logo mark — Dark</span>
          </div>
          {/* Mark on light */}
          <div className='rounded-xl p-4 flex flex-col items-center justify-center gap-3' style={{ background: '#EFE9F5', border: '1px solid rgba(64,19,104,0.2)', minHeight: '110px' }}>
            <img src={LOGO_MARK_PURPLE_URL} alt='Aeonian logo mark on light' className='object-contain' style={{ width: '96px', height: '96px' }} />
            <span className='text-xs font-medium' style={{ color: '#401368' }}>Logo mark — Light</span>
          </div>
        </div>
      </div>

      {/* ── 2. Brand Assets ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Brand Assets
        </h3>
        <p className='text-xs mb-3 leading-relaxed' style={{ color: '#8A8A8A' }}>
          Official assets for press, partnerships, and community use. Download in original quality.
        </p>
        <div className='grid grid-cols-2 gap-2'>
          {BRAND_ASSETS.map((asset) => (
            <BrandAssetButton key={asset.filename} asset={asset} />
          ))}
        </div>
      </div>

      {/* ── 3. Typography ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Typography
        </h3>
        <div className='space-y-3'>
          {TYPEFACES.map((tf) => (
            <div
              key={tf.name}
              className='rounded-xl p-4'
              style={{ background: '#0d0d0d', border: '1px solid rgba(107,47,168,0.25)' }}
            >
              <div
                className='text-2xl font-bold mb-2 leading-tight'
                style={{ color: '#B09AD9', letterSpacing: '-0.02em' }}
              >
                {tf.name}
              </div>
              <div className='text-xs leading-relaxed mb-1' style={{ color: '#CCCCCC', letterSpacing: '0.01em' }}>
                {ALPHA_SAMPLE}
              </div>
              <div className='text-xs leading-relaxed' style={{ color: '#8A8A8A', letterSpacing: '0.01em' }}>
                {NUM_SAMPLE}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Color Palette ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Color Palette
        </h3>
        <div className='grid grid-cols-3 gap-2 md:grid-cols-6'>
          {BRAND_COLORS.map((c) => (
            <div key={c.hex} className='flex flex-col items-center gap-1.5'>
              <div
                className='w-full aspect-square rounded-xl'
                style={{
                  background: c.hex,
                  border: c.light ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(255,255,255,0.06)',
                  minHeight: '52px',
                }}
              />
              <div className='text-center'>
                <div className='text-xs font-semibold leading-tight' style={{ color: '#E5E5E5' }}>{c.name}</div>
                <div className='text-xs font-mono mt-0.5' style={{ color: '#8A8A8A' }}>{c.hex}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. Tagline & Brand Voice ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Tagline & Brand Voice
        </h3>
        <div
          className='rounded-xl p-5 mb-3 text-center'
          style={{ background: 'linear-gradient(135deg, #401368 0%, #6B2FA8 60%, #120427 100%)', border: '1px solid rgba(176,154,217,0.2)' }}
        >
          <p
            className='font-bold tracking-tight leading-none'
            style={{ color: '#FFFFFF', fontSize: '1.75rem', letterSpacing: '-0.03em' }}
          >
            Trade. Battle. Win.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {BRAND_CHIPS.map((chip) => (
            <span
              key={chip}
              className='inline-block rounded-full px-3 py-1 text-xs font-medium'
              style={{
                background: 'rgba(107,47,168,0.18)',
                color: '#B09AD9',
                border: '1px solid rgba(107,47,168,0.35)',
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* ── 5. Logo Misuse ── */}
      <div>
        <h3 className='text-xs font-semibold uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>
          Logo Misuse
        </h3>
        <div className='space-y-2'>
          {MISUSE_RULES.map((rule) => (
            <div
              key={rule}
              className='flex items-center gap-3 rounded-xl px-4 py-3'
              style={{ background: 'rgba(239,46,46,0.06)', border: '1px solid rgba(239,46,46,0.15)' }}
            >
              <Ban size={14} style={{ color: '#F87171', flexShrink: 0 }} />
              <span className='text-sm' style={{ color: '#E5E5E5' }}>{rule}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: TrendingUp,
    color: '#b794f6',
    title: 'Perpetual Futures Trading',
    description:
      'Long or short SOL, BTC, ETH, and other major assets with leverage on Solana. USDC is your collateral.',
  },
  {
    icon: Swords,
    color: '#b794f6',
    title: 'Arena',
    description:
      '1v1 battles and Royal Rumble multiplayer modes. Challenge other traders, compete on real PnL over a set window, and climb the live leaderboard.',
  },
  {
    icon: Trophy,
    color: '#F59E0B',
    title: 'Monthly Prize Pot',
    description:
      'An on-chain prize pot funded each month. The top traders on the monthly leaderboard claim their share — paid out directly to your wallet.',
  },
  {
    icon: Users,
    color: '#10B981',
    title: 'Follow & Social Rewards',
    description:
      'Follow top traders and get notified on their moves and wins. Connect X, join the community, and share trade cards to earn bonus points.',
  },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Aeonian Trade?',
    a: 'Aeonian Trade is a perpetual futures trading platform built on Solana. It lets you trade leveraged long and short positions on major crypto assets — SOL, BTC, ETH, and more — using USDC as collateral, with positions settled on-chain.',
  },
  {
    q: 'What are perpetual futures?',
    a: 'Perpetual futures ("perps") are derivative contracts that let you speculate on an asset\'s price without holding the underlying token. Unlike dated futures, they never expire. Leverage amplifies both gains and losses, so only trade what you can afford to lose.',
  },
  {
    q: 'What collateral do I need to trade?',
    a: 'All positions are collateralized in USDC. Deposit USDC into your trading account to open and manage positions. There is no minimum deposit beyond what is required to meet margin requirements.',
  },
  {
    q: 'How does the Arena work?',
    a: 'The Arena hosts head-to-head (1v1) and multiplayer (Royal Rumble) trading competitions. Participants trade over a defined time window, and rankings are determined by PnL percentage. Winning earns points toward your leaderboard rank.',
  },
  {
    q: 'What are points and how do I earn them?',
    a: 'Points track your overall activity on Aeonian. You earn trading points for every trade, Arena points for wins, and social points for community actions like following AEONIAN on X, joining the group chat, or sharing a branded trade card. Points determine your leaderboard position.',
  },
  {
    q: 'How do I get started?',
    a: 'You can log in with your email or a Solana wallet such as Phantom. Once you\'re in, fund your account with USDC on Solana and you\'re ready to trade. Orders are routed on-chain to trading venues for execution.',
  },
  {
    q: 'Is there geographic restriction on trading?',
    a: 'Yes. Perpetual futures trading is not available to users in the United States due to regulatory requirements. US-based users will see a geo-restriction notice and are unable to open positions.',
  },
  {
    q: 'Is Aeonian safe to use?',
    a: 'Aeonian is in beta. Trading perpetual futures carries significant risk — leverage can result in the loss of your entire collateral. Always trade responsibly. Aeonian itself does not custody your funds; positions are settled on-chain on Solana.',
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
          Perpetual futures trading on Solana.
        </p>
      </div>

      <div className='px-4 pt-5 space-y-6'>

        {/* Overview */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <p className='text-sm leading-relaxed' style={{ color: '#CCCCCC' }}>
            <strong style={{ color: '#FFFFFF' }}>Aeonian Trade</strong> is a leveraged perpetual
            futures platform on Solana. Trade long and short positions on SOL, BTC, ETH, and
            more using USDC collateral, with every position settled on-chain.
          </p>
          <p className='text-sm leading-relaxed' style={{ color: '#8A8A8A' }}>
            Beyond trading, Aeonian offers the competitive Arena, a monthly on-chain prize pot,
            trader following, and a points-based rewards system to keep things interesting whether
            the market is moving or not.
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

        {/* Brand Guide */}
        <div
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem' }}
        >
          <BrandGuideSection />
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
