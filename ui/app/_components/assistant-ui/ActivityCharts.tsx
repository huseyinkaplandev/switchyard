'use client';
import { useEffect, useState } from 'react';
import { Chart } from './elements/chart';
import type { Locale } from '../../_lib/translations';
import { TRANSLATIONS } from '../../_lib/translations';
export default function ActivityCharts({ locale }: { locale: Locale }) {
  const [points, setPoints] = useState<number[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; fetch('/api/handoff/catalog', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
    const counts = Array(7).fill(0) as number[];
    // Catalog reports each conversation's latest real activity, not every message.
    for (const row of data.candidates || []) { const at = Date.parse(row.activityAt); const day = Math.floor((at - start.getTime()) / 86_400_000); if (day >= 0 && day < 7) counts[day]++; }
    if (active) setPoints(counts);
  }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (failed) return <p role="status" className="aui-muted">{TRANSLATIONS[locale].auiChartFailed}</p>;
  if (!points) return <div className="aui-skeleton" aria-busy="true" />;
  const total = points.reduce((a, b) => a + b, 0);
  return <section className="aui-chart-section"><Chart label={TRANSLATIONS[locale].auiActivityChart} value={String(total)} points={points} visibleCount={7} variant="bars" /><p className="aui-muted">{TRANSLATIONS[locale].auiChartHint}{total === 0 && ` · ${TRANSLATIONS[locale].auiEmptyChart}`}</p></section>;
}
