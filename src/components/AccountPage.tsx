import { api } from '@/lib/api-client';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useAuth } from '@pooflabs/web';
import { truncateAddress } from '@/utils/format-address';
import { Check, Copy, ExternalLink, LifeBuoy, LogOut, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { ActiveAccountFlow } from './ActiveAccountFlow';
import { formatUsd } from './trading/types';

const NEW_LOGO_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a259d3f1e4d376819b25ef0';
const TIP_ADDRESS = 'PNX9utQBdEs4W7vMNop4wkuzPEsd84dGbMgFeVcoKYa';

interface TokenAmount {
  value: number;
  decimals: number;
  ui: string;
}

interface TraderData {
  collateralBalance?: TokenAmount;
  effectiveCollateralForWithdrawals?: TokenAmount;
  unrealizedPnl?: TokenAmount;
  positions?: unknown[];
  [key: string]: unknown;
}

function toNumber(t: TokenAmount | null | undefined): number {
  if (!t) return 0;
  const parsed = parseFloat(t.ui);
  return isNaN(parsed) ? 0 : parsed;
}

export function AccountPage() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [tipCopied, setTipCopied] = useState(false);
  const [trader, setTrader] = useState<TraderData | null>(null);
  const [traderLoading, setTraderLoading] = useState(false);
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);

  const fetchTrader = useCallback(async () => {
    if (!user?.address) return;
    setTraderLoading(true);
    try {
      // Phoenix is the source of truth for trader existence.
      // Always call the Phoenix API directly — don't gate on the Tarobase doc.
      // A 404 means "not registered" on ANY environment (draft, preview, live).
      try {
        const data = await api.get<TraderData>(`/api/phoenix/trader/${user.address}`);
        setIsRegistered(true);
        setTrader(data);
      } catch (err) {
        const msg = (err instanceof Error ? err.message : '') || '';
        if (msg.includes('404') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('trader not found')) {
          // Phoenix 404 — no account for this wallet yet. Show "Activate" on all envs.
          setIsRegistered(false);
          setTrader(null);
        } else {
          // Other error (network, 5xx, etc.) — unknown state, don't block the UI
          setIsRegistered(null);
          setTrader(null);
        }
      }
    } catch {
      setIsRegistered(null);
      setTrader(null);
    } finally {
      setTraderLoading(false);
    }
  }, [user?.address]);

  useEffect(() => {
    fetchTrader();
  }, [fetchTrader]);

  function copyAddress() {
    if (!user?.address) return;
    navigator.clipboard.writeText(user.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Address copied');
    });
  }

  function truncate(addr: string): string {
    return truncateAddress(addr, 6, 4);
  }

  function copyTipAddress() {
    navigator.clipboard.writeText(TIP_ADDRESS).then(() => {
      setTipCopied(true);
      setTimeout(() => setTipCopied(false), 2000);
      toast.success('Address copied');
    });
  }

  return (
    <div className='min-h-screen pb-28 text-white'>
      {/* Shared app header */}
      <AppHeader />

      {/* Page sub-header */}
      <div className='px-4 pt-4 pb-4' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <h1 className='font-bold text-xl'>Account</h1>
      </div>

      <div className='px-4 pt-4 space-y-4'>
        {/* Wallet card */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <h3 className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>Wallet</h3>

          {user ? (
            <>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Connected</div>
                  <div className='font-mono text-sm font-bold' style={{ color: '#b794f6' }}>
                    {truncate(user.address)}
                  </div>
                </div>
                <button onClick={copyAddress} className='flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors' style={{ background: '#1F1F1F', color: copied ? '#4ADE80' : '#8A8A8A' }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className='glass-inner rounded-lg p-2.5 font-mono text-xs break-all' style={{ color: '#8A8A8A' }}>
                {user.address}
              </div>

              <button onClick={logout} className='glass-button w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors'
                style={{ color: '#FF5252' }}>
                <LogOut size={15} />
                Log Out
              </button>
            </>
          ) : (
            <div className='space-y-3'>
              <p className='text-sm' style={{ color: '#8A8A8A' }}>You're not logged in</p>
              <button onClick={login} className='w-full py-3 rounded-xl font-bold text-sm' style={{ background: 'rgba(183,148,246,0.18)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}>
                Log In
              </button>
            </div>
          )}
        </div>

        {/* Active Account (Phoenix trading account) */}
        {user && (
          <div className='glass-card rounded-xl p-4 space-y-3'>
            <div className='flex items-center justify-between'>
              <h3 className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>Active Account</h3>
              <button
                onClick={() => navigate('/portfolio')}
                className='text-xs font-medium transition-colors'
                style={{ color: '#b794f6' }}
              >
                View Portfolio →
              </button>
            </div>
            {/* ActiveAccountFlow modal */}
            <ActiveAccountFlow open={activateOpen} onOpenChange={setActivateOpen} />

            {traderLoading ? (
              <div className='h-16 rounded-xl animate-pulse' style={{ background: '#0A0A0A' }} />
            ) : isRegistered === false ? (
              <div className='text-sm py-2' style={{ color: '#8A8A8A' }}>
                No active Phoenix account.{' '}
                <button onClick={() => setActivateOpen(true)} className='font-medium' style={{ color: '#b794f6' }}>
                  Activate →
                </button>
              </div>
            ) : isRegistered && trader ? (
              <>
                {/* Collateral row */}
                <div className='grid grid-cols-3 gap-3'>
                  <div className='glass-inner rounded-lg p-2.5 text-center'>
                    <div className='text-[11px] mb-1' style={{ color: '#8A8A8A' }}>Total Collateral</div>
                    <div className='font-bold text-sm tabular-nums'>{formatUsd(toNumber(trader.collateralBalance))}</div>
                  </div>
                  <div className='glass-inner rounded-lg p-2.5 text-center'>
                    <div className='text-[11px] mb-1' style={{ color: '#8A8A8A' }}>Withdrawable</div>
                    <div className='font-bold text-sm tabular-nums' style={{ color: '#4ADE80' }}>{formatUsd(toNumber(trader.effectiveCollateralForWithdrawals))}</div>
                  </div>
                  <div className='glass-inner rounded-lg p-2.5 text-center'>
                    <div className='text-[11px] mb-1' style={{ color: '#8A8A8A' }}>Unrealized PnL</div>
                    <div
                      className='font-bold text-sm tabular-nums'
                      style={{ color: toNumber(trader.unrealizedPnl) >= 0 ? '#4ADE80' : '#FF5252' }}
                    >
                      {formatUsd(toNumber(trader.unrealizedPnl))}
                    </div>
                  </div>
                </div>
                {/* Active positions count */}
                {(trader.positions ?? []).length > 0 && (
                  <div className='flex items-center gap-2 text-xs' style={{ color: '#8A8A8A' }}>
                    <TrendingUp size={13} style={{ color: '#b794f6' }} />
                    <span>{(trader.positions ?? []).length} open position{(trader.positions ?? []).length !== 1 ? 's' : ''}</span>
                  </div>
                )}
              </>
            ) : isRegistered && !trader ? (
              <div className='text-sm py-2' style={{ color: '#8A8A8A' }}>
                Account registered — live trading data will appear on mainnet.
              </div>
            ) : null}
          </div>
        )}

        {/* RPC info — compact row */}
        <div className='glass-card rounded-xl px-4 py-3 flex items-center justify-between'>
          <span className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>Network</span>
          <div className='flex items-center gap-1.5'>
            <div className='w-1.5 h-1.5 rounded-full' style={{ background: '#4ADE80' }} />
            <span className='text-xs font-medium tabular-nums' style={{ color: '#E5E5E5' }}>Solana Mainnet</span>
          </div>
        </div>

        {/* About Phoenix */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <div className='flex items-center gap-2'>
            {/* Icon-only logo for compact card context */}
            <img
              src={NEW_LOGO_URL}
              alt='AEONIAN'
              style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6 }}
            />
            <h3 className='font-bold text-base'>About AEONIAN</h3>
          </div>
          <p className='text-sm leading-relaxed' style={{ color: '#8A8A8A' }}>
            AEONIAN is a mobile-first interface for trading perpetuals on Phoenix Exchange — one of the fastest on-chain order book DEXes on Solana.
            Trade with up to 20x leverage on SOL, BTC, ETH, and more, directly from your pocket.
          </p>
          {/* Disclaimer */}
          <p className='glass-inner text-xs leading-relaxed px-3 py-2.5 rounded-lg' style={{ color: '#6A6A6A' }}>
            This app is not affiliated with Phoenix.trade — it's a mobile interface built for Phoenix.trade traders to trade on mobile.
          </p>
          <a
            href='https://phoenix.trade'
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1.5 text-sm font-medium transition-colors'
            style={{ color: '#b794f6' }}
          >
            phoenix.trade
            <ExternalLink size={13} />
          </a>
        </div>

        {/* Tip Platform */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <h3 className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>Tip Platform</h3>
          <div className='flex items-center justify-between gap-3'>
            <div
              className='glass-inner flex-1 font-mono text-xs break-all select-all px-3 py-2.5 rounded-lg'
              style={{ color: '#C0C0C0' }}
            >
              {TIP_ADDRESS}
            </div>
            <button
              onClick={copyTipAddress}
              className='glass-button flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0'
              style={{ color: tipCopied ? '#4ADE80' : '#8A8A8A' }}
            >
              {tipCopied ? <Check size={14} /> : <Copy size={14} />}
              {tipCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Support */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <h3 className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>Support</h3>
          <a
            href='https://x.com/i/chat/group_join/g2057103803988742289/sf0fKNVDJo'
            target='_blank'
            rel='noopener noreferrer'
            className='glass-inner flex items-center justify-between w-full rounded-lg px-3 py-3 transition-colors'
          >
            <div className='flex items-center gap-2.5'>
              <LifeBuoy size={16} style={{ color: '#b794f6' }} />
              <div>
                <div className='text-sm font-medium' style={{ color: '#E5E5E5' }}>Support Chat Group</div>
                <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>Report bugs, feedback, or suggestions</div>
              </div>
            </div>
            <ExternalLink size={13} style={{ color: '#8A8A8A', flexShrink: 0 }} />
          </a>
        </div>

        {/* FAQ */}
        <div className='glass-card rounded-xl p-4 space-y-1'>
          <h3 className='text-xs font-medium uppercase tracking-wider mb-3' style={{ color: '#8A8A8A' }}>FAQ</h3>
          <Accordion type='single' collapsible className='w-full'>
            <AccordionItem value='q1' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                What is Phoenix Perps?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Phoenix Perps is a leveraged perpetual futures trading platform built on Phoenix Exchange — one of the fastest on-chain central limit order book (CLOB) DEXes on Solana. Trade SOL, BTC, ETH, and more with up to 20x leverage.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='q2' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                How do deposits and withdrawals work?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Deposit USDC from your connected Solana wallet into your Phoenix trading account. Withdrawals return USDC to your wallet and are subject to margin requirements — you can only withdraw collateral not locked by open positions.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='q3' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                Why isn't my trade going through?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Common causes include insufficient collateral, exceeding max leverage, low SOL balance for transaction fees, or a slow network. Make sure your account is activated and funded. If the issue persists, reach out in our Support Chat Group.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='q4' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                Is this available in the US?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Perpetual futures trading via Phoenix Exchange is not available to US residents due to regulatory restrictions. Access to trading features is automatically restricted based on your location.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='q5' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                How do I activate my trading account?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Connect your Solana wallet, then tap "Activate" in the Active Account section above. Activation registers your wallet with Phoenix Exchange and is required before you can deposit or trade.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value='q6' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <AccordionTrigger className='text-sm font-medium py-3 hover:no-underline' style={{ color: '#E5E5E5' }}>
                Where do I get help?
              </AccordionTrigger>
              <AccordionContent className='text-sm pb-3' style={{ color: '#8A8A8A' }}>
                Join our Support Chat Group on X (link above) to report bugs, ask questions, or share feedback. You can also visit phoenix.trade for protocol-level documentation.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <BottomTabNav />
    </div>
  );
}

export default AccountPage;
