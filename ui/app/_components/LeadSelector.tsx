'use client';

import { useTransition } from 'react';
import { AGENTS, AgentId } from '../_lib/agents';
import { setLead } from '../_actions';

interface LeadSelectorProps {
  currentLead: AgentId;
  onLeadChange: (newLead: AgentId) => void;
}

export default function LeadSelector({ currentLead, onLeadChange }: LeadSelectorProps) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLead = e.target.value as AgentId;
    // Optimistic local state update immediately
    onLeadChange(nextLead);

    startTransition(async () => {
      try {
        await setLead(nextLead);
      } catch (error) {
        console.error('Failed to set lead:', error);
      }
    });
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-400 font-medium">Lead:</span>
      <div className="relative">
        <select
          id="lead-selector"
          value={currentLead}
          onChange={handleChange}
          disabled={isPending}
          className="bg-zinc-900 border border-zinc-800 text-zinc-100 px-3 py-1.5 rounded-lg appearance-none cursor-pointer focus:outline-none focus:border-zinc-700 transition-colors pr-8 min-w-[140px] font-medium"
        >
          {AGENTS.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[8px]">
          ▼
        </span>
      </div>
      {isPending && <span className="text-zinc-500 animate-pulse text-[10px] ml-1 font-mono">saving...</span>}
    </div>
  );
}
