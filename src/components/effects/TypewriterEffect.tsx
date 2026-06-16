import { cn } from '@/lib/utils';
import { motion, useAnimation, useInView } from 'motion/react';
import { useEffect, useRef } from 'react';

interface TypewriterWord {
  text: string;
  className?: string;
}

interface TypewriterEffectProps {
  words: TypewriterWord[];
  className?: string;
  /** Class for the blinking cursor. */
  cursorClassName?: string;
  /** Cursor color. Default uses primary. */
  cursorColor?: string;
  /** Delay between characters in seconds. Default 0.06. */
  speed?: number;
  /** Hide cursor after typing completes. Default false. */
  hideCursorOnComplete?: boolean;
}

/**
 * Typing animation — great for hero headlines.
 *
 * ```tsx
 * <TypewriterEffect words={[{text:"Hello"},{text:"World",className:"text-primary"}]} />
 * ```
 */
export function TypewriterEffect({
  words,
  className,
  cursorClassName,
  cursorColor,
  speed = 0.06,
  hideCursorOnComplete = false,
}: TypewriterEffectProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const controls = useAnimation();

  const allChars = words.flatMap((word, wi) => {
    const chars = word.text.split('').map((char, ci) => ({
      char,
      wordClass: word.className,
      key: `${wi}-${ci}`,
    }));
    if (wi < words.length - 1) {
      chars.push({ char: '\u00A0', wordClass: undefined, key: `${wi}-space` });
    }
    return chars;
  });

  const totalDuration = allChars.length * speed;

  useEffect(() => {
    if (isInView) {
      controls.start('visible');
    }
  }, [isInView, controls]);

  return (
    <div ref={ref} className={cn('inline-flex items-center', className)}>
      <div className="inline">
        {allChars.map((c, i) => (
          <motion.span
            key={c.key}
            className={cn('inline-block', c.wordClass)}
            initial="hidden"
            animate={controls}
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1 },
            }}
            transition={{
              duration: 0.01,
              delay: i * speed,
            }}
          >
            {c.char}
          </motion.span>
        ))}
      </div>
      <motion.span
        className={cn(
          'ml-1 inline-block h-[1em] w-[3px] rounded-full',
          cursorClassName,
        )}
        style={{ backgroundColor: cursorColor ?? 'hsl(var(--primary))' }}
        animate={
          hideCursorOnComplete
            ? { opacity: [1, 0, 1, 1, 0] }
            : { opacity: [1, 0, 1] }
        }
        transition={
          hideCursorOnComplete
            ? { duration: 0.8, repeat: 0, delay: totalDuration + 0.5 }
            : { duration: 0.8, repeat: Infinity, ease: [1, 0, 1, 0] }
        }
      />
    </div>
  );
}
