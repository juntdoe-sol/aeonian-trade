import type { ReactNode } from 'react';

interface PageLayoutProps {
  children: ReactNode;
  /** Footer content — pass `false` to hide footer entirely */
  footer?: ReactNode | false;
  /** Background utility class: 'bg-grid-pattern', 'bg-dot-pattern', 'bg-gradient-spotlight', etc. */
  background?: string;
  /** Full-bleed mode removes the container constraint (useful for landing pages) */
  fullBleed?: boolean;
  className?: string;
}

export function PageLayout({
  children,
  footer,
  background = '',
  fullBleed = false,
  className = '',
}: PageLayoutProps) {
  return (
    <div className={`min-h-screen flex flex-col bg-background ${background} ${className}`}>
      {/* ── Main content ── */}
      <main className='flex-1 relative'>
        {fullBleed ? children : (
          <div className='container py-8'>
            {children}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      {footer !== false && (
        <footer className='relative border-t border-border/30'>
          <div className='absolute inset-0 bg-gradient-to-t from-background to-transparent pointer-events-none' />
          <div className='relative container py-8'>
            {footer || (
              <p className='text-center text-xs text-muted-foreground/60'>
                &copy; {new Date().getFullYear()}
              </p>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
