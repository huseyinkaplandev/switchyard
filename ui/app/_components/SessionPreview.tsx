'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getCodexThreadMessages } from '../_actions';
import type { AgentArchiveMessage } from '../_lib/agentArchiveDb';

/** Short delay so passing the mouse over rows does not fire a request per row. */
const HOVER_DELAY_MS = 260;
/** The preview is a few lines; the full chat is one click away. */
const PREVIEW_MESSAGES = 4;

const cache = new Map<string, AgentArchiveMessage[]>();

/**
 * Shows the start of the chat when hovering a row.
 *
 * The list shows only title and counts; you had to open a chat to tell
 * which one it was. The preview does the job of the browser's own `title`
 * tooltip, but readably: formatted, in conversation order and positioned
 * next to the row.
 */
export default function SessionPreview({
  sessionId,
  anchor,
  locale,
  onClose,
}: {
  sessionId: string;
  anchor: DOMRect;
  locale: 'tr' | 'en';
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<AgentArchiveMessage[] | null>(cache.get(sessionId) ?? null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (messages) return;
    let active = true;
    timer.current = window.setTimeout(async () => {
      try {
        const all = await getCodexThreadMessages(sessionId);
        const conversation = all.filter((message) => (message.kind ?? 'text') === 'text').slice(0, PREVIEW_MESSAGES);
        cache.set(sessionId, conversation);
        if (active) setMessages(conversation);
      } catch {
        if (active) setMessages([]);
      }
    }, HOVER_DELAY_MS);
    return () => {
      active = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [sessionId, messages]);

  /* The anchor is measured on mouseenter; if the list scrolls, the row moves
     but the panel stays. Closing beats tracking the position: a scrolling
     user is already looking at another row. */
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [onClose]);

  /* Keep the panel on screen: position it by the anchor, then clamp. */
  const top = Math.min(Math.max(12, anchor.top), Math.max(12, window.innerHeight - 340));
  const left = Math.min(anchor.right + 12, window.innerWidth - 440);

  return (
    <div
      role="tooltip"
      style={{ top, left }}
      className="pointer-events-none fixed z-[75] w-[420px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/98 shadow-2xl shadow-black/60 backdrop-blur"
    >
      <div className="max-h-[320px] overflow-hidden px-4 py-3">
        {!messages && (
          <p className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <LoaderCircle size={12} className="animate-spin" /> {locale === 'tr' ? 'önizleme hazırlanıyor…' : 'loading preview…'}
          </p>
        )}
        {messages?.length === 0 && (
          <p className="font-mono text-[11px] text-zinc-600">{locale === 'tr' ? 'Önizlenecek içerik yok.' : 'Nothing to preview.'}</p>
        )}
        {messages?.map((message) => (
          <div key={message.id} className="mb-3 last:mb-0">
            <p className={`font-mono text-[9px] font-bold uppercase tracking-wider ${message.role === 'user' ? 'text-cyan-400' : 'text-amber-400/80'}`}>
              {message.role === 'user' ? (locale === 'tr' ? 'sen' : 'you') : (locale === 'tr' ? 'ajan' : 'agent')}
            </p>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 text-zinc-300">{message.text.trim()}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        {locale === 'tr' ? 'tıkla: aç · çift tıkla: handoff' : 'click: open · double-click: handoff'}
      </div>
    </div>
  );
}
