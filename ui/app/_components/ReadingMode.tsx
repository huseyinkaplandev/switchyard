'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Download, Scissors, Type, Wrench, X } from 'lucide-react';
import ArchiveRuntime from './assistant-ui/ArchiveRuntime';
import AssistantMessage from './assistant-ui/AssistantMessage';
import HarnessCheckpoint from './HarnessCheckpoint';
import ToolTrace from './ToolTrace';
import TranscriptImage from './TranscriptImage';
import type { AgentArchiveMessage, AgentArchiveThread } from '../_lib/agentArchiveDb';

type Props = {
  thread: AgentArchiveThread;
  messages: AgentArchiveMessage[];
  locale: 'tr' | 'en';
  providerLabel: string;
  onClose: () => void;
};

/** Reading width, measured in characters, not pixels. */
const WIDTHS = { dar: 'max-w-[62ch]', orta: 'max-w-[78ch]', genis: 'max-w-[104ch]' } as const;
type WidthKey = keyof typeof WIDTHS;

const SIZES = { küçük: 'text-[13px]', orta: 'text-[14px]', büyük: 'text-[17px]' } as const;
type SizeKey = keyof typeof SIZES;

function plainText(messages: AgentArchiveMessage[], providerLabel: string) {
  return messages
    .map((message) => {
      const who = message.role === 'user' ? 'PROMPT' : providerLabel.toUpperCase();
      return `## ${who}\n\n${message.text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Full-screen reading view.
 *
 * The transcript view is built for auditing work: tool traces, badges,
 * lists. For READING a long conversation all of that is noise. Here there
 * is only the conversation, in a single measured column; tool records are
 * optional and off by default.
 */
export default function ReadingMode({ thread, messages, locale, providerLabel, onClose }: Props) {
  const [width, setWidth] = useState<WidthKey>('orta');
  const [size, setSize] = useState<SizeKey>('orta');
  const [showWork, setShowWork] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () =>
      messages.filter((message) => {
        const kind = message.kind ?? 'text';
        if (kind === 'text' || kind === 'compaction' || kind === 'attachment') return true;
        return showWork;
      }),
    [messages, showWork],
  );

  const conversation = useMemo(() => messages.filter((message) => (message.kind ?? 'text') === 'text'), [messages]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const download = () => {
    const body = `# ${thread.title}\n\n${plainText(conversation, providerLabel)}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${thread.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'transcript'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    /* Keep the page behind from scrolling: reading mode uses its own scroll. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const scrollTo = (position: 'top' | 'bottom') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: position === 'top' ? 0 : node.scrollHeight, behavior: 'smooth' });
  };


  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-zinc-950">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-cyan-400">
            {locale === 'tr' ? 'okuma modu' : 'reading mode'}
          </p>
          <h2 className="mt-1 truncate text-sm font-semibold text-zinc-100 md:text-base">{thread.title}</h2>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {(Object.keys(WIDTHS) as WidthKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={width === key}
              onClick={() => setWidth(key)}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors ${width === key ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              {locale === 'tr' ? key : { dar: 'narrow', orta: 'medium', genis: 'wide' }[key]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          <Type size={12} className="ml-1 text-zinc-600" />
          {(Object.keys(SIZES) as SizeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={size === key}
              onClick={() => setSize(key)}
              className={`rounded px-2 py-1 text-xs font-mono transition-colors ${size === key ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              {locale === 'tr' ? key : { küçük: 'small', orta: 'medium', büyük: 'large' }[key]}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={showWork}
          onClick={() => setShowWork((value) => !value)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-mono transition-colors ${showWork ? 'border-violet-800/70 bg-violet-500/10 text-violet-300' : 'border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300'}`}
        >
          <Wrench size={12} /> {locale === 'tr' ? 'çalışma' : 'work'}
        </button>

        <button
          type="button"
          onClick={() => copy('all', plainText(conversation, providerLabel))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-900/60 bg-cyan-950/30 px-2.5 py-2 text-xs font-mono font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/40"
        >
          {copied === 'all' ? <Check size={12} /> : <Copy size={12} />}
          {copied === 'all' ? (locale === 'tr' ? 'kopyalandı' : 'copied') : (locale === 'tr' ? 'tümünü kopyala' : 'copy all')}
        </button>

        <button
          type="button"
          onClick={download}
          title={locale === 'tr' ? 'Markdown olarak indir' : 'Download as Markdown'}
          className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <Download size={14} />
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label={locale === 'tr' ? 'Okuma modunu kapat' : 'Close reading mode'}
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={17} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-8">
        <div className={`mx-auto ${WIDTHS[width]} ${SIZES[size]}`} style={{ '--message-font-size': size === 'küçük' ? '13px' : size === 'büyük' ? '17px' : '14px' } as import('react').CSSProperties}>
          <ArchiveRuntime messages={visible}>{visible.map((message) => {
            const kind = message.kind ?? 'text';

            if (kind === 'compaction') return <HarnessCheckpoint key={message.id} text={message.text} locale={locale} />;

            if (kind === 'attachment') {
              return (
                <div key={message.id} className="my-6">
                  <TranscriptImage sessionId={thread.id} assetIndex={message.assetIndex} locale={locale} />
                </div>
              );
            }

            if (kind !== 'text') return <ToolTrace key={message.id} items={[message]} locale={locale} />;

            const isPrompt = message.role === 'user';

            return <AssistantMessage key={message.id} id={message.id} role={isPrompt ? 'user' : 'assistant'} text={message.text} label={isPrompt ? undefined : providerLabel} timestamp={message.timestamp} locale={locale} queued={message.queuedMidTurn} />;

          })}</ArchiveRuntime>
          <div className="h-24" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-5 right-5 flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-xl">
        <button type="button" onClick={() => scrollTo('top')} className="pointer-events-auto border-b border-zinc-800 p-2.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          <ArrowUp size={15} />
        </button>
        <button type="button" onClick={() => scrollTo('bottom')} className="pointer-events-auto p-2.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          <ArrowDown size={15} />
        </button>
      </div>
    </div>
  );
}
