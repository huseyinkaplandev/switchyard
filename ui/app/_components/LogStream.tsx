'use client';

import { useEffect, useRef } from 'react';
import { LogEntry } from '../_lib/parseLog';
import { AGENTS } from '../_lib/agents';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface LogStreamProps {
  entries: LogEntry[];
  locale: Locale;
}

export default function LogStream({ entries, locale }: LogStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = TRANSLATIONS[locale];

  // Take only the last 50 entries
  const last50Entries = entries.slice(-50);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check if scrolled near the bottom (threshold of 50px)
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 50;

    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-zinc-500 font-mono px-1">
        <span className="font-semibold uppercase tracking-wider text-xs">
          {locale === 'tr' ? 'Canlı Log Akışı (son 50)' : 'Live Log (last 50)'}
        </span>
        <span className="text-xs">
          {last50Entries.length} {locale === 'tr' ? 'log' : 'entries'}
        </span>
      </div>
      <div
        ref={containerRef}
        className="bg-zinc-950 border border-zinc-900 rounded-lg p-4 font-mono text-xs h-[320px] max-h-[60vh] overflow-y-auto custom-scrollbar flex flex-col gap-2 shadow-inner"
      >
        {last50Entries.length === 0 ? (
          <div className="text-zinc-650 italic py-12 text-center font-mono">
            {locale === 'tr'
              ? 'Log bulunmuyor. Log akışı başlatmak için agent\'ları çalıştırın.'
              : 'No live log entries found. Start running agents to stream logs.'}
          </div>
        ) : (
          <div className="log-stream">
            <style>{`
              .log-stream a {
                color: #22d3ee;
                text-decoration: underline;
                text-underline-offset: 2px;
                text-decoration-color: #22d3ee/40;
              }
              .log-stream a:hover {
                color: #67e8f9;
                text-decoration-color: #67e8f9;
              }
            `}</style>
            {last50Entries.map((entry, idx) => {
              // Find agent meta
              const agent = AGENTS.find((a) => a.id === entry.agentId);
              const agentColor = agent?.color || '#71717a';

              // Format date to show standard HH:MM format
              const formatTime = (d: Date) => {
                const date = new Date(d);
                if (isNaN(date.getTime())) return '--:--';
                const hh = String(date.getHours()).padStart(2, '0');
                const mm = String(date.getMinutes()).padStart(2, '0');
                return `${hh}:${mm}`;
              };

              return (
                <div key={idx} className="flex items-start gap-1 leading-relaxed break-all select-text font-mono">
                  <span className="text-zinc-550 shrink-0">[{formatTime(entry.ts)}]</span>
                  <span className="text-zinc-400 shrink-0">{entry.role}/</span>
                  <span
                    style={{ color: agentColor }}
                    className="shrink-0 font-semibold"
                  >
                    {entry.agentId}
                  </span>
                  <span className="text-zinc-500 shrink-0">:</span>
                  <span className="text-zinc-200 ml-1" dangerouslySetInnerHTML={{ __html: entry.message }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
