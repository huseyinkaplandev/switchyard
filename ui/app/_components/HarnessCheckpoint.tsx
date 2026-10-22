'use client';
import { Scissors } from 'lucide-react';
import { TRANSLATIONS, type Locale } from '../_lib/translations';
import MessageMarkdown from './MessageMarkdown';
export default function HarnessCheckpoint({ id, text, locale }: { id?: string; text: string; locale: Locale }) {
  const t = TRANSLATIONS[locale];
  return <details data-message-id={id} className="harness-checkpoint">
    <summary><Scissors size={14} aria-hidden="true" />{t.workspaceCompacted}</summary>
    <div><MessageMarkdown text={text || t.workspaceCompactedHint} /></div>
  </details>;
}
