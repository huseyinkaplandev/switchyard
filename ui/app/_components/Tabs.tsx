'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MessageSquareText, CalendarClock, ListTodo, Activity, FileText, ChartNoAxesCombined, BookOpen } from 'lucide-react';
import { Locale, TRANSLATIONS } from '../_lib/translations';

export default function Tabs({ locale }: { locale: Locale }) {
  const tab = useSearchParams().get('tab') || 'codex';
  const t = TRANSLATIONS[locale];
  const [host, setHost] = useState('127.0.0.1:3010');
  useEffect(() => { setHost(window.location.host); }, []);
  const primary = [
    { id: 'codex', label: t.workspaceChats, icon: MessageSquareText, active: ['codex', 'sessions'].includes(tab) },
    { id: 'schedules', label: t.workspaceSchedules, icon: CalendarClock, active: tab === 'schedules' },
    { id: 'tasks', label: t.workspaceTasks, icon: ListTodo, active: tab === 'tasks' },
    { id: 'live', label: t.workspaceActivity, icon: Activity, active: tab === 'live' },
    { id: 'prompts', label: t.promptChat, icon: FileText, active: tab === 'prompts' },
  ];
  const secondary = [
    { id: 'insights', label: t.aiInsights, icon: ChartNoAxesCombined, active: tab === 'insights' },
    { id: 'report', label: t.dailyReport, icon: BookOpen, active: tab === 'report' },
  ];
  return <aside className="workspace-sidebar">
    <Link href="/?tab=codex" className="workspace-brand">Switchyard<span>{t.workspaceLocal}</span></Link>
    <nav aria-label={t.workspaceNavigation} className="workspace-navigation">
      {[primary, secondary].map((items, index) => <div key={index} className={index ? 'workspace-secondary' : ''}>
        {items.map(({ id, label, icon: Icon, active }) => <Link key={id} aria-label={label} title={label} href={`/?tab=${id}`} aria-current={active ? 'page' : undefined} className="workspace-nav-item">
          <Icon size={18} aria-hidden="true" /><span>{label}</span>
        </Link>)}
      </div>)}
    </nav>
    <div className="workspace-footer"><span className="size-1.5 rounded-full bg-emerald-400" /> {host}</div>
  </aside>;
}
