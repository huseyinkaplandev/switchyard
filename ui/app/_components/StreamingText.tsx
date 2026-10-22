'use client';

import { useEffect, useRef, useState } from 'react';

/** Regardless of length, the reveal fits within this range. */
const MIN_DURATION_MS = 320;
const MAX_DURATION_MS = 1400;
/** Target time per word; the total is clamped to the range above. */
const MS_PER_WORD = 11;
/** One frame; updating more often makes no visible difference. */
const FRAME_MS = 16;

type Props = {
  text: string;
  /** True only for messages newly arrived from the stream. History renders instantly. */
  animate: boolean;
  className?: string;
  onAdvance?: () => void;
  /** Reveal finished: the caller can now render markdown. */
  onDone?: () => void;
};

/**
 * Reveals a live message word by word.
 *
 * The goal is not to add delay: the message already arrives complete. The
 * reveal only signals "just arrived", so long messages do not take longer --
 * speed is set by total duration, not per word.
 */
export default function StreamingText({ text, animate, className, onAdvance, onDone }: Props) {
  const words = useRef<string[]>([]);
  const [shown, setShown] = useState(() => (animate ? 0 : Number.POSITIVE_INFINITY));

  useEffect(() => {
    words.current = text.split(/(\s+)/);
    if (!animate) {
      setShown(Number.POSITIVE_INFINITY);
      return;
    }
    const total = words.current.length;
    const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, total * MS_PER_WORD));
    const perFrame = Math.max(1, Math.ceil(total / (duration / FRAME_MS)));
    setShown(0);
    let current = 0;
    const timer = window.setInterval(() => {
      current += perFrame;
      if (current >= total) {
        window.clearInterval(timer);
        setShown(Number.POSITIVE_INFINITY);
        onDone?.();
      } else {
        setShown(current);
      }
      onAdvance?.();
    }, FRAME_MS);
    return () => window.clearInterval(timer);
    // onAdvance is deliberately excluded: a callback that changes on every
    // render would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);

  const done = shown === Number.POSITIVE_INFINITY;
  const body = done ? text : words.current.slice(0, shown).join('');

  return (
    <div className={className}>
      {body}
      {!done && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-amber-300 align-middle" />}
    </div>
  );
}
