import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/hooks/use-theme';
import { JSX, lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { DesktopBlock } from '@/components/DesktopBlock';
import { OAuthProvider } from '@/contexts/OAuthContext';
import { useMobile } from '@/hooks/use-mobile';
import { disableZoom } from '@/utils/disable-zoom';

function ScrollToTop(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    // The app scrolls inside the #app-main region (the document itself is locked
    // to kill iOS overscroll bounce), so reset that element on navigation.
    const scroller = document.getElementById('app-main');
    if (scroller) scroller.scrollTo(0, 0);
    else window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const TradePage = lazy(() => import('@/components/TradePage'));
const PortfolioPage = lazy(() => import('@/components/PortfolioPage'));
const LicensePage = lazy(() => import('@/components/LicensePage'));
const CopyrightPage = lazy(() => import('@/components/CopyrightPage'));
const PrivacyPage = lazy(() => import('@/components/PrivacyPage'));
const AdminDashboard = lazy(() => import('@/components/AdminDashboard'));
const BattlesPage = lazy(() => import('@/components/BattlesPage'));
const CreateBattlePage = lazy(() => import('@/components/CreateBattlePage'));
const BattleDetailPage = lazy(() => import('@/components/BattleDetailPage'));
const RoyalRumbleDetailPage = lazy(() => import('@/components/RoyalRumbleDetailPage'));
const RewardsPage = lazy(() => import('@/components/RewardsPage'));
const AboutPage = lazy(() => import('@/components/AboutPage'));
const DownloadPage = lazy(() => import('@/components/DownloadPage'));

function TradePageCanonical(): JSX.Element {
  const { symbol } = useParams<{ symbol: string }>();
  if (!symbol || !/-PERP$/i.test(symbol)) {
    return <Navigate to={`/trade/${(symbol ?? 'SOL').replace(/-PERP$/i, '') + '-PERP'}`} replace />;
  }
  return <TradePage />;
}

function App(): JSX.Element {
  // On mobile the wallet approval bottom-sheet (Phantom / Privy embedded wallet) slides
  // up from the bottom and its Sign/approve button sits near the bottom edge. Toasts
  // (e.g. the transient "…approve in wallet…" pending status shown during a trade
  // open/close) default to the bottom on mobile and cover that Sign button. Anchor toasts
  // to the top on mobile so they never overlap the wallet sheet. Desktop keeps the default.
  const isMobile = useMobile();

  // Disable iOS Safari pinch-zoom and double-tap-zoom app-wide (chart zone is exempt).
  useEffect(() => {
    disableZoom();
  }, []);
  return (
    <ThemeProvider>
      <OAuthProvider>
      <DesktopBlock>
        <div
          id='app-container'
          className='relative h-[100dvh] overflow-hidden flex flex-col bg-background'
        >
          {/* Animated mesh gradient background */}
          <div className='animated-mesh-bg' aria-hidden='true' />
          <ScrollToTop />
          <main id='app-main' className='flex-1 relative z-10'>
            <Suspense fallback={null}>
              <Routes>
                <Route path='/' element={<Navigate to='/trade/SOL-PERP' replace />} />
                <Route path='/trade' element={<Navigate to='/trade/SOL-PERP' replace />} />
                <Route path='/trade/:symbol' element={<TradePageCanonical />} />
                <Route path='/portfolio' element={<PortfolioPage />} />
                <Route path='/license' element={<LicensePage />} />
                <Route path='/copyright' element={<CopyrightPage />} />
                <Route path='/privacy' element={<PrivacyPage />} />
                <Route path='/admin' element={<AdminDashboard />} />
                <Route path='/battles' element={<BattlesPage />} />
                <Route path='/battles/new' element={<CreateBattlePage />} />
                <Route path='/battles/:battleId' element={<BattleDetailPage />} />
                <Route path='/rumble/:battleId' element={<RoyalRumbleDetailPage />} />
                <Route path='/rewards' element={<RewardsPage />} />
                <Route path='/about' element={<AboutPage />} />
                <Route path='/download' element={<DownloadPage />} />
              </Routes>
            </Suspense>
          </main>

          <Toaster position={isMobile ? 'top-center' : 'bottom-right'} />
        </div>
      </DesktopBlock>
      </OAuthProvider>
    </ThemeProvider>
  );
}

export default App;
