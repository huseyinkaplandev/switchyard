import { AGENTS } from './agents';

export type LogEntry = Readonly<{
  ts: Date;
  role: string;        // architect, frontend, lead, ...
  agentId: string;     // id from AGENTS, 'unknown' if no match
  message: string;
  raw: string;
}>;

const LOG_REGEX = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+([\w-]+)\/([\w-]+):\s+(.+)$/;

export function parseLog(text: string): LogEntry[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const entries: LogEntry[] = [];
  const validAgentIds = new Set<string>(AGENTS.map(a => a.id));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const match = trimmed.match(LOG_REGEX);
    if (!match) continue;

    const [, tsStr, role, agentIdInput, message] = match;
    
    // Parse timestamp safely (replacing space with 'T' so standard new Date parser handles it as ISO-like)
    // Note: YYYY-MM-DD HH:MM -> YYYY-MM-DDTHH:MM
    const isoString = tsStr.replace(' ', 'T');
    const dateVal = new Date(isoString);
    if (isNaN(dateVal.getTime())) {
      continue; // Invalid timestamp, skip the line
    }

    const agentId = validAgentIds.has(agentIdInput) ? agentIdInput : 'unknown';

    entries.push({
      ts: dateVal,
      role,
      agentId,
      message,
      raw: trimmed
    });
  }

  return entries;
}
