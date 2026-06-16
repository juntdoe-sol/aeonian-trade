import { useAds } from '@/hooks/use-ads';
import { useEffect, useRef, useState, useCallback } from 'react';

// Separated so the ref is owned by a component that mounts/unmounts with each ad.
function VideoAd({
  src,
  className,
  isFirst,
}: {
  src: string;
  className: string;
  isFirst: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Safari requires muted to be set programmatically for autoplay to work.
    video.muted = true;

    const attemptPlay = () => {
      video.play().catch(() => {
        // iOS Low Power Mode or other autoplay block — attach a one-time
        // user-gesture listener so the video starts on the user's first tap/click.
        const onGesture = () => {
          video.muted = true;
          video.play().catch(() => {/* still blocked, silently ignore */});
          document.removeEventListener('touchstart', onGesture);
          document.removeEventListener('click', onGesture);
        };
        document.addEventListener('touchstart', onGesture, { once: true, passive: true });
        document.addEventListener('click', onGesture, { once: true });
      });
    };

    // If the video is already ready enough to play, go immediately; otherwise wait.
    if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
      attemptPlay();
    } else {
      video.addEventListener('loadeddata', attemptPlay, { once: true });
    }

    return () => {
      video.removeEventListener('loadeddata', attemptPlay);
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      // preload="auto" tells the browser to buffer the full video immediately,
      // which means loadeddata fires faster and play() is never blocked on buffering.
      preload="auto"
      className={className}
    />
  );
}

const AUTO_ROTATE_MS = 7000;

export function AdsCarousel() {
  // useAds reads from a module-level singleton that starts subscribing at app
  // mount (before auth resolves), so data is frequently already cached here.
  const allAds = useAds();

  const activeAds = allAds
    .filter((a) => a.active)
    .sort((a, b) => b.createdAt - a.createdAt);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset index if ads list changes (e.g., ad deleted)
  useEffect(() => {
    setCurrentIndex((prev) => (activeAds.length > 0 ? Math.min(prev, activeAds.length - 1) : 0));
  }, [activeAds.length]);

  const next = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % activeAds.length);
  }, [activeAds.length]);

  // Auto-rotate — timerKey in deps lets manual navigation restart the 7s countdown
  useEffect(() => {
    if (activeAds.length <= 1 || isPaused) return;
    intervalRef.current = setInterval(next, AUTO_ROTATE_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeAds.length, isPaused, next, timerKey]);

  if (!activeAds || activeAds.length === 0) return null;

  const ad = activeAds[currentIndex];
  if (!ad) return null;

  const isClickable = !!ad.linkUrl;
  const isFirstSlide = currentIndex === 0;

  // The inner slide content (media + text overlay)
  const slideContent = (
    <div
      className='relative w-full overflow-hidden'
      style={{ aspectRatio: '1/1', background: '#0d0d12' }}
    >
      {ad.mediaType === 'video' ? (
        <VideoAd
          key={ad.id}
          src={ad.mediaUrl}
          isFirst={isFirstSlide}
          className='absolute inset-0 w-full h-full object-cover'
        />
      ) : (
        <img
          key={ad.id}
          src={ad.mediaUrl}
          alt={ad.title}
          // fetchpriority="high" tells the browser to prioritise fetching this
          // image over lower-priority resources so it appears instantly.
          fetchPriority={isFirstSlide ? 'high' : 'auto'}
          // decoding="async" lets the browser decode in a background thread
          // without blocking paint.
          decoding='async'
          className='absolute inset-0 w-full h-full object-cover'
          style={{ transition: 'opacity 0.35s ease' }}
        />
      )}
      {/* Gradient overlay for text legibility */}
      <div
        className='absolute inset-0'
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 45%, transparent 100%)',
        }}
      />
      {/* Text overlay */}
      {ad.description && (
        <div className='absolute bottom-0 left-0 right-0 px-3 pb-3'>
          <p className='text-xs leading-snug' style={{ color: 'rgba(255,255,255,0.7)' }}>
            {ad.description}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div
      className='w-full mt-3'
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Slide */}
      <div
        className='relative overflow-hidden rounded-xl glass-card'
        style={{ border: '1px solid rgba(183,148,246,0.12)' }}
      >
        {/* Media — wrapped in anchor if linkUrl is set */}
        {isClickable ? (
          <a
            href={ad.linkUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='block cursor-pointer'
            style={{ display: 'block' }}
            title={ad.title}
          >
            {slideContent}
          </a>
        ) : (
          slideContent
        )}

        {/* Dots */}
        {activeAds.length > 1 && (
          <div className='absolute bottom-2.5 right-3 flex items-center gap-1' style={{ zIndex: 10 }}>
            {activeAds.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setCurrentIndex(i); setTimerKey((k) => k + 1); }}
                className='rounded-full transition-all'
                style={{
                  width: i === currentIndex ? 16 : 5,
                  height: 5,
                  background: i === currentIndex ? '#b794f6' : 'rgba(255,255,255,0.3)',
                }}
                aria-label={`Go to ad ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
