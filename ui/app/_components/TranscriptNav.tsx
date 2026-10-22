'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, List, X } from 'lucide-react';
import type { AgentArchiveMessage } from '../_lib/agentArchiveDb';

type Props = {
  messages: AgentArchiveMessage[];
  locale: 'tr' | 'en';
  /** Grows the window if the target is not rendered yet; returns true if it is. */
  onEnsureRendered?: (id: string) => boolean;
  scrollContainer?: RefObject<HTMLDivElement | null>;
};

/** Visible label for an outline entry. */
function outlineLabel(message: AgentArchiveMessage) {
  const firstLine = message.text
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/[*`_>]/g, '').trim())
    .find((line) => line.length > 0);
  return (firstLine || '…').slice(0, 80);
}

/**
 * Navigation for long transcripts.
 *
 * In a 145-card session the only way around was scrolling: finding a turn
 * or returning to the end took minutes. The three tools here -- prompt-to-
 * prompt jumps, the outline list and go to top/bottom -- work without
 * touching the page's own scrolling, so unlike a virtual list they bring
 * no visual change.
 */
export default function TranscriptNav({ messages, locale, onEnsureRendered, scrollContainer }: Props) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  const prompts = messages.filter((message) => message.role === 'user' && (message.kind ?? 'text') === 'text');

  useEffect(() => {
    const onScroll = () => {
      const container = scrollContainer?.current;
      const scrolled = container ? container.scrollTop : window.scrollY;
      const max = container ? container.scrollHeight - container.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      setAtTop(scrolled < 200);
      setAtBottom(max - scrolled < 200);
    };
    onScroll();
    const target = scrollContainer?.current || window;
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [scrollContainer, messages.length]);

  const edge = (bottom: boolean) => {
    const container = scrollContainer?.current;
    if (container) container.scrollTo({ top: bottom ? container.scrollHeight : 0, behavior: 'smooth' });
    else window.scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0, behavior: 'smooth' });
  };

  const goTo = (id: string, attempt = 0) => {
    const node = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!node) {
      /* Block not in the window yet: grow the window and retry after render.
         Two rounds are enough; more could turn into an endless loop. */
      if (attempt < 6 && onEnsureRendered && !onEnsureRendered(id)) {
        window.setTimeout(() => goTo(id, attempt + 1), 120);
      }
      return;
    }
    const container = scrollContainer?.current;
    if (container) container.scrollTo({ top: node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16, behavior: 'smooth' });
    else window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
    setOutlineOpen(false);
  };

  /** Index of the prompt nearest the top of the screen; adjacent jumps use it. */
  const currentPromptIndex = () => {
    let index = -1;
    prompts.forEach((prompt, position) => {
      const node = document.querySelector(`[data-message-id="${CSS.escape(prompt.id)}"]`);
      if (node && node.getBoundingClientRect().top <= (scrollContainer?.current?.getBoundingClientRect().top || 0) + 120) index = position;
    });
    return index;
  };

  const step = (direction: -1 | 1) => {
    if (!prompts.length) return;
    const current = currentPromptIndex();
    const next = Math.min(prompts.length - 1, Math.max(0, current + direction));
    goTo(prompts[next].id);
  };

  /* Keyboard: j/k adjacent prompt, g/G top and bottom. Disabled inside inputs. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'j') step(1);
      else if (event.key === 'k') step(-1);
      else if (event.key === 'g') edge(false);
      else if (event.key === 'G') edge(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!prompts.length) return null;

  return (
    <>
      {outlineOpen && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setOutlineOpen(false); }}>
          <aside className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
            <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <p className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-cyan-400">
                <List size={13} /> {locale === 'tr' ? `${prompts.length} prompt` : `${prompts.length} prompts`}
              </p>
              <button type="button" onClick={() => setOutlineOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label={locale === 'tr' ? 'Kapat' : 'Close'}>
                <X size={15} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {prompts.map((prompt, index) => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => goTo(prompt.id)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="mt-0.5 shrink-0 rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] leading-5 text-zinc-400">{outlineLabel(prompt)}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <details className="transcript-navigation">
        <summary aria-label={locale === 'tr' ? 'Mesajlarda gezin' : 'Navigate messages'} title={locale === 'tr' ? 'Mesajlarda gezin' : 'Navigate messages'}><List size={16}/></summary>
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-xl shadow-black/40 backdrop-blur">
          <button type="button" onClick={() => setOutlineOpen(true)} title={locale === 'tr' ? 'Prompt listesi' : 'Prompt list'} className="border-b border-zinc-800 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300">
            <List size={15} />
          </button>
          <button type="button" onClick={() => step(-1)} title={locale === 'tr' ? 'Önceki prompt (k)' : 'Previous prompt (k)'} className="border-b border-zinc-800 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
            <ChevronUp size={15} />
          </button>
          <button type="button" onClick={() => step(1)} title={locale === 'tr' ? 'Sonraki prompt (j)' : 'Next prompt (j)'} className="border-b border-zinc-800 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
            <ChevronDown size={15} />
          </button>
          <button type="button" disabled={atTop} onClick={() => edge(false)} title={locale === 'tr' ? 'Başa git (g)' : 'To top (g)'} className="border-b border-zinc-800 p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-25">
            <ArrowUp size={15} />
          </button>
          <button type="button" disabled={atBottom} onClick={() => edge(true)} title={locale === 'tr' ? 'Sona git (G)' : 'To bottom (G)'} className="p-2.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-25">
            <ArrowDown size={15} />
          </button>
        </div>
      </details>
    </>
  );
}
