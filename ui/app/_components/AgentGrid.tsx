import { AGENTS, AgentId } from '../_lib/agents';
import { LogEntry } from '../_lib/parseLog';
import { Mention } from '../_lib/parseMentions';
import { Locale } from '../_lib/translations';
import AgentCard from './AgentCard';

interface AgentGridProps {
  entries: LogEntry[];
  lead: AgentId;
  mentions: {
    pending: Mention[];
    byAgent: Record<AgentId, number>;
  };
  last10LogLines: string;
  agentsMd: string;
  locale: Locale;
  onSelectLead: (id: string) => void;
}

export default function AgentGrid({
  entries,
  lead,
  mentions,
  last10LogLines,
  agentsMd,
  locale,
  onSelectLead,
}: AgentGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {AGENTS.map((agent) => {
        const agentLogs = entries.filter((e) => e.agentId === agent.id);
        const latestLog = agentLogs[agentLogs.length - 1];

        const agentPendingMentions = mentions.pending.filter(
          (m) => m.targetSlug === agent.id || m.targetType === 'all'
        );

        return (
          <AgentCard
            key={agent.id}
            agent={agent}
            latestLog={latestLog}
            isLead={lead === agent.id}
            pendingCount={mentions.byAgent[agent.id] || 0}
            pendingMentions={agentPendingMentions}
            last10LogLines={last10LogLines}
            agentsMd={agentsMd}
            locale={locale}
            onSelectLead={onSelectLead}
          />
        );
      })}
    </div>
  );
}
