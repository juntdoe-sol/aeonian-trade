import { AnimatePresence, motion, useInView, type Variants } from 'motion/react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  /** Animation duration in seconds. Default 0.4. */
  duration?: number;
  /** Stagger delay in seconds. Default 0. */
  delay?: number;
  /** Slide distance in px. Default 6. */
  offset?: number;
  /** Slide direction. Default "up". */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Only animate when scrolled into view. Default true. */
  inView?: boolean;
  /** Blur amount. Default "6px". */
  blur?: string;
}

/**
 * Scroll-triggered blur+fade entrance animation. Wrap any element.
 *
 * ```tsx
 * <BlurFade delay={0.1}>
 *   <h2>Title</h2>
 * </BlurFade>
 * <BlurFade delay={0.2}>
 *   <p>Description</p>
 * </BlurFade>
 * ```
 */
export function BlurFade({
  children,
  className,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = 'up',
  inView = true,
  blur = '6px',
}: BlurFadeProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const show = !inView || isInView;

  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const sign = direction === 'right' || direction === 'down' ? -1 : 1;

  const variants: Variants = {
    hidden: { [axis]: offset * sign, opacity: 0, filter: `blur(${blur})` },
    visible: { [axis]: 0, opacity: 1, filter: 'blur(0px)' },
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={show ? 'visible' : 'hidden'}
        variants={variants}
        transition={{ delay: 0.04 + delay, duration, ease: 'easeOut' }}
        className={cn(className)}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
