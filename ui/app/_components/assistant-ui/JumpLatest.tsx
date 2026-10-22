'use client';
import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { TRANSLATIONS, type Locale } from '../../_lib/translations';
export default function JumpLatest({ container, locale }: { container: RefObject<HTMLDivElement | null>; locale: Locale }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = container.current; if (!element) return;
    const check = () => setVisible(element.scrollHeight - element.scrollTop - element.clientHeight > 180);
    element.addEventListener('scroll', check, { passive: true });
    const observer = new ResizeObserver(check); observer.observe(element);
    check(); return () => { element.removeEventListener('scroll', check); observer.disconnect(); };
  }, [container]);
  return visible ? <button type="button" className="aui-native-jump" onClick={() => container.current?.scrollTo({ top: container.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><ArrowDown size={14}/>{TRANSLATIONS[locale].auiJumpLatest}</button> : null;
}
