'use client';

import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { Agent } from '../_lib/agents';
import { LogEntry } from '../_lib/parseLog';
import { Mention } from '../_lib/parseMentions';
import { Locale, TRANSLATIONS } from '../_lib/translations';
import MentionPanel from './MentionPanel';
import AgentIcon from './AgentIcon';

interface AgentCardProps {
  agent: Agent;
  latestLog: LogEntry | undefined;
  isLead: boolean;
  pendingCount: number;
  pendingMentions: Mention[];
  last10LogLines: string;
  agentsMd: string;
  locale: Locale;
  onSelectLead: (id: string) => void;
}

export default function AgentCard({
  agent,
  latestLog,
  isLead,
  pendingCount,
  pendingMentions,
  last10LogLines,
  agentsMd,
  locale,
  onSelectLead,
}: AgentCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMentionPanel, setShowMentionPanel] = useState(false);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const t = TRANSLATIONS[locale];

  // Compute active status and minutes since last heartbeat log
  let status: 'active' | 'idle' | 'cold' = 'cold';
  let timeStr: string = t.neverActive;
  let diffMins = 0;

  if (mounted && latestLog) {
    const diffMs = Date.now() - new Date(latestLog.ts).getTime();
    diffMins = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMins < 5) {
      status = 'active';
      timeStr = diffMins === 0 ? t.activeJustNow : t.activeMinsAgo(diffMins);
    } else if (diffMins < 30) {
      status = 'idle';
      timeStr = t.idleMinsAgo(diffMins);
    } else {
      status = 'cold';
      timeStr = t.coldMinsAgo(diffMins);
    }
  } else {
    status = 'cold';
    timeStr = t.neverActive;
  }

  // Accent shadow colors
  const statusColorClass = {
    active: 'bg-emerald-500 shadow-[0_0_8px_#10b981]',
    idle: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]',
    cold: 'bg-zinc-600',
  }[status];

  // Glow shadow styling for active lead agent
  const cardStyle = isLead
    ? {
        border: `2px solid ${agent.color}`,
        boxShadow: `0 0 24px -8px ${agent.color}40`,
      }
    : {
        border: '1px solid #18181b', // zinc-900
      };

  return (
    <>
      <div
        style={cardStyle}
        onClick={() => onSelectLead(agent.id)}
        className={`relative aspect-[4/3] p-4 rounded-xl flex flex-col justify-between transition-all duration-200 bg-zinc-950/70 backdrop-blur-sm group hover:scale-[1.01] cursor-pointer ${
          isLead ? '' : 'hover:border-zinc-800'
        }`}
      >
        {/* Top Header Row */}
        <div className="flex items-center justify-between">
          {/* Initial Badge */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold font-mono select-none"
          >
            <AgentIcon agent={agent.id} size={30} />
          </div>

          {/* Indicators: Badge + status dot */}
          <div className="flex items-center gap-2">
            {/* Mention Pending Badge */}
            {pendingCount > 0 && (
              <button
                onClick={() => setShowMentionPanel(true)}
                className="bg-amber-400/15 text-amber-300 border border-amber-400/30 text-xs font-mono cursor-pointer rounded-full px-2 py-0.5 transition-all hover:bg-amber-400/25 select-none font-semibold animate-pulse"
              >
                                <Bell size={11} className="inline mr-0.5" /> @{pendingCount}
              </button>
            )}

            {/* Status Dot with hover tooltip */}
            <div className="relative">
              <button
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onFocus={() => setShowTooltip(true)}
                onBlur={() => setShowTooltip(false)}
                className="w-2.5 h-2.5 rounded-full cursor-pointer relative focus:outline-none"
              >
                <span className={`absolute inset-0 rounded-full ${statusColorClass} ${status === 'active' ? 'pulse-dot' : ''}`} />
              </button>

              {showTooltip && (
                <div className="absolute right-0 bottom-full mb-2 z-50 whitespace-nowrap bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 px-2 py-1 rounded-md shadow-xl font-mono select-none font-semibold">
                  {timeStr}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle Agent Information */}
        <div className="mt-4 flex-grow flex flex-col justify-end pb-2">
          <h3 className="font-semibold text-zinc-100 text-sm select-none">{agent.name}</h3>
          <p className="text-xs text-zinc-500 font-medium select-none">{agent.vendor}</p>
        </div>

        {/* Bottom Monospace Clamped Log Message */}
        <div className="mt-auto border-t border-zinc-900/50 pt-2 h-10 flex items-center">
          {latestLog ? (
            <p className="text-xs font-mono text-zinc-400 line-clamp-2 leading-relaxed break-all">
              <span className="text-zinc-650 font-medium">[{latestLog.role}]</span> {latestLog.message}
            </p>
          ) : (
            <p className="text-xs font-mono text-zinc-650 italic select-none">{t.noLogsAvailable}</p>
          )}
        </div>
      </div>

      {/* Render Mention Panel modal if requested */}
      {showMentionPanel && (
        <MentionPanel
          agent={agent}
          pendingMentions={pendingMentions}
          last10LogLines={last10LogLines}
          agentsMd={agentsMd}
          onClose={() => setShowMentionPanel(false)}
          locale={locale}
        />
      )}
    </>
  );
}
