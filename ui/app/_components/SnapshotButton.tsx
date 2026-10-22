'use client';

import { useState } from 'react';
import { Check, Camera } from 'lucide-react';
import { AgentId, AGENTS } from '../_lib/agents';
import { LogEntry } from '../_lib/parseLog';
import { Task } from '../_lib/parseTask';
import { Mention } from '../_lib/parseMentions';
import { RolesMap } from '../_lib/roles';
import { Locale, TRANSLATIONS } from '../_lib/translations';

interface SnapshotButtonProps {
  lead: AgentId;
  roles: RolesMap;
  tasks: Task[];
  pendingMentions: Mention[];
  entries: LogEntry[];
  locale: Locale;
  compact?: boolean;
}

export default function SnapshotButton({
  lead,
  roles,
  tasks,
  pendingMentions,
  entries,
  locale,
  compact,
}: SnapshotButtonProps) {
  const [copied, setCopied] = useState(false);
  const t = TRANSLATIONS[locale];

  const getAgentRole = (agentId: AgentId): string => {
    return Object.entries(roles).find(([_, id]) => id === agentId)?.[0] || 'no role';
  };

  const handleCapture = async () => {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const tsStr = `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;

    // 1. Lead Section
    const leadRole = getAgentRole(lead);
    const leadSection = `## ${t.lead}\n${lead} (${leadRole})`;

    // 2. Open Tasks Section (Non-done tasks)
    const openTasks = tasks.filter((t) => t.status !== 'done');
    const tasksRows =
      openTasks.length > 0
        ? openTasks
            .map((task) => {
              const assigneePart = task.assignee
                ? `${task.role || getAgentRole(task.assignee as AgentId)}/${task.assignee}`
                : (locale === 'tr' ? 'atanmadı' : 'unassigned');
              return `- ${task.id} [${task.status}] ${assigneePart}: ${task.title}`;
            })
            .join('\n')
        : t.noOpenTasks;
    const tasksSection = `## ${locale === 'tr' ? 'Açık Görevler' : 'Open Tasks'}\n${tasksRows}`;

    // 3. Pending Mentions Section
    const mentionsRows =
      pendingMentions.length > 0
        ? pendingMentions
            .map((m) => {
              const date = new Date(m.ts);
              const tStr = `${String(date.getHours()).padStart(2, '0')}:${String(
                date.getMinutes()
              ).padStart(2, '0')}`;
              return `- ${m.rawTarget} from ${m.fromRole}/${m.fromAgent} (${tStr}): "${m.message}"`;
            })
            .join('\n')
        : t.noPendingMentions;
    const mentionsSection = `## ${locale === 'tr' ? 'Bekleyen Bildirimler' : 'Pending Mentions'}\n${mentionsRows}`;

    // 4. Last 20 Log Lines Section
    const last20Logs = entries
      .slice(-20)
      .map((e) => e.raw)
      .join('\n');
    const logsSection = `## ${locale === 'tr' ? 'Son 20 Log Satırı' : 'Last 20 Log Lines'}\n${
      last20Logs || t.noLogsAvailable
    }`;

    // 5. Agent Status Section
    const statusRows = AGENTS.map((agent) => {
      const agentRole = getAgentRole(agent.id);
      const agentLogs = entries.filter((e) => e.agentId === agent.id);
      const latestLog = agentLogs[agentLogs.length - 1];

      let activityStr: string = t.cold;
      if (latestLog) {
        const diffMs = Date.now() - new Date(latestLog.ts).getTime();
        const diffMins = Math.max(0, Math.floor(diffMs / 60000));

        if (diffMins < 5) {
          activityStr = diffMins === 0 ? t.activeJustNow : t.activeMinsAgo(diffMins);
        } else if (diffMins < 30) {
          activityStr = t.idleMinsAgo(diffMins);
        } else {
          activityStr = t.coldMinsAgo(diffMins);
        }
      } else {
        activityStr = t.neverActive;
      }

      return `- ${agent.id}: ${activityStr} (${agentRole})`;
    }).join('\n');
    const statusSection = `## ${locale === 'tr' ? 'Agent Durumları' : 'Agent Status'}\n${statusRows}`;

    // Compile into final Snapshot Markdown
    const markdown = `# Switchyard — Status Snapshot
Generated: ${tsStr}

${leadSection}

${tasksSection}

${mentionsSection}

${logsSection}

${statusSection}
`;

    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy snapshot to clipboard:', err);
    }
  };

  return (
    <button
      onClick={handleCapture}
      className={`rounded-lg border text-xs font-semibold transition-all cursor-pointer select-none flex items-center ${
        compact ? 'p-1.5 gap-1' : 'px-3 py-1.5 gap-1.5'
      } ${
        copied
          ? 'bg-zinc-900 border-emerald-850 text-emerald-400'
          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
      }`}
    >
      {copied ? (
        <Check size={compact ? 14 : 16} />
      ) : (
        <Camera size={compact ? 16 : 18} />
      )}
    </button>
  );
}
