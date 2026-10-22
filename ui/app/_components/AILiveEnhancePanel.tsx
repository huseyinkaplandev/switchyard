'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Check, X, DiffIcon, ArrowRight } from 'lucide-react';
import type { EnhanceTaskResult } from '../api/ai/enhance-task/route';

interface AILiveEnhancePanelProps {
  loading: boolean;
  suggestion: EnhanceTaskResult | null;
  hasContent: boolean;
  locale: 'tr' | 'en';
  onApply: (title: string, body: string) => void;
  onDismiss: () => void;
}

const t = {
  tr: {
    title: 'AI Öneri',
    idle: 'Yazmaya başlayın, AI önerileri burada görünecek',
    analyzing: 'AI görevinizi analiz ediyor...',
    ready: 'AI iyileştirme önerisi hazır',
    changes: 'Değişiklikler',
    apply: 'Uygula',
    dismiss: 'Reddet',
    editHint: 'Başlık düzenlenebilir',
  },
  en: {
    title: 'AI Suggestion',
    idle: 'Start typing, AI suggestions will appear here',
    analyzing: 'AI is analyzing your task...',
    ready: 'AI enhancement suggestion ready',
    changes: 'Changes',
    apply: 'Apply',
    dismiss: 'Dismiss',
    editHint: 'Title is editable',
  },
};

function useProgress(active: boolean) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!active) { setProgress(0); return; }
    setProgress(5);
    const t1 = setTimeout(() => setProgress(25), 400);
    const t2 = setTimeout(() => setProgress(50), 1200);
    const t3 = setTimeout(() => setProgress(70), 2500);
    const t4 = setTimeout(() => setProgress(85), 4000);
    const t5 = setTimeout(() => setProgress(93), 6000);
    const t6 = setInterval(() => {
      setProgress(p => Math.min(p + 0.5, 98));
    }, 300);
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      clearTimeout(t4); clearTimeout(t5); clearInterval(t6);
      setProgress(0);
    };
  }, [active]);
  return progress;
}

function LoadingSkeleton({ progress }: { progress: number }) {
  return (
    <div className="p-4 space-y-4">
      {/* Progress bar */}
      <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-700 via-amber-500 to-amber-400 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-zinc-600">
          AI working...
        </span>
        <span className="text-[10px] font-mono text-amber-600/80 tabular-nums">{Math.round(progress)}%</span>
      </div>

      {/* Title skeleton */}
      <div>
        <div className="h-2.5 w-24 bg-zinc-800 rounded animate-pulse mb-2" />
        <div className="h-8 bg-zinc-900 rounded-lg animate-pulse" />
      </div>

      {/* Body skeleton */}
      <div>
        <div className="h-2.5 w-16 bg-zinc-800 rounded animate-pulse mb-2" />
        <div className="space-y-2 bg-zinc-900 rounded-lg p-3">
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-full" />
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-11/12" />
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-4/5" />
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-zinc-800 rounded animate-pulse w-2/3" />
        </div>
      </div>

      {/* Changes skeleton */}
      <div>
        <div className="h-2.5 w-20 bg-zinc-800 rounded animate-pulse mb-2" />
        <div className="space-y-1.5">
          {[1,2,3].map(i => (
            <div key={i} className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: `${70 - i * 10}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AILiveEnhancePanel({
  loading,
  suggestion,
  hasContent,
  locale,
  onApply,
  onDismiss,
}: AILiveEnhancePanelProps) {
  const lang = t[locale];
  const progress = useProgress(loading);

  const statusIcon = () => {
    if (!hasContent) return <div className="w-2 h-2 rounded-full bg-zinc-700" />;
    if (loading) return <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />;
    if (suggestion) return <div className="w-2 h-2 rounded-full bg-emerald-500" />;
    return <div className="w-2 h-2 rounded-full bg-zinc-700" />;
  };

  const statusText = () => {
    if (!hasContent) return lang.idle;
    if (loading) return lang.analyzing;
    if (suggestion) return lang.ready;
    return lang.idle;
  };

  return (
    <div className="w-[380px] shrink-0 border-l border-zinc-800/60 bg-zinc-950/30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded-md ${loading ? 'bg-amber-900/30' : suggestion ? 'bg-emerald-900/30' : 'bg-zinc-900'}`}>
            <Sparkles size={13} className={loading ? 'text-amber-400' : suggestion ? 'text-emerald-400' : 'text-zinc-500'} />
          </div>
          <span className="text-xs font-semibold text-zinc-300 font-sans">{lang.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {statusIcon()}
          <span className={`text-[9px] font-mono ${loading ? 'text-amber-600' : suggestion ? 'text-emerald-700' : 'text-zinc-700'}`}>
            {loading ? (locale === 'tr' ? 'analiz' : 'analyzing') : suggestion ? (locale === 'tr' ? 'hazır' : 'ready') : (locale === 'tr' ? 'bekliyor' : 'idle')}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!hasContent && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <Sparkles size={24} className="text-zinc-800 mb-3" />
            <p className="text-[11px] text-zinc-600 font-mono leading-relaxed">{lang.idle}</p>
          </div>
        )}

        {hasContent && loading && !suggestion && (
          <LoadingSkeleton progress={progress} />
        )}

        {hasContent && !loading && suggestion && (
          <div className="p-4 space-y-3">
            {/* Editable title */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[9px] font-mono font-bold text-zinc-600 uppercase tracking-wider">
                  {locale === 'tr' ? 'Başlık Önerisi' : 'Suggested Title'}
                </span>
                <span className="text-[8px] text-zinc-700 font-mono">({lang.editHint})</span>
              </div>
              <div className="bg-zinc-900/80 border border-amber-900/20 rounded-lg p-2.5 text-xs text-amber-200 font-mono leading-relaxed">
                {suggestion.enhancedTitle}
              </div>
            </div>

            {/* Enhanced body preview */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <DiffIcon size={10} className="text-zinc-600" />
                <span className="text-[9px] font-mono font-bold text-zinc-600 uppercase tracking-wider">{lang.changes}</span>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-3 text-[11px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap max-h-[250px] overflow-y-auto custom-scrollbar">
                {suggestion.enhancedBody}
              </div>
            </div>

            {/* Changes list */}
            {suggestion.changes.length > 0 && (
              <div>
                {suggestion.changes.map((change, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-500 font-mono py-0.5">
                    <span className="text-amber-600 mt-0.5 shrink-0">▸</span>
                    {change}
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            {suggestion.summary && (
              <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-lg px-3 py-2 text-[10px] text-zinc-600 font-mono italic">
                {suggestion.summary}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {suggestion && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800/60 shrink-0">
          <button
            onClick={onDismiss}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-mono font-semibold bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer active:scale-[0.97]"
          >
            <X size={11} />
            {lang.dismiss}
          </button>
          <button
            onClick={() => onApply(suggestion.enhancedTitle, suggestion.enhancedBody)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white transition-all cursor-pointer active:scale-[0.97] shadow-lg shadow-amber-600/15"
          >
            <Check size={11} />
            {lang.apply}
            <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
