'use client';

import { useEffect, useRef } from 'react';
import DesktopHandoffPanel from './DesktopHandoffPanel';
import type { Locale } from '../_lib/translations';

export default function DesktopHandoffDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return <dialog ref={dialog} className="handoff-dialog" aria-labelledby="desktop-handoff-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <DesktopHandoffPanel locale={locale} onClose={onClose} />
  </dialog>;
}
