import { useState } from 'react';
import { Download, Smartphone, Share, Plus, CheckCircle, AlertCircle, ChevronLeft, Store, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeApkRelease, ApkReleaseResponse } from '@/lib/collections/apkRelease';
import { APK_RELEASE_ID } from '@/lib/constants';
import { AppHeader } from './AppHeader';
import { useAppLogo } from '@/hooks/use-app-logo';

type Device = 'seeker' | 'android' | 'ios';

const IOS_STEPS = [
  {
    icon: Smartphone,
    label: 'Open Safari',
    desc: 'Visit aeonian.trade in Safari on your iPhone or iPad.',
  },
  {
    icon: Share,
    label: 'Tap the Share button',
    desc: 'Tap the Share icon (the box with an arrow) at the bottom of the Safari toolbar.',
  },
  {
    icon: Plus,
    label: 'Tap "Add to Home Screen"',
    desc: 'Scroll down in the menu and tap "Add to Home Screen".',
  },
  {
    icon: CheckCircle,
    label: 'Install AEONIAN',
    desc: 'Tap Add to confirm. AEONIAN will appear on your home screen — tap it to launch.',
  },
];

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Device picker cards ──────────────────────────────────────────────────────

const DEVICES: { id: Device; label: string; sub: string; color: string; icon: React.ReactNode }[] = [
  {
    id: 'seeker',
    label: 'Seeker',
    sub: 'Solana Mobile phone',
    color: '#b794f6',
    icon: (
      <img
        src='https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2797551e4d376819b25f18'
        alt='Seeker'
        style={{ height: 32, width: 32, objectFit: 'contain', borderRadius: '50%' }}
      />
    ),
  },
  {
    id: 'android',
    label: 'Android',
    sub: 'Android Phone',
    color: '#10B981',
    icon: (
      <svg viewBox='0 0 24 24' fill='none' width={24} height={24} style={{ color: '#FFFFFF' }}>
        <path
          d='M17.6 11.8a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2ZM6.4 11.8a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2ZM15.6 5.4 17 3.8M8.4 5.4 7 3.8M5 10v6a2 2 0 0 0 2 2h1v2.5a1.5 1.5 0 0 0 3 0V18h2v2.5a1.5 1.5 0 0 0 3 0V18h1a2 2 0 0 0 2-2v-6H5ZM7 10a5 5 0 0 1 10 0'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    ),
  },
  {
    id: 'ios',
    label: 'iPhone / iPad',
    sub: 'IOS device',
    color: '#60A5FA',
    icon: (
      <svg viewBox='0 0 24 24' fill='currentColor' width={22} height={22} style={{ color: '#FFFFFF' }}>
        <path d='M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z' />
      </svg>
    ),
  },
];

// ─── Google Play coming soon badge ───────────────────────────────────────────

function GooglePlayComingSoon() {
  return (
    <div
      className='flex items-center gap-3 px-4 py-3 rounded-xl w-full'
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.14)',
        cursor: 'default',
      }}
    >
      {/* Google Play triangle icon */}
      <div
        className='flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center'
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)' }}
      >
        <svg viewBox='0 0 24 24' width={18} height={18} fill='none'>
          <path d='M4.5 3.5c-.27.16-.5.46-.5.85v15.3c0 .39.23.69.5.85l.08.04 8.57-8.57v-.2L4.58 3.46z' fill='#4FC3F7' />
          <path d='M15.8 15.47l-2.65-2.64v-.2l2.65-2.65.06.03 3.13 1.78c.9.51.9 1.34 0 1.85l-3.13 1.78z' fill='#FFCA28' />
          <path d='M15.86 15.44L13.15 12.73 4.5 21.38c.3.32.78.35 1.34.04z' fill='#F44336' />
          <path d='M15.86 10.56L5.84 4.58C5.28 4.27 4.8 4.3 4.5 4.62l8.65 8.65z' fill='#4CAF50' />
        </svg>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 mb-0.5'>
          <span className='text-[10px] font-semibold uppercase tracking-widest' style={{ color: '#9A9A9A', fontFamily: "'IBM Plex Mono', monospace" }}>
            Get it on
          </span>
          <span
            className='text-[9px] font-bold px-1.5 py-0.5 rounded'
            style={{
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.4)',
              color: '#F59E0B',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.08em',
            }}
          >
            COMING SOON
          </span>
        </div>
        <div className='text-xs font-semibold leading-none' style={{ color: '#E5E5E5', fontFamily: "'Inter', system-ui, sans-serif" }}>
          Google Play
        </div>
      </div>
    </div>
  );
}

// ─── App Store coming soon badge ──────────────────────────────────────────────

function AppStoreComingSoon() {
  return (
    <div
      className='flex items-center gap-3 px-4 py-3 rounded-xl w-full'
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.14)',
        cursor: 'default',
      }}
    >
      {/* Apple logo */}
      <div
        className='flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center'
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)' }}
      >
        <svg viewBox='0 0 24 24' fill='currentColor' width={18} height={18} style={{ color: '#E5E5E5' }}>
          <path d='M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z' />
        </svg>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2 mb-0.5'>
          <span className='text-[10px] font-semibold uppercase tracking-widest' style={{ color: '#9A9A9A', fontFamily: "'IBM Plex Mono', monospace" }}>
            Download on the
          </span>
          <span
            className='text-[9px] font-bold px-1.5 py-0.5 rounded'
            style={{
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.4)',
              color: '#F59E0B',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.08em',
            }}
          >
            COMING SOON
          </span>
        </div>
        <div className='text-xs font-semibold leading-none' style={{ color: '#E5E5E5', fontFamily: "'Inter', system-ui, sans-serif" }}>
          App Store
        </div>
      </div>
    </div>
  );
}

// ─── Seeker section ───────────────────────────────────────────────────────────

function SeekerSection() {
  return (
    <div className='glass-card rounded-2xl overflow-hidden'>
      <div
        className='h-px w-full'
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(167,139,250,0.6) 50%, transparent 100%)' }}
      />
      <div className='p-5 space-y-5'>
        {/* Header */}
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h2 className='text-base font-bold mb-1' style={{ color: '#FFFFFF', fontFamily: "'Inter', system-ui, sans-serif" }}>
              Seeker dApp Store
            </h2>
            <p className='text-xs leading-relaxed' style={{ color: '#8A8A8A' }}>
              Aeonian is live on the Solana Seeker dApp Store — the optimised native experience for your Seeker device.
            </p>
          </div>
          <div
            className='flex-shrink-0 flex items-center justify-center rounded-xl'
            style={{ background: '#FFFFFF', padding: '8px 12px', minWidth: 80, height: 52, boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
          >
            <img
              src='https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a278f5ce2546e5667d2d193'
              alt='Seeker'
              style={{ height: 32, width: 'auto', objectFit: 'contain' }}
            />
          </div>
        </div>

        {/* Live badge */}
        <div
          className='flex items-center gap-2 px-4 py-3 rounded-xl'
          style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}
        >
          <span className='w-2 h-2 rounded-full flex-shrink-0' style={{ background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
          <span className='text-xs font-semibold' style={{ color: '#b794f6', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.05em' }}>
            NOW LIVE
          </span>
          <span className='text-xs' style={{ color: '#8A8A8A' }}>on Seeker dApp Store</span>
        </div>

        {/* CTA steps */}
        <div className='space-y-2.5'>
          {[
            { num: 1, label: 'Open the dApp Store', desc: 'On your Seeker device, open the built-in dApp Store app.' },
            { num: 2, label: 'Search for AEONIAN', desc: 'Type "Aeonian" in the search bar to find the app.' },
            { num: 3, label: 'Install and trade', desc: 'Tap Install. Launch AEONIAN and start trading perps.' },
          ].map((step) => (
            <div
              key={step.num}
              className='flex items-start gap-3 px-3 py-3 rounded-xl'
              style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.12)' }}
            >
              <div
                className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold'
                style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.35)', color: '#b794f6', fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {step.num}
              </div>
              <div>
                <div className='text-xs font-semibold mb-0.5' style={{ color: '#E5E5E5' }}>{step.label}</div>
                <div className='text-xs leading-relaxed' style={{ color: '#8A8A8A' }}>{step.desc}</div>
              </div>
              {step.num === 3 && <Store size={14} className='flex-shrink-0 mt-0.5' style={{ color: '#b794f6', opacity: 0.7 }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Android section ──────────────────────────────────────────────────────────

function buildApkFilename(version: string): string {
  // Strip a leading v/V so we don't get "Aeonian_vv1.0.3.apk"
  const stripped = version.replace(/^[vV]/, '');
  // Replace any character that isn't alphanumeric, dot, underscore, or dash with underscore
  const safe = stripped.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `Aeonian_v${safe}.apk`;
}

function AndroidSection({ release }: { release: ApkReleaseResponse | null }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!release || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(release.fileUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = buildApkFilename(release.version);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error('Download failed — opening file directly instead.');
      window.open(release.fileUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className='glass-card rounded-2xl overflow-hidden'>
      <div
        className='h-px w-full'
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.4) 50%, transparent 100%)' }}
      />
      <div className='p-5 space-y-4'>
        <div>
          <h2 className='text-base font-bold mb-0.5' style={{ color: '#FFFFFF', fontFamily: "'Inter', system-ui, sans-serif" }}>
            Android APK
          </h2>
          <p className='text-xs' style={{ color: '#8A8A8A' }}>Direct install for Android devices not running Seeker OS</p>
        </div>

        {release ? (
          <div className='space-y-3'>
            <div
              className='flex items-center justify-between px-3 py-2.5 rounded-xl'
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)' }}
            >
              <div className='space-y-0.5'>
                <div className='text-xs font-semibold' style={{ color: '#10B981', fontFamily: "'IBM Plex Mono', monospace" }}>
                  v{release.version}
                </div>
                <div className='text-[10px]' style={{ color: '#4A4A4A', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {release.fileName}
                </div>
              </div>
              <div className='text-[10px]' style={{ color: '#4A4A4A', fontFamily: "'IBM Plex Mono', monospace" }}>
                {formatDate(release.updatedAt)}
              </div>
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className='flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-semibold transition-all'
              style={{
                background: 'linear-gradient(135deg, rgba(16,185,129,0.35) 0%, rgba(5,150,105,0.3) 100%)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#ECFDF5',
                fontFamily: "'Inter', system-ui, sans-serif",
                cursor: downloading ? 'not-allowed' : 'pointer',
                opacity: downloading ? 0.75 : 1,
              }}
            >
              {downloading ? (
                <>
                  <Loader2 size={16} className='animate-spin' />
                  Preparing…
                </>
              ) : (
                <>
                  <Download size={16} />
                  Download APK
                </>
              )}
            </button>

            {/* Google Play coming soon badge */}
            <GooglePlayComingSoon />

            <div className='flex items-start gap-2'>
              <AlertCircle size={12} className='flex-shrink-0 mt-0.5' style={{ color: '#F59E0B' }} />
              <p className='text-[10px] leading-relaxed' style={{ color: '#6A6A6A' }}>
                Enable "Install from unknown sources" in Android Settings &rarr; Security before installing.
              </p>
            </div>
          </div>
        ) : (
          <div className='space-y-3'>
            <div
              className='flex flex-col items-center gap-2 py-5 rounded-xl'
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}
            >
              <span className='text-2xl'>🔧</span>
              <p className='text-xs text-center' style={{ color: '#4A4A4A', fontFamily: "'IBM Plex Mono', monospace" }}>
                No build available yet
              </p>
            </div>
            {/* Google Play coming soon badge */}
            <GooglePlayComingSoon />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── iOS section ──────────────────────────────────────────────────────────────

function IosSection() {
  return (
    <div className='glass-card rounded-2xl overflow-hidden'>
      <div
        className='h-px w-full'
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.4) 50%, transparent 100%)' }}
      />
      <div className='p-5 space-y-4'>
        {/* Header */}
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h2 className='text-base font-bold mb-0.5' style={{ color: '#FFFFFF', fontFamily: "'Inter', system-ui, sans-serif" }}>
              Install AEONIAN
            </h2>
          </div>
        </div>

        {/* App-store-style badge */}
        <div
          className='flex items-center gap-2 px-4 py-3 rounded-xl'
          style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}
        >
          <svg viewBox='0 0 24 24' fill='currentColor' width={14} height={14} style={{ color: '#60A5FA', flexShrink: 0 }}>
            <path d='M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z' />
          </svg>
          <span className='text-xs font-semibold' style={{ color: '#60A5FA', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.05em' }}>
            iPhone &amp; iPad
          </span>
          <span className='text-xs' style={{ color: '#8A8A8A' }}>Free · No App Store needed</span>
        </div>

        {/* Install steps */}
        <div className='space-y-2.5'>
          {IOS_STEPS.map((step, i) => (
            <div
              key={i}
              className='flex items-start gap-3 px-3 py-3 rounded-xl'
              style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)' }}
            >
              <div
                className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold'
                style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60A5FA', fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {i + 1}
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-xs font-semibold mb-0.5' style={{ color: '#E5E5E5' }}>{step.label}</div>
                <div className='text-xs leading-relaxed' style={{ color: '#8A8A8A' }}>{step.desc}</div>
              </div>
              <step.icon size={15} className='flex-shrink-0 mt-0.5' style={{ color: '#60A5FA', opacity: 0.7 }} />
            </div>
          ))}
        </div>

        {/* App Store coming soon badge */}
        <AppStoreComingSoon />

        {/* Confirmation note */}
        <div
          className='flex items-start gap-2 px-3 py-2.5 rounded-xl'
          style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}
        >
          <CheckCircle size={12} className='flex-shrink-0 mt-0.5' style={{ color: '#60A5FA' }} />
          <p className='text-[10px] leading-relaxed' style={{ color: '#6A6A6A' }}>
            AEONIAN opens full-screen with no browser bar — the same experience as any app you download.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DownloadPage() {
  const [selected, setSelected] = useState<Device | null>(null);
  const appLogo = useAppLogo();

  const { data: release } = useRealtimeData<ApkReleaseResponse | null>(
    subscribeApkRelease,
    true,
    APK_RELEASE_ID,
  );

  return (
    <div className='min-h-screen pb-20 text-white'>
      <AppHeader />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className='px-4 pt-8 pb-6 text-center relative'>
        {/* App logo */}
        {appLogo && (
          <div className='flex justify-center mb-5'>
            <img
              src={appLogo}
              alt='AEONIAN'
              style={{
                height: 72,
                width: 72,
                objectFit: 'contain',
                borderRadius: 16,
              }}
            />
          </div>
        )}
        <div
          className='absolute inset-0 pointer-events-none'
          style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(139,92,246,0.12) 0%, transparent 70%)' }}
        />
        <div className='relative'>
          <h1
            className='text-3xl font-bold leading-tight mb-2'
            style={{ color: '#FFFFFF', fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: '-0.02em' }}
          >
            Get the Aeonian dApp
          </h1>
          <p className='text-sm leading-relaxed max-w-xs mx-auto' style={{ color: '#8A8A8A' }}>
            Trade perpetual futures from your pocket.{' '}
            {selected ? 'Your download instructions are below.' : 'Choose your device to get started.'}
          </p>
        </div>
      </div>

      <div className='px-4 max-w-md mx-auto space-y-5'>

        {/* ── Device picker ──────────────────────────────────────────────── */}
        {!selected && (
          <div className='space-y-3'>
            {DEVICES.map((device) => (
              <button
                key={device.id}
                onClick={() => setSelected(device.id)}
                className='w-full text-left rounded-2xl overflow-hidden transition-transform active:scale-[0.98]'
                style={{ background: 'transparent' }}
              >
                <div className='glass-card rounded-2xl overflow-hidden'>
                  <div
                    className='h-px w-full'
                    style={{ background: `linear-gradient(90deg, transparent 0%, ${device.color}80 50%, transparent 100%)` }}
                  />
                  <div className='flex items-center gap-4 px-5 py-4'>
                    <div
                      className='w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0'
                      style={{ background: `${device.color}18`, border: `1px solid ${device.color}30` }}
                    >
                      {device.icon}
                    </div>
                    <div className='flex-1'>
                      <div className='text-sm font-bold' style={{ color: '#FFFFFF', fontFamily: "'Inter', system-ui, sans-serif" }}>
                        {device.label}
                      </div>
                      <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>{device.sub}</div>
                    </div>
                    <svg width={16} height={16} viewBox='0 0 16 16' fill='none' style={{ color: '#4A4A4A', flexShrink: 0 }}>
                      <path d='M6 4l4 4-4 4' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Back button + selected content ────────────────────────────── */}
        {selected && (
          <div className='space-y-4'>
            <button
              onClick={() => setSelected(null)}
              className='flex items-center gap-1.5 text-xs transition-colors hover:text-white'
              style={{ color: '#6A6A6A', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              <ChevronLeft size={14} />
              Change device
            </button>

            {selected === 'seeker' && <SeekerSection />}
            {selected === 'android' && <AndroidSection release={release} />}
            {selected === 'ios' && <IosSection />}
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className='text-center pb-6'>
          <Link
            to='/trade/SOL-PERP'
            className='text-xs transition-colors hover:text-white'
            style={{ color: '#4A4A4A' }}
          >
            ← Back to Trade
          </Link>
        </div>
      </div>
    </div>
  );
}

export default DownloadPage;
