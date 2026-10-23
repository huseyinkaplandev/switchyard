import { useEffect, useState } from 'react';
import CodexSessions from '@ui/_components/CodexSessions';
import DesktopHandoffPanel from '@ui/_components/DesktopHandoffPanel';
import LiveActivity from '@ui/_components/LiveActivity';
import SchedulesPanel from '@ui/_components/SchedulesPanel';
import type { AgentArchiveThread } from '@ui/_lib/agentArchiveDb';
import type { Task } from '@ui/_lib/parseTask';
import type { Locale } from '@ui/_lib/translations';
import { getState, listCodexThreads, listTasks, setLead } from '../mock/actions';
import { samplePackageId, startLiveReplay } from '../mock/store';
import { onRouterRefresh } from '../shims/next-navigation';

function Loading({ label }: { label: string }) {
  return <p role="status" className="aui-muted">{label}</p>;
}

/** The conversations tab: what app/page.tsx renders for `?tab=codex`, minus the server render. */
export function ArchiveView({ locale }: { locale: Locale }) {
  const [threads, setThreads] = useState<AgentArchiveThread[] | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => { void listCodexThreads().then(next => { if (active) setThreads(next); }); };
    load();
    const stop = onRouterRefresh(load);
    return () => { active = false; stop(); };
  }, []);
  if (!threads) return <Loading label={locale === 'tr' ? 'Sohbetler yükleniyor…' : 'Loading conversations…'} />;
  return (
    <section aria-label="Codex projects and sessions" className="flex flex-col gap-5">
      <CodexSessions initialThreads={threads} locale={locale} />
    </section>
  );
}

export function SchedulesView({ locale }: { locale: Locale }) {
  return <SchedulesPanel locale={locale} />;
}

type ActivityState = Awaited<ReturnType<typeof getState>>;

/** The activity tab, polled every second like Dashboard does; the demo-live replay runs meanwhile. */
export function LiveView({ locale }: { locale: Locale }) {
  const [state, setState] = useState<ActivityState | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    let active = true;
    startLiveReplay();
    const poll = async () => {
      const [next, nextTasks] = await Promise.all([getState(), listTasks()]);
      if (active) { setState(next); setTasks(nextTasks); }
    };
    void poll();
    const interval = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  if (!state) return <Loading label={locale === 'tr' ? 'Etkinlik yükleniyor…' : 'Loading activity…'} />;
  return (
    <LiveActivity
      entries={state.entries}
      lead={state.lead}
      agentsMd={state.agentsMd}
      roles={state.roles}
      tasks={tasks}
      mentions={state.mentions}
      locale={locale}
      onSelectLead={(id) => { setState(current => current && { ...current, lead: id }); void setLead(id); }}
    />
  );
}

export function HandoffView({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  return (
    <div className="sy-handoff">
      <DesktopHandoffPanel locale={locale} onClose={onClose} initialPackageId={samplePackageId} />
    </div>
  );
}
