'use client';

import { useRef, useEffect, useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { Mention } from '../_lib/parseMentions';
import { Agent } from '../_lib/agents';
import { markHandled } from '../_actions';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface MentionPanelProps {
  agent: Agent;
  pendingMentions: Mention[];
  last10LogLines: string;
  agentsMd: string;
  onClose: () => void;
  locale: Locale;
}

export default function MentionPanel({
  agent,
  pendingMentions,
  last10LogLines,
  agentsMd,
  onClose,
  locale,
}: MentionPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const t = TRANSLATIONS[locale];

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleClose = () => {
    dialogRef.current?.close();
    onClose();
  };

  const handleMarkHandled = (id: string) => {
    startTransition(async () => {
      try {
        await markHandled([id]);
      } catch (err) {
        console.error('Failed to mark mention handled:', err);
      }
    });
  };

  const handleMarkAllHandled = () => {
    const ids = pendingMentions.map((m) => m.id);
    startTransition(async () => {
      try {
        await markHandled(ids);
        handleClose();
      } catch (err) {
        console.error('Failed to mark all mentions handled:', err);
      }
    });
  };

  const handleCopyPrompt = async (mention: Mention) => {
    const date = new Date(mention.ts);
    const dStr = date.toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const roleName = mention.rawTarget.replace('@', '');

    const prompt = `# AGENTS.md
${agentsMd}

---

# Active Role: ${roleName}
You are currently assigned the ${roleName} role (${agent.name} agent).

# Pending Request
From: ${mention.fromRole}/${mention.fromAgent} at ${dStr}

${mention.message}

# Context (last 10 LIVE_LOG lines for situational awareness)
${last10LogLines}

---

${
  locale === 'tr'
    ? `İlk adım: LIVE_LOG.md'nin son 30 satırını oku.\nBittiğinde: log-agent ${agent.id} ${roleName} "mention handled: <kısa özet>"`
    : `First step: Read the last 30 lines of LIVE_LOG.md.\nWhen done: log-agent ${agent.id} ${roleName} "mention handled: <short summary>"`
}`;

    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(mention.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy prompt:', err);
    }
  };

  return (
      <dialog
        ref={dialogRef}
        onCancel={handleClose}
        onClick={(e) => {
          if (dialogRef.current && e.target === dialogRef.current) handleClose();
        }}
        className="fixed inset-0 m-auto h-fit bg-zinc-950 border border-zinc-900 rounded-xl p-6 text-zinc-100 max-w-xl w-full shadow-2xl focus:outline-none backdrop:bg-black/30 backdrop:backdrop-blur-sm"
      >
        {/* Header */}
        <div className="pb-4 border-b border-zinc-900 mb-4 select-none">
          <h3 className="font-semibold text-sm font-sans text-zinc-200">
            {t.mentionsFor(agent.name, agent.id)}
          </h3>
        </div>

      {/* Listing pending items */}
      <div className="flex flex-col gap-4 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
        {pendingMentions.length === 0 ? (
          <div className="text-[10px] text-zinc-650 italic py-12 text-center font-mono select-none">
            {t.noPendingMentions}
          </div>
        ) : (
          pendingMentions.map((mention) => {
            const dStr = new Date(mention.ts).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={mention.id}
                className="bg-zinc-950 border border-zinc-900 rounded-lg p-3.5 flex flex-col gap-3 hover:border-zinc-800 transition-colors"
              >
                {/* Meta details */}
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 select-none">
                  <span>
                    [{dStr}] <span className="text-zinc-400 font-semibold">{mention.fromRole}/{mention.fromAgent}</span>
                  </span>
                  <span className="bg-amber-400/10 text-amber-300 border border-amber-400/20 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">
                    {mention.rawTarget}
                  </span>
                </div>

                {/* Message Body */}
                <p className="text-xs text-zinc-200 leading-relaxed select-text font-mono break-words bg-zinc-950/50 p-2 rounded border border-zinc-900/50">
                  {mention.message}
                </p>

                {/* Actions row */}
                <div className="flex items-center justify-end gap-2.5 mt-1 select-none">
                  <button
                    onClick={() => handleCopyPrompt(mention)}
                    className={`text-[9px] font-semibold py-1 px-2 rounded border transition-all cursor-pointer font-mono ${
                      copiedId === mention.id
                        ? 'bg-zinc-900 border-emerald-850 text-emerald-400 font-bold'
                        : 'bg-zinc-900 border-zinc-850 text-zinc-300 hover:border-zinc-800'
                    }`}
                  >
                    {copiedId === mention.id ? <><Check size={11} className="inline" /> {t.copiedPromptFeedback}</> : t.copyAsPrompt}
                  </button>
                  
                  <button
                    onClick={() => handleMarkHandled(mention.id)}
                    disabled={isPending}
                    className="text-[9px] font-semibold py-1 px-2 rounded bg-zinc-900 border border-zinc-850 text-zinc-300 hover:border-zinc-800 transition-all cursor-pointer font-mono disabled:opacity-50"
                  >
                    {t.markHandled}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-900 select-none font-mono text-xs">
        {pendingMentions.length > 0 ? (
          <button
            onClick={handleMarkAllHandled}
            disabled={isPending}
            className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-850 hover:border-zinc-800 text-zinc-300 hover:text-zinc-150 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {t.markAllHandled}
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={handleClose}
          className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold transition-colors cursor-pointer"
        >
          {t.close}
        </button>
      </div>
    </dialog>
  );
}
