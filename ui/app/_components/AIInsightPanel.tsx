'use client';

import { useState, useCallback } from 'react';
import { Brain, AlertTriangle, Info, TrendingUp, Users, Clock, RefreshCw } from 'lucide-react';
import ActivityCharts from './assistant-ui/ActivityCharts';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface Insight {
  type: string;
  title: string;
  content: string;
  severity?: 'info' | 'warn' | 'alert';
  relatedTaskIds?: string[];
}

interface AIInsightPanelProps {
  locale: Locale;
}

const ICONS: Record<string, React.ReactNode> = {
  stuck_tasks: <Clock size={14} />,
  top_agents: <Users size={14} />,
  velocity: <TrendingUp size={14} />,
  mention_hotspot: <AlertTriangle size={14} />,
  summary: <Info size={14} />,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-l-cyan-600 bg-cyan-950/20',
  warn: 'border-l-amber-600 bg-amber-950/20',
  alert: 'border-l-red-600 bg-red-950/20',
};

export default function AIInsightPanel({ locale }: AIInsightPanelProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [taskSummary, setTaskSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = TRANSLATIONS[locale];

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/insights');
      const data = await res.json();
      if (data.insights) {
        // Normalize: API might return single object or array
        const list = Array.isArray(data.insights) ? data.insights : [data.insights];
        setInsights(list);
      }
      if (data.taskSummary) setTaskSummary(data.taskSummary);
    } catch {
      setError(t.aiInsightsError);
    } finally {
      setLoading(false);
    }
  }, [t]);

  return (
    <div className="aui-report flex flex-col gap-4"><ActivityCharts locale={locale}/>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-cyan-400" />
          <span className="text-xs font-mono text-zinc-300 font-semibold">{t.aiInsights}</span>
        </div>
        <button
          onClick={fetchInsights}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {locale === 'tr' ? 'Analiz Et' : 'Analyze'}
        </button>
      </div>

      {taskSummary && (
        <div className="text-xs font-mono text-zinc-500 bg-zinc-950 border border-zinc-900 rounded-lg px-3 py-2">
          {taskSummary}
        </div>
      )}

      {error && (
        <div className="text-xs font-mono text-red-400 bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading && !insights.length && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-zinc-500 text-xs font-mono">
            <Brain size={14} className="animate-pulse text-cyan-400" />
            {locale === 'tr' ? 'AI analiz yapıyor...' : 'AI analyzing...'}
          </div>
        </div>
      )}

      {!loading && insights.length === 0 && !error && (
        <div className="text-xs text-zinc-600 italic py-12 text-center font-mono">
          {locale === 'tr'
            ? '"Analiz Et" butonuna tıklayarak AI içgörülerini görüntüleyin'
            : 'Click "Analyze" to view AI insights'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {insights.map((insight, i) => (
          <div
            key={i}
            className={`border-l-2 rounded-lg px-3 py-2.5 flex flex-col gap-1.5 ${SEVERITY_COLORS[insight.severity || 'info']} border border-zinc-900`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">{ICONS[insight.type] || <Info size={14} />}</span>
              <span className="text-xs font-semibold font-mono text-zinc-300 uppercase tracking-wider">
                {insight.title}
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-sans leading-relaxed">
              {insight.content}
            </p>
            {insight.relatedTaskIds && insight.relatedTaskIds.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                {insight.relatedTaskIds.map(id => (
                  <span key={id} className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
                    {id}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
