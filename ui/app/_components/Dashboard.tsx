'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { AgentId } from '../_lib/agents';
import { LogEntry } from '../_lib/parseLog';
import { Task } from '../_lib/parseTask';
import { Mention } from '../_lib/parseMentions';
import { getState, listTasks } from '../_actions';
import { Locale, TRANSLATIONS } from '../_lib/translations';
import { RolesMap } from '../_lib/roles';
import AgentGrid from './AgentGrid';
import LogStream from './LogStream';
import Tabs from './Tabs';
import ConversationViews from './ConversationViews';
import KanbanBoard from './KanbanBoard';
import AgentsMdEditor from './AgentsMdEditor';
import CopyAgentsMd from './CopyAgentsMd';
import SnapshotButton from './SnapshotButton';
import PromptTab from './PromptTab';
import AIInsightPanel from './AIInsightPanel';
import DailyReport from './DailyReport';
import AIChatWidget from './AIChatWidget';
import SchedulesPanel from './SchedulesPanel';
import SessionsPanel from './SessionsPanel';
import CodexSessions from './CodexSessions';
import type { AgentArchiveThread } from '../_lib/agentArchiveDb';

interface DashboardProps {
  initial: {
    entries: LogEntry[];
    lead: AgentId;
    agentsMd: string;
    rolesWarning: string | null;
    roles: RolesMap;
    mentions: {
      pending: Mention[];
      byAgent: Record<AgentId, number>;
    };
  };
  initialTasks: Task[];
  initialCodexThreads: AgentArchiveThread[];
}

function DashboardContent({ initial, initialTasks, initialCodexThreads }: DashboardProps) {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'codex';

  const [entries, setEntries] = useState<LogEntry[]>(initial.entries);
  const [lead, setLead] = useState<AgentId>(initial.lead);
  const [agentsMd, setAgentsMd] = useState<string>(initial.agentsMd);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [rolesWarning, setRolesWarning] = useState<string | null>(initial.rolesWarning);
  const [roles, setRoles] = useState<RolesMap>(initial.roles);

  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem('locale') as Locale;
    if (saved === 'tr' || saved === 'en') {
      setLocale(saved);
    }
  }, []);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const changeLocale = (newLoc: Locale) => {
    setLocale(newLoc);
    localStorage.setItem('locale', newLoc);
  };

  const t = TRANSLATIONS[locale];

  // Normalize initial mentions timestamps
  const initialNormalizedMentions = {
    ...initial.mentions,
    pending: initial.mentions.pending.map((m) => ({
      ...m,
      ts: m.ts instanceof Date ? m.ts : new Date(m.ts),
    })),
  };
  const [mentions, setMentions] = useState(initialNormalizedMentions);

  // Poll for updates every 1000ms
  const triggerPoll = async () => {
    try {
      const [state, tasksList] = await Promise.all([
        getState(),
        listTasks(),
      ]);

      const normalizedEntries = state.entries.map((entry) => ({
        ...entry,
        ts: entry.ts instanceof Date ? entry.ts : new Date(entry.ts),
      }));

      // Normalize poll mentions timestamps
      const normalizedMentions = {
        ...state.mentions,
        pending: state.mentions.pending.map((m) => ({
          ...m,
          ts: m.ts instanceof Date ? m.ts : new Date(m.ts),
        })),
      };

      setEntries(normalizedEntries);
      setLead(state.lead);
      setAgentsMd(state.agentsMd);
      setTasks(tasksList);
      setRolesWarning(state.rolesWarning);
      setRoles(state.roles);
      setMentions(normalizedMentions);
    } catch (error: any) {
      console.error('Failed to poll agent state:', error);
      const errMsg = String(error?.message || error);
      if (
        errMsg.includes('Failed to find Server Action') ||
        errMsg.includes('Failed to fetch') ||
        errMsg.includes('apply') ||
        errMsg.includes('TypeError') ||
        errMsg.includes('unexpected response')
      ) {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    }
  };

  useEffect(() => {
    const interval = setInterval(triggerPoll, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute situational context logs (last 10 raw entries) for mention prompts builder
  const last10LogLines = entries
    .slice(-10)
    .map((e) => e.raw)
    .join('\n');

  const subtitle = ({
    codex: t.workspaceChats, sessions: t.workspaceChats, schedules: t.workspaceSchedules,
    tasks: t.workspaceTasks, live: t.workspaceActivity, prompts: t.promptChat,
    insights: t.aiInsights, report: t.dailyReport,
  } as Record<string, string>)[activeTab] || t.workspaceChats;

  return (
    <div className="workspace-shell">
      <a href="#workspace-main" className="workspace-skip">{locale === 'tr' ? 'İçeriğe geç' : 'Skip to content'}</a>
      <Tabs locale={locale} />
      <div className="workspace-center">
      {/* Roles Mapping Configuration Error Alert Banner */}
      {rolesWarning && (
        <div className="bg-amber-950/40 border border-amber-900/60 text-amber-300 px-4 py-2.5 rounded-lg text-xs font-mono select-none flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <span className="font-semibold">Warning:</span> {rolesWarning}
        </div>
      )}

      {/* Sticky Header */}
      <header className="workspace-header">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-100 font-sans select-none">
            {subtitle}
          </h1>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5 font-mono select-none">
            {t.workspaceLocal}
          </p>
        </div>
        <div className="flex items-center gap-2.5 sm:gap-3.5 justify-between sm:justify-end">
          <AIChatWidget locale={locale} />
          {/* EN / TR language switch */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-850 p-0.5 rounded-lg select-none">
            <button
              aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}
              className={`px-2 py-1 rounded text-xs font-medium cursor-pointer transition-all ${
                locale === 'en' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-550 hover:text-zinc-350'
              }`}
            >
              EN
            </button>
            <button
              aria-pressed={locale === 'tr'} onClick={() => changeLocale('tr')}
              className={`px-2 py-1 rounded text-xs font-medium cursor-pointer transition-all ${
                locale === 'tr' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-550 hover:text-zinc-350'
              }`}
            >
              TR
            </button>
          </div>

          {activeTab !== 'tasks' && (
            <AgentsMdEditor locale={locale} />
          )}
        </div>
      </header>

      {/* Tabs Switcher Selector */}

      {/* Main Tab Render Container */}
      <main id="workspace-main" className="workspace-main">
        {['codex', 'sessions'].includes(activeTab) && <ConversationViews locale={locale} archive={activeTab === 'sessions'} />}
        {activeTab === 'schedules' && <SchedulesPanel locale={locale} />}
        {activeTab === 'sessions' && <SessionsPanel locale={locale} />}
        {activeTab === 'tasks' && (
          <section aria-label="Tasks Kanban Board">
            <KanbanBoard tasks={tasks} onRefresh={triggerPoll} locale={locale} />
          </section>
        )}

        {activeTab === 'prompts' && (
          <section aria-label="Prompt Editor">
            <PromptTab locale={locale} onRefresh={triggerPoll} />
          </section>
        )}

        {activeTab === 'codex' && (
          <section aria-label="Codex projects and sessions" className="flex flex-col gap-5">
            <CodexSessions initialThreads={initialCodexThreads} locale={locale} />
          </section>
        )}

        {activeTab === 'insights' && (
          <section aria-label="AI Insights Panel">
            <AIInsightPanel locale={locale} />
          </section>
        )}

        {activeTab === 'report' && (
          <section aria-label="Daily Report">
            <DailyReport locale={locale} />
          </section>
        )}

        {activeTab === 'live' && (
          <>
            {/* Main Grid of Agents */}
            <section aria-label="AI Agents Status Grid">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider font-semibold select-none">
                  {locale === 'tr' ? 'Agent Durumu' : 'Agent Status'}
                </span>
                <CopyAgentsMd agentsMd={agentsMd} locale={locale} />
              </div>
              <AgentGrid
                entries={entries}
                lead={lead}
                mentions={mentions}
                last10LogLines={last10LogLines}
                agentsMd={agentsMd}
                locale={locale}
                onSelectLead={(id) => setLead(id as AgentId)}
              />
            </section>

            {/* Live Logs Console */}
            <section aria-label="Terminal Stream Log" className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <span />
                <SnapshotButton
                  lead={lead}
                  roles={roles}
                  tasks={tasks}
                  pendingMentions={mentions.pending}
                  entries={entries}
                  locale={locale}
                  compact
                />
              </div>
              <LogStream entries={entries} locale={locale} />
            </section>
          </>
        )}
      </main>

      </div>
    </div>
  );
}

export default function Dashboard({ initial, initialTasks, initialCodexThreads }: DashboardProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center font-mono text-xs select-none">
        Loading Switchyard...
      </div>
    }>
      <DashboardContent
        initial={initial}
        initialTasks={initialTasks}
        initialCodexThreads={initialCodexThreads}
      />
    </Suspense>
  );
}
