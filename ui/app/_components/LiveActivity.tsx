'use client';

import type { AgentId } from '../_lib/agents';
import type { LogEntry } from '../_lib/parseLog';
import type { Mention } from '../_lib/parseMentions';
import type { Task } from '../_lib/parseTask';
import type { RolesMap } from '../_lib/roles';
import type { Locale } from '../_lib/translations';
import AgentGrid from './AgentGrid';
import CopyAgentsMd from './CopyAgentsMd';
import LogStream from './LogStream';
import SnapshotButton from './SnapshotButton';

interface LiveActivityProps {
  entries: LogEntry[];
  lead: AgentId;
  agentsMd: string;
  roles: RolesMap;
  tasks: Task[];
  mentions: {
    pending: Mention[];
    byAgent: Record<AgentId, number>;
  };
  locale: Locale;
  onSelectLead: (id: AgentId) => void;
}

/** The Activity tab: agent status grid and the live log stream. */
export default function LiveActivity({ entries, lead, agentsMd, roles, tasks, mentions, locale, onSelectLead }: LiveActivityProps) {
  // Situational context (last 10 raw entries) for the mention prompt builder.
  const last10LogLines = entries
    .slice(-10)
    .map((e) => e.raw)
    .join('\n');

  return (
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
          onSelectLead={(id) => onSelectLead(id as AgentId)}
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
  );
}
