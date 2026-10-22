'use client';

import { useState, useCallback } from 'react';
import { FileText, RefreshCw, Copy, Check } from 'lucide-react';
import MessageMarkdown from './MessageMarkdown';
import ActivityCharts from './assistant-ui/ActivityCharts';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface DailyReportProps {
  locale: Locale;
}

export default function DailyReport({ locale }: DailyReportProps) {
  const [report, setReport] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const t = TRANSLATIONS[locale];

  const generateReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/daily-report');
      const data = await res.json();
      if (data.report) setReport(data.report);
      if (data.date) setDate(data.date);
      if (!data.report) setError(locale === 'tr' ? 'Rapor oluşturulamadı' : 'Report generation failed');
    } catch {
      setError(t.dailyReportLoading);
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="aui-report flex flex-col gap-4"><ActivityCharts locale={locale}/>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-cyan-400" />
          <span className="text-xs font-mono text-zinc-300 font-semibold">{t.dailyReport}</span>
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-all cursor-pointer"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              {copied ? t.copiedSuccess : (locale === 'tr' ? 'Kopyala' : 'Copy')}
            </button>
          )}
          <button
            onClick={generateReport}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-900/50 text-cyan-400 hover:bg-cyan-900/40 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? t.dailyReportLoading : t.dailyReportGenerate}
          </button>
        </div>
      </div>

      {date && (
        <div className="text-xs font-mono text-zinc-600">
          {t.dailyReportDate}: {date}
        </div>
      )}

      {error && (
        <div className="text-xs font-mono text-red-400 bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-zinc-500 text-xs font-mono">
            <RefreshCw size={14} className="animate-spin text-cyan-400" />
            {t.dailyReportLoading}
          </div>
        </div>
      )}

      {!loading && !report && !error && (
        <div className="text-xs text-zinc-600 italic py-12 text-center font-mono">
          {locale === 'tr'
            ? '"Rapor Oluştur" butonuna tıklayarak günlük rapor oluşturun'
            : 'Click "Generate Report" to create a daily report'}
        </div>
      )}

      {report && (
        <div className="bg-zinc-950 border border-zinc-900 rounded-xl p-4 font-sans text-xs text-zinc-300 leading-relaxed">
          <div className="prose prose-invert prose-xs max-w-none">
            <MessageMarkdown text={report}/>
          </div>
        </div>
      )}
    </div>
  );
}
