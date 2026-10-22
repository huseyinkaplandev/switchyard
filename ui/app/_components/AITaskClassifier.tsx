'use client';

import { useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface AITaskClassifierProps {
  locale: Locale;
  title: string;
  body: string;
  taskId?: string;
  onClassify: (result: {
    priority: 'low' | 'normal' | 'high';
    suggestedAssignee: string | null;
    suggestedRole: string | null;
    reason: string;
  }) => void;
}

export default function AITaskClassifier({ locale, title, body, taskId, onClassify }: AITaskClassifierProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const t = TRANSLATIONS[locale];

  const handleClassify = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/ai/classify-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, taskId }),
      });
      const data = await res.json();

      if (data.classification) {
        onClassify(data.classification);
        setResult(data.classification.reason);
      }
    } catch {
      setResult(locale === 'tr' ? 'AI bağlantı hatası' : 'AI connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClassify}
        disabled={loading || !title.trim()}
        className="flex items-center gap-1.5 text-[9px] font-mono px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-50 self-start"
      >
        {loading ? (
          <Sparkles size={10} className="animate-pulse text-cyan-400" />
        ) : (
          <Sparkles size={10} />
        )}
        {loading ? t.aiClassifying : t.aiClassify}
      </button>

      {result && (
        <div className="flex items-start gap-1.5">
          <Check size={10} className="text-cyan-400 mt-0.5 shrink-0" />
          <span className="text-[9px] font-mono text-zinc-500 leading-relaxed">{result}</span>
        </div>
      )}
    </div>
  );
}
