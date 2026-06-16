import { useState, useMemo } from 'react';
import { Share2 } from 'lucide-react';
import { formatPrice, formatUsd, type TradeFill } from './types';
import { computeClosedTrades, type ClosedTrade } from '@/utils/trade-computations';
import { PnlShareModal } from './PnlShareModal';

interface TradeHistoryTableProps {
  fills: TradeFill[];
  loading?: boolean;
  showSymbol?: boolean;
}

export function TradeHistoryTable({ fills, loading, showSymbol = true }: TradeHistoryTableProps) {
  const [shareTrade, setShareTrade] = useState<ClosedTrade | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const closedTrades = useMemo(() => computeClosedTrades(fills), [fills]);

  if (loading) {
    return (
      <div className='space-y-2'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='h-14 rounded-xl animate-pulse glass-card' />
        ))}
      </div>
    );
  }

  if (fills.length === 0) {
    return (
      <div className='glass-card rounded-xl p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No trade history</p>
      </div>
    );
  }

  const handleShare = (trade: ClosedTrade) => {
    setShareTrade(trade);
    setModalOpen(true);
  };

  return (
    <>
      <div className='space-y-1.5'>
        {/* Header */}
        <div
          className='grid text-xs px-3 py-1.5'
          style={{
            gridTemplateColumns: showSymbol ? '1fr 1fr 1fr 1fr 1fr 40px' : '1fr 1fr 1fr 1fr 40px',
            color: '#8A8A8A',
          }}
        >
          {showSymbol && <span>Symbol</span>}
          <span>Side</span>
          <span className='text-right'>Entry</span>
          <span className='text-right'>Exit</span>
          <span className='text-right'>PnL</span>
          <span />
        </div>

        {closedTrades.length > 0 ? (
          closedTrades.map((trade, i) => {
            const pnlPositive = trade.realizedPnl >= 0;
            return (
              <div
                key={`${trade.symbol}-${trade.timestamp}-${i}`}
                className='glass-inner grid gap-2 text-xs tabular-nums px-3 py-2 rounded-lg items-center'
                style={{
                  gridTemplateColumns: showSymbol ? '1fr 1fr 1fr 1fr 1fr 40px' : '1fr 1fr 1fr 1fr 40px',
                }}
              >
                {showSymbol && <span className='font-medium'>{trade.symbol}</span>}
                <span
                  className='font-medium'
                  style={{ color: trade.side === 'Long' ? '#4ADE80' : '#FF5252' }}
                >
                  {trade.side.toUpperCase()}
                </span>
                <span className='text-right'>${formatPrice(trade.entryPrice)}</span>
                <span className='text-right'>${formatPrice(trade.exitPrice)}</span>
                <span
                  className='text-right font-bold'
                  style={{ color: pnlPositive ? '#4ADE80' : '#FF5252' }}
                >
                  {formatUsd(trade.realizedPnl)}
                </span>
                <div className='flex justify-end'>
                  <button
                    onClick={() => handleShare(trade)}
                    className='p-1 rounded-md hover:bg-white/10 transition-colors'
                    style={{ color: '#8A8A8A' }}
                    title='Share PnL'
                  >
                    <Share2 className='h-3.5 w-3.5' />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className='glass-card rounded-xl p-6 text-center'>
            <p className='text-sm' style={{ color: '#8A8A8A' }}>No closed positions yet</p>
            <p className='text-xs mt-1' style={{ color: '#555' }}>
              Closed positions with realized PnL appear here.
            </p>
          </div>
        )}
      </div>

      <PnlShareModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        trade={shareTrade}
      />
    </>
  );
}
