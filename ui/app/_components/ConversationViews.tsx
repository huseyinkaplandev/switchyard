'use client';
import Link from 'next/link';
import { TRANSLATIONS, type Locale } from '../_lib/translations';
export default function ConversationViews({ locale, archive }: { locale: Locale; archive: boolean }) {
  const t = TRANSLATIONS[locale];
  return <nav aria-label={t.workspaceChatViews} className="conversation-views">
    <Link href="/?tab=codex" aria-current={!archive ? 'page' : undefined}>{t.workspaceLiveChats}</Link>
    <Link href="/?tab=sessions" aria-current={archive ? 'page' : undefined}>{t.workspaceAllArchives}</Link>
    <span>{archive ? t.workspaceArchiveHint : t.workspaceLiveHint}</span>
  </nav>;
}
