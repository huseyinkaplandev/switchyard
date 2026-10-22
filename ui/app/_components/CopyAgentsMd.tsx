'use client';

import { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface CopyAgentsMdProps {
  agentsMd: string;
  locale: Locale;
}

export default function CopyAgentsMd({ agentsMd, locale }: CopyAgentsMdProps) {
  const [copied, setCopied] = useState(false);
  const t = TRANSLATIONS[locale];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(agentsMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  return (
    <button
      id="copy-agents-btn"
      onClick={handleCopy}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all duration-200 ${
        copied
          ? 'bg-zinc-850 border-emerald-800 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
      }`}
    >
      {copied ? <><Check size={12} className="inline" /> {t.copiedSuccess}</> : <><ClipboardCopy size={12} className="inline mr-1" />{t.copyAgentsMd}</>}
    </button>
  );
}
