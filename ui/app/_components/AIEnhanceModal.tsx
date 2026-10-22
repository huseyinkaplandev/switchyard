'use client';

import { useRef, useEffect, useState } from 'react';
import { Sparkles, X, Check, ArrowRight, Loader2, DiffIcon, Pencil } from 'lucide-react';
import type { EnhanceTaskResult } from '../api/ai/enhance-task/route';

interface AIEnhanceModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  originalTitle: string;
  originalBody: string;
  enhancement: EnhanceTaskResult | null;
  locale: 'tr' | 'en';
  onApprove: (editedTitle: string) => void;
  onReject: () => void;
  onClose: () => void;
}

const t = {
  tr: {
    title: 'AI ile Görev İyileştirme',
    loading: 'AI görevinizi analiz ediyor ve iyileştiriyor...',
    original: 'Orijinal',
    enhanced: 'İyileştirilmiş',
    titleLabel: 'Görev Başlığı',
    changes: 'Yapılan Değişiklikler',
    approve: 'İyileştirilmişi Kullan',
    reject: 'Orijinali Kullan',
    error: 'AI iyileştirme başarısız oldu',
    fallback: 'Orijinal görev kaydedilecek',
  },
  en: {
    title: 'AI Task Enhancement',
    loading: 'AI is analyzing and enhancing your task...',
    original: 'Original',
    enhanced: 'Enhanced',
    titleLabel: 'Task Title',
    changes: 'Changes Made',
    approve: 'Use Enhanced',
    reject: 'Use Original',
    error: 'AI enhancement failed',
    fallback: 'Original task will be saved',
  },
};

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-5 h-5 rounded-full bg-amber-900/50 animate-pulse" />
        <div className="h-4 w-48 bg-zinc-800 rounded animate-pulse" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse" />
        <div className="h-9 bg-zinc-900 rounded-lg animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
          <div className="h-32 bg-zinc-900 rounded-lg animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-20 bg-zinc-800 rounded animate-pulse" />
          <div className="h-32 bg-zinc-900 rounded-lg animate-pulse relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-900/10 to-transparent animate-shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AIEnhanceModal({
  open,
  loading,
  error,
  originalTitle,
  originalBody,
  enhancement,
  locale,
  onApprove,
  onReject,
  onClose,
}: AIEnhanceModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const lang = t[locale];

  useEffect(() => {
    if (!ref.current) return;
    if (open && !ref.current.open) {
      ref.current.showModal();
      requestAnimationFrame(() => setVisible(true));
    } else if (!open && ref.current.open) {
      setVisible(false);
      setTimeout(() => ref.current?.close(), 200);
    }
  }, [open]);

  useEffect(() => {
    if (enhancement?.enhancedTitle) {
      setEditedTitle(enhancement.enhancedTitle);
    }
  }, [enhancement?.enhancedTitle]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (ref.current && e.target === ref.current) {
      if (!loading) onClose();
    }
  };

  return (
    <dialog
      ref={ref}
      onClick={handleBackdrop}
      className="fixed inset-0 m-auto h-fit bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl focus:outline-none backdrop:bg-black/50 backdrop:backdrop-blur-sm max-w-[90vw] w-[900px] transition-all duration-200"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
      }}
    >
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg ${loading ? 'bg-amber-900/40 animate-pulse' : 'bg-amber-900/30'}`}>
              {loading ? (
                <Loader2 size={16} className="text-amber-400 animate-spin" />
              ) : (
                <Sparkles size={16} className="text-amber-400" />
              )}
            </div>
            <h3 className="text-sm font-semibold text-zinc-200 font-sans">{lang.title}</h3>
          </div>
          <button
            onClick={() => !loading && onClose()}
            disabled={loading}
            className="p-1 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && <LoadingSkeleton />}

        {error && !loading && (
          <div className="p-6 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-900/20 border border-red-900/30 text-red-400 text-xs font-mono mb-4">
              <X size={14} />
              {error}
            </div>
            <p className="text-zinc-500 text-xs">{lang.fallback}</p>
            <button
              onClick={onReject}
              className="mt-4 px-5 py-2 rounded-lg text-xs font-bold font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
            >
              {locale === 'tr' ? 'Devam Et' : 'Continue'}
            </button>
          </div>
        )}

        {!loading && !error && enhancement && (
          <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(85vh - 140px)' }}>
            {/* Title section - editable */}
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-2">
                <Pencil size={12} className="text-zinc-500" />
                <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">{lang.titleLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  value={originalTitle}
                  disabled
                  className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500 font-mono focus:outline-none opacity-60"
                />
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="w-full bg-zinc-900 border border-amber-900/40 rounded-lg px-3 py-2 text-xs text-amber-200 font-mono focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600/30 transition-all placeholder-zinc-600"
                />
              </div>
            </div>

            {/* Side-by-side body comparison */}
            <div className="grid grid-cols-2 gap-4 px-6 pb-3">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">{lang.original}</span>
                </div>
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap max-h-[250px] overflow-y-auto custom-scrollbar">
                  {originalBody}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold text-amber-500 uppercase tracking-wider">{lang.enhanced}</span>
                </div>
                <div className="bg-amber-950/10 border border-amber-900/30 rounded-lg p-4 text-xs text-amber-200 font-mono leading-relaxed whitespace-pre-wrap max-h-[250px] overflow-y-auto custom-scrollbar shadow-lg shadow-amber-900/10">
                  {enhancement.enhancedBody}
                </div>
              </div>
            </div>

            {/* Changes */}
            {enhancement.changes.length > 0 && (
              <div className="px-6 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <DiffIcon size={12} className="text-zinc-500" />
                  <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">{lang.changes}</span>
                </div>
                <ul className="space-y-1">
                  {enhancement.changes.map((change, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[11px] text-zinc-400 font-mono"
                      style={{
                        animation: `slideIn 0.3s ease-out ${i * 0.1}s both`,
                      }}
                    >
                      <span className="text-amber-600 mt-0.5 shrink-0">▸</span>
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Summary */}
            {enhancement.summary && (
              <div className="px-6 pb-4">
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg px-4 py-2 text-[11px] text-zinc-500 font-mono italic">
                  {enhancement.summary}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {!loading && !error && enhancement && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 shrink-0">
            <button
              onClick={onReject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-mono font-semibold bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-all cursor-pointer active:scale-[0.97]"
            >
              <X size={13} />
              {lang.reject}
            </button>
            <button
              onClick={() => onApprove(editedTitle)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-[11px] font-mono font-bold bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white transition-all cursor-pointer active:scale-[0.97] shadow-lg shadow-amber-600/20"
            >
              <Check size={13} />
              {lang.approve}
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </dialog>
  );
}
