import { AuthContextType } from '@/components/types';
import { TAROBASE_CONFIG } from '@/lib/config';
import { useAuth } from '@pooflabs/web';
import { truncateAddress } from '@/utils/format-address';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, LogOut, RefreshCw, Wallet } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

// Kept for backwards compatibility with templates that import this type or pass
// a `variant` prop. The component now themes itself from CSS vars, so the value
// is accepted but ignored.
export type WalletButtonVariant = 'light' | 'dark';

interface WalletButtonProps {
  variant?: WalletButtonVariant;
}

// Isolated button styles that reset all inherited/global styles
const getIsolatedButtonBase = (): React.CSSProperties => ({
  all: 'unset',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});

// Theme-driven styles. Reads CSS vars set by ThemeProvider from src/theme.ts so
// the button auto-matches whatever palette the app picks. Fallbacks in var()'s
// second arg keep the button rendering on apps shipped before these vars existed.
const themeStyles = {
  button: {
    backgroundColor: 'hsl(var(--button, 0 0% 15%))',
    color: 'hsl(var(--button-foreground, 0 0% 90%))',
    border: '1px solid hsl(var(--button-border, 0 0% 22%))',
  },
  buttonHover: {
    backgroundColor: 'hsl(var(--button-hover, 0 0% 20%))',
    color: 'hsl(var(--button-hover-foreground, 0 0% 95%))',
    borderColor: 'hsl(var(--button-hover-border, 0 0% 40%))',
  },
  popup: {
    backgroundColor: 'hsl(var(--popover) / 0.98)',
    border: '1px solid hsl(var(--border) / 0.8)',
  },
  text: 'hsl(var(--foreground))',
  textMuted: 'hsl(var(--muted-foreground))',
  textStrong: 'hsl(var(--foreground))',
  cardBg:
    'linear-gradient(135deg, hsl(var(--primary) / 0.15) 0%, hsl(var(--accent) / 0.15) 50%, hsl(var(--secondary)) 100%)',
  itemBg: 'hsl(var(--secondary) / 0.5)',
  itemBorder: 'hsl(var(--border) / 0.8)',
  itemHoverBg: 'hsl(var(--secondary))',
  divider: 'hsl(var(--border) / 0.6)',
  iconColor: 'hsl(var(--primary))',
};

export const WalletButton: React.FC<WalletButtonProps> = (_props) => {
  const styles = themeStyles;
  const { user, loading, login, logout } = useAuth() as AuthContextType;
  const [isOpen, setIsOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const lastFetchTime = useRef<number>(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const FETCH_COOLDOWN = 5000;

  const fetchBalance = async () => {
    if (!user?.address || !TAROBASE_CONFIG.rpcUrl) {
      setBalance(null);
      setBalanceLoading(false);
      return;
    }

    setBalanceLoading(true);

    try {
      // Fetch native SOL balance
      const nativeSolResponse = await fetch(TAROBASE_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [user.address],
        }),
      });

      const nativeSolData = await nativeSolResponse.json();
      if (nativeSolData.error)
        throw new Error(nativeSolData.error.message || 'Failed to fetch balance');

      const balanceInSol = nativeSolData.result.value / 1_000_000_000;
      setBalance(balanceInSol);
    } catch (err) {
      console.error('Error fetching SOL balance:', err);
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  };

  const refetch = () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime.current;

    if (timeSinceLastFetch < FETCH_COOLDOWN) {
      const remaining = Math.ceil((FETCH_COOLDOWN - timeSinceLastFetch) / 1000);
      toast.info(`Please wait ${remaining}s before refreshing`);
      return;
    }

    lastFetchTime.current = now;
    fetchBalance();
  };

  useEffect(() => {
    lastFetchTime.current = 0;
    fetchBalance();
  }, [user?.address]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;

    const updatePopupPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const popupWidth = 320;
      const margin = 8;
      const nextLeft = Math.min(
        Math.max(rect.right - popupWidth, margin),
        window.innerWidth - popupWidth - margin
      );
      const nextTop = Math.max(rect.bottom + 8, margin);

      setPopupPosition({
        top: nextTop,
        left: nextLeft,
      });
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    updatePopupPosition();
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleLogin = async () => {
    try {
      await login();
    } catch (error) {
      console.error('Failed to login', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to logout', error);
    }
  };

  const getNetworkInfo = () => {
    const chain = TAROBASE_CONFIG.chain;
    const isInMockMode = chain === 'offchain';
    const isMainnet = chain === 'solana_mainnet' || chain === 'solana_mainnet_preview';
    const isSurfnet = chain === 'surfnet';
    return {
      name: isInMockMode ? 'Poofnet' : isMainnet ? 'Mainnet' : isSurfnet ? 'Surfnet' : 'Devnet',
      dotColor: isInMockMode
        ? '#b794f6' // light purple for poofnet
        : isMainnet
          ? '#22c55e' // green for mainnet
          : isSurfnet
            ? '#b794f6' // light purple for surfnet
            : '#8b5cf6', // medium purple for devnet
    };
  };

  const formatBalance = (bal: number | null) => {
    if (bal === null) return '0.00';
    return bal.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const shortenAddress = (address: string) => truncateAddress(address, 6, 4);

  const copyAddress = async () => {
    if (user?.address) {
      await navigator.clipboard.writeText(user.address);
      setJustCopied(true);
      toast.success('Address copied to clipboard');
      setTimeout(() => setJustCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div>
        <div
          style={{
            height: '36px',
            width: '140px',
            borderRadius: 'var(--radius)',
            backgroundColor: 'hsl(var(--muted))',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {!user ? (
        <motion.button
          onClick={handleLogin}
          style={{
            ...getIsolatedButtonBase(),
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: 'var(--radius)',
            gap: '8px',
            transition: 'all 0.2s ease',
            ...styles.button,
          }}
          whileHover={styles.buttonHover}
          whileTap={{ scale: 0.98 }}
        >
          <Wallet style={{ height: '16px', width: '16px' }} />
          Connect
        </motion.button>
      ) : (
        <div style={{ position: 'relative' }}>
          <motion.button
            ref={buttonRef}
            onClick={() => setIsOpen(!isOpen)}
            style={{
              ...getIsolatedButtonBase(),
              padding: '8px 12px',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: 'var(--radius)',
              gap: '8px',
              transition: 'all 0.2s ease',
              ...styles.button,
            }}
            whileHover={styles.buttonHover}
            whileTap={{ scale: 0.98 }}
          >
            <Wallet style={{ height: '16px', width: '16px' }} />
            <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
              {shortenAddress(user.address)}
            </span>
          </motion.button>

          {isMounted &&
            createPortal(
              <AnimatePresence>
                {isOpen && (
                  <div
                    style={{
                      position: 'fixed',
                      inset: 0,
                      zIndex: 2147483646,
                      pointerEvents: 'auto',
                    }}
                    onMouseDown={() => setIsOpen(false)}
                  >
                    <motion.div
                      ref={popupRef}
                      initial={{ opacity: 0, scale: 0.95, y: -8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -8 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      style={{
                        position: 'fixed',
                        top: `${popupPosition.top}px`,
                        left: `${popupPosition.left}px`,
                        width: '320px',
                        backgroundColor: styles.popup.backgroundColor,
                        borderRadius: 'calc(var(--radius) * 2)',
                        boxShadow:
                          '0 8px 32px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15)',
                        border: styles.popup.border,
                        overflow: 'hidden',
                        zIndex: 2147483647,
                        pointerEvents: 'auto',
                      }}
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => event.stopPropagation()}
                    >
                {/* Network Indicator */}
                <div
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: getNetworkInfo().dotColor,
                      boxShadow: `0 0 8px ${getNetworkInfo().dotColor}40`,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: styles.textMuted,
                    }}
                  >
                    {getNetworkInfo().name}
                  </span>
                </div>

                {/* Poofnet minting hint */}
                {getNetworkInfo().name === 'Poofnet' && (
                  <div
                    style={{
                      padding: '0 16px 8px',
                      fontSize: '11px',
                      color: styles.textMuted,
                      lineHeight: '1.4',
                    }}
                  >
                    App owner can use the poof UI's poofnet button to mint new fake test solana or other tokens directly to wallets.
                  </div>
                )}

                {/* Balance Card */}
                <div
                  style={{
                    margin: '0 16px 16px',
                    padding: '20px',
                    background: styles.cardBg,
                    borderRadius: 'calc(var(--radius) * 1.5)',
                    position: 'relative',
                  }}
                >
                  {/* Decorative circle */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '16px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255, 255, 255, 0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Wallet style={{ height: '24px', width: '24px', color: styles.iconColor }} />
                  </div>

                  <div style={{ marginLeft: '72px' }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: styles.text,
                        marginBottom: '4px',
                      }}
                    >
                      {getNetworkInfo().name} Wallet
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '24px',
                          fontWeight: 600,
                          color: styles.textStrong,
                        }}
                      >
                        {formatBalance(balance)} SOL
                      </span>
                      <motion.button
                        onClick={refetch}
                        disabled={balanceLoading}
                        style={{
                          ...getIsolatedButtonBase(),
                          padding: '4px',
                          backgroundColor: 'hsl(var(--secondary) / 0.6)',
                          border: 'none',
                          borderRadius: 'calc(var(--radius) * 0.75)',
                          cursor: balanceLoading ? 'not-allowed' : 'pointer',
                          justifyContent: 'center',
                          opacity: balanceLoading ? 0.5 : 1,
                        }}
                        whileHover={{
                          backgroundColor: 'hsl(var(--secondary) / 0.9)',
                        }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <RefreshCw
                          style={{
                            height: '14px',
                            width: '14px',
                            color: styles.textMuted,
                            animation: balanceLoading ? 'spin 1s linear infinite' : 'none',
                          }}
                        />
                      </motion.button>
                    </div>
                  </div>
                </div>

                {/* Wallet Address */}
                <div style={{ padding: '0 16px', marginBottom: '12px' }}>
                  <motion.button
                    onClick={copyAddress}
                    style={{
                      ...getIsolatedButtonBase(),
                      width: '100%',
                      padding: '12px 16px',
                      backgroundColor: styles.itemBg,
                      border: `1px solid ${styles.itemBorder}`,
                      borderRadius: 'calc(var(--radius) * 1.25)',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease',
                    }}
                    whileHover={{
                      backgroundColor: styles.itemHoverBg,
                      borderColor: 'hsl(var(--border))',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        color: styles.text,
                      }}
                    >
                      {shortenAddress(user.address)}
                    </span>
                    {justCopied ? (
                      <Check style={{ height: '16px', width: '16px', color: '#10b981' }} />
                    ) : (
                      <Copy style={{ height: '16px', width: '16px', color: styles.textMuted }} />
                    )}
                  </motion.button>
                </div>

                {/* Divider */}
                <div
                  style={{
                    height: '1px',
                    backgroundColor: styles.divider,
                    margin: '0 16px',
                  }}
                />

                {/* Logout Button */}
                <div style={{ padding: '12px 16px 16px' }}>
                  <motion.button
                    onClick={handleLogout}
                    style={{
                      ...getIsolatedButtonBase(),
                      width: '100%',
                      padding: '12px 16px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderRadius: 'calc(var(--radius) * 1.25)',
                      gap: '12px',
                      transition: 'all 0.2s ease',
                    }}
                    whileHover={{ backgroundColor: styles.itemBg }}
                  >
                    <LogOut style={{ height: '18px', width: '18px', color: styles.text }} />
                    <span
                      style={{
                        fontSize: '15px',
                        fontWeight: 500,
                        color: styles.text,
                      }}
                    >
                      Log out
                    </span>
                  </motion.button>
                </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>,
              document.body
            )}
        </div>
      )}

      {/* Keyframes for animations */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
};

export default WalletButton;
