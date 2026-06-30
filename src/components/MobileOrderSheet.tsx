/**
 * MobileOrderSheet — slide-up bottom sheet for mobile order entry on TradePage.
 *
 * - Opens when the user taps the persistent Long or Short button bar.
 * - Blurred frosted backdrop; chart/orderbook stays visible behind it.
 * - Partial overlay: sheet covers ~75% of the viewport, leaving the top visible.
 * - Drag-handle at top; dismissible by dragging down or tapping the backdrop.
 * - Flat dark Phantom-style background (#0d0d0d / #1a1a1f surfaces).
 * - Desktop: never rendered (gated in TradePage by isDesktopLayout).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { HyperliquidOrderTicket } from './trading/HyperliquidOrderTicket';
import type { TraderData } from '@/utils/phoenix-mappers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MobileOrderSheetProps {
  open: boolean;
  onClose: () => void;
  initialSide: 'buy' | 'sell';
  symbol: string;
  markPrice: number | undefined;
  isBlocked: boolean;
  traderData: TraderData | null;
  loading?: boolean;
  maxLeverage?: number;
  isolatedOnly?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Sheet height as a fraction of viewport height
const SHEET_HEIGHT_VH = 0.78;
// Minimum drag-down distance (px) to dismiss the sheet
const DISMISS_THRESHOLD = 60;
// Snap-back velocity threshold (px/ms) — fast flick also dismisses
const DISMISS_VELOCITY = 0.4;

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileOrderSheet({
  open,
  onClose,
  initialSide,
  symbol,
  markPrice,
  isBlocked,
  traderData,
  loading,
  maxLeverage,
  isolatedOnly,
}: MobileOrderSheetProps) {
  // Whether the sheet is actually mounted (stays true briefly while closing for exit animation)
  const [mounted, setMounted] = useState(false);
  // Visible = sheet has slid up (controls transform)
  const [visible, setVisible] = useState(false);
  // Current drag offset (positive = dragged down)
  const [dragY, setDragY] = useState(0);
  // Monotonic open counter — increments each time the sheet opens so sheetKey always changes
  const openCountRef = useRef(0);
  const [openCount, setOpenCount] = useState(0);

  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  // Open / close lifecycle
  useEffect(() => {
    if (open) {
      openCountRef.current += 1;
      setOpenCount(openCountRef.current);
      setMounted(true);
      setDragY(0);
      // Slight defer so CSS transition fires after mount
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // Unmount after exit animation completes (300ms)
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Dismiss helper — animate out then call onClose
  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      setDragY(0);
      onClose();
    }, 300);
  }, [onClose]);

  // ── Touch handlers for drag-to-dismiss ──────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartYRef.current = touch.clientY;
    lastTouchTimeRef.current = Date.now();
    isDraggingRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const touch = e.touches[0];
    const delta = touch.clientY - touchStartYRef.current;
    // Only allow dragging DOWN (positive delta)
    if (delta < 0) return;
    isDraggingRef.current = true;
    lastTouchTimeRef.current = Date.now();
    setDragY(delta);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    const dt = Date.now() - lastTouchTimeRef.current;
    const velocity = dt > 0 ? dragY / dt : 0;

    if (dragY >= DISMISS_THRESHOLD || velocity >= DISMISS_VELOCITY) {
      dismiss();
    } else {
      // Snap back
      setDragY(0);
    }

    touchStartYRef.current = null;
    isDraggingRef.current = false;
  }, [dragY, dismiss]);

  if (!mounted) return null;

  const sheetHeightPx = typeof window !== 'undefined'
    ? Math.round(window.innerHeight * SHEET_HEIGHT_VH)
    : 560;

  const translateY = visible ? `${dragY}px` : `${sheetHeightPx + 40}px`;
  const opacity = visible ? Math.max(0, 1 - dragY / sheetHeightPx) : 0;

  return (
    <>
      {/* Blurred frosted backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          background: 'rgba(0,0,0,0.65)',
          opacity,
          transition: visible
            ? 'opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
            : 'opacity 0.28s ease-in',
          pointerEvents: visible ? 'auto' : 'none',
        }}
        aria-hidden='true'
      />

      {/* The sheet itself */}
      <div
        ref={sheetRef}
        role='dialog'
        aria-modal='true'
        aria-label='Order entry'
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 90,
          height: `${sheetHeightPx}px`,
          transform: `translateY(${translateY})`,
          transition: isDraggingRef.current
            ? 'none'
            : visible
            ? 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
            : 'transform 0.28s cubic-bezier(0.4, 0, 1, 1)',
          background: '#0d0d0d',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.6), 0 -1px 0px rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle area — touch target for drag-to-dismiss */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            flexShrink: 0,
            paddingTop: 10,
            paddingBottom: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            cursor: 'grab',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {/* Visual drag pill */}
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.18)',
            }}
          />

          {/* Sheet header: symbol label + close button */}
          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.02em',
              }}
            >
              {symbol.endsWith('-PERP') ? symbol.slice(0, -5) : symbol} Order
            </span>
            <button
              onClick={dismiss}
              aria-label='Close order sheet'
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Thin accent border below header */}
        <div
          style={{
            height: 1,
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 30%, rgba(255,255,255,0.07) 70%, transparent)',
            flexShrink: 0,
          }}
        />

        {/* Scrollable order ticket content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 16px 32px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <HyperliquidOrderTicket
            symbol={symbol}
            markPrice={markPrice}
            isBlocked={isBlocked}
            traderData={traderData}
            loading={loading}
            maxLeverage={maxLeverage}
            isolatedOnly={isolatedOnly}
            initialSide={initialSide}
            sheetKey={`${initialSide}-${openCount}`}
            onSuccess={dismiss}
          />
        </div>
      </div>
    </>
  );
}

export default MobileOrderSheet;
