/**
 * WithdrawSolDialog
 *
 * Sends native SOL from the connected wallet to any Solana address.
 * Uses the `setSolTransfer` onchain collection function — the user signs
 * the transaction and SOL is deducted from their own connected/fund wallet.
 *
 * Max transferable = solBalance − 0.002 SOL (fee reserve), clamped to 0.
 * If balance cannot be determined, submit is still allowed (on-chain enforces sufficiency).
 */

import { setSolTransfer } from '@/lib/collections/solTransfer';
import { runSolBalanceQueryForCommonQueries } from '@/lib/collections/commonQueries';
import { Address } from '@/lib/db-client';
import { AlertTriangle, Send, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';

const FEE_RESERVE_SOL = 0.002;
const SOL_TO_LAMPORTS = 1_000_000_000;

// Shorten a Solana address: first 4 + … + last 4
function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// Validate a Solana address: base58 charset, length 32–44
function isValidSolanaAddress(addr: string): boolean {
  const trimmed = addr.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

interface WithdrawSolDialogProps {
  walletAddress: string;
  /** z-index class override — use 'z-[100]' for header widget, default 'z-50' for page */
  zClass?: string;
  onClose: () => void;
  onDone: () => void;
}

export function WithdrawSolDialog({
  walletAddress,
  zClass = 'z-50',
  onClose,
  onDone,
}: WithdrawSolDialogProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch native SOL balance via Poof/Poofnet query (@TokenPlugin.getBalance)
  useEffect(() => {
    if (!walletAddress) return;
    setBalanceLoading(true);
    const queryId = `sol-bal-${walletAddress}`;
    (async () => {
      try {
        const lamports = await runSolBalanceQueryForCommonQueries(queryId, { walletAddress });
        if (lamports > 0 || lamports === 0) {
          setSolBalance(lamports / SOL_TO_LAMPORTS);
        }
      } catch {
        // Balance unavailable — don't block submit
      } finally {
        setBalanceLoading(false);
      }
    })();
  }, [walletAddress]);

  // Max transferable = balance − fee reserve, clamped to 0 (null when balance unknown)
  const maxSol = solBalance !== null ? Math.max(solBalance - FEE_RESERVE_SOL, 0) : null;

  // Validation
  const recipientTrimmed = recipient.trim();
  const recipientInvalid = recipientTrimmed.length > 0 && !isValidSolanaAddress(recipientTrimmed);
  const parsedAmount = parseFloat(amount);
  const amountInvalid = amount.length > 0 && (isNaN(parsedAmount) || parsedAmount <= 0);
  // Only enforce max when we actually know the balance
  const amountTooHigh = maxSol !== null && !isNaN(parsedAmount) && parsedAmount > maxSol;
  const insufficientSol = maxSol !== null && maxSol <= 0;

  // If balance is unknown (null), still allow submit — let the chain enforce it
  const canSubmit =
    !submitting &&
    isValidSolanaAddress(recipientTrimmed) &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    !amountInvalid &&
    !amountTooHigh &&
    !insufficientSol;

  async function handleWithdraw() {
    if (!canSubmit) return;
    const lamports = Math.floor(parsedAmount * SOL_TO_LAMPORTS);
    setSubmitting(true);
    try {
      const transferId = crypto.randomUUID();
      const success = await setSolTransfer(transferId, {
        recipient: Address.publicKey(recipientTrimmed),
        amt: lamports,
      });
      if (success) {
        toast.success(`Sent ${parsedAmount.toFixed(parsedAmount < 0.001 ? 6 : 4)} SOL`);
        onDone();
      } else {
        errorToast("We couldn't send your SOL. Check your balance and try again.");
      }
    } catch (err) {
      console.error('[WITHDRAW SOL] failed:', err);
      errorToast("We couldn't send your SOL. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`}
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div className='glass-dialog w-full max-w-sm rounded-2xl p-5 space-y-4'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Send size={17} style={{ color: '#b794f6' }} />
            <h3 className='font-bold text-base'>Send SOL from Your Wallet</h3>
          </div>
          <button
            onClick={onClose}
            className='p-1.5 rounded-lg transition-colors'
            style={{ color: '#8A8A8A' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Source wallet — prominent callout */}
        <div
          className='flex items-center gap-2.5 rounded-xl px-3 py-2.5'
          style={{ background: 'rgba(183,148,246,0.09)', border: '1px solid rgba(183,148,246,0.22)' }}
        >
          <Wallet size={14} style={{ color: '#b794f6', flexShrink: 0 }} />
          <div className='flex flex-col gap-0.5 min-w-0'>
            <span className='text-[11px] font-semibold uppercase tracking-wide' style={{ color: '#b794f6' }}>
              From: Your connected wallet
            </span>
            <span className='text-xs font-mono tabular-nums truncate' style={{ color: '#a0a0b0' }}>
              {walletAddress ? shortAddress(walletAddress) : '—'}
            </span>
          </div>
          {/* Balance inline with the source row */}
          <div className='ml-auto text-right flex-shrink-0'>
            {balanceLoading ? (
              <span className='text-[11px]' style={{ color: '#555' }}>Loading…</span>
            ) : solBalance !== null ? (
              <>
                <div className='text-sm font-bold tabular-nums font-mono' style={{ color: '#b794f6' }}>
                  {solBalance.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })} SOL
                </div>
                {maxSol !== null && (
                  <div className='text-[10px]' style={{ color: '#555' }}>
                    max {maxSol <= 0 ? '0' : maxSol.toFixed(5)} sendable
                  </div>
                )}
              </>
            ) : (
              <span className='text-[11px]' style={{ color: '#555' }}>Balance unavailable</span>
            )}
          </div>
        </div>

        {/* Insufficient SOL warning */}
        {insufficientSol && (
          <div
            className='flex items-center gap-2 p-3 rounded-xl text-xs'
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)', color: '#f87171' }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            Insufficient SOL balance. You need more than 0.002 SOL to cover transaction fees.
          </div>
        )}

        {/* Recipient address */}
        <div>
          <label className='text-xs block mb-1' style={{ color: '#8A8A8A' }}>
            Send to (recipient address)
          </label>
          <input
            type='text'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder='Solana wallet address'
            spellCheck={false}
            autoComplete='off'
            className='glass-input w-full px-3 py-3 rounded-lg text-xs font-mono tabular-nums outline-none break-all'
            style={{
              borderColor: recipientInvalid ? 'rgba(239,68,68,0.40)' : undefined,
            }}
          />
          {recipientInvalid && (
            <p className='text-[11px] mt-1' style={{ color: '#f87171' }}>
              Invalid Solana address (base58, 32–44 characters)
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className='flex items-center justify-between mb-1'>
            <label className='text-xs' style={{ color: '#8A8A8A' }}>Amount (SOL)</label>
            <div className='flex items-center gap-2'>
              {!balanceLoading && maxSol !== null && maxSol > 0 && (
                <button
                  onClick={() => setAmount(maxSol.toFixed(6))}
                  disabled={submitting}
                  className='text-xs font-bold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50'
                  style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.27)' }}
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <input
            type='number'
            min='0'
            step='any'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='0.000000'
            className='glass-input w-full px-3 py-3 rounded-lg text-sm tabular-nums outline-none font-mono'
            style={{
              borderColor: (amountInvalid || amountTooHigh) ? 'rgba(239,68,68,0.40)' : undefined,
            }}
          />
          {amountTooHigh && (
            <p className='text-[11px] mt-1' style={{ color: '#f87171' }}>
              Amount exceeds max sendable ({maxSol?.toFixed(6)} SOL)
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleWithdraw}
          disabled={!canSubmit}
          className='w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
          style={{ background: canSubmit ? '#b794f6' : 'rgba(183,148,246,0.25)', color: '#fff' }}
        >
          <Send size={14} />
          {submitting ? 'Sending…' : insufficientSol ? 'Insufficient SOL' : 'Send SOL'}
        </button>

        <p className='text-[10px] text-center' style={{ color: '#555' }}>
          SOL is sent from your connected wallet (not your trading account). 0.002 SOL is reserved for fees.
        </p>
      </div>
    </div>
  );
}

export default WithdrawSolDialog;
