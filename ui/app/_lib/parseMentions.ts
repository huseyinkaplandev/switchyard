import crypto from 'node:crypto';
import { AgentId } from './agents';
import { LogEntry } from './parseLog';
import { RolesMap } from './roles';

export type Mention = Readonly<{
  id: string;              // sha-256 hex, first 16 characters
  ts: Date;
  fromRole: string;
  fromAgent: string;
  rawTarget: string;       // "@vitrin"
  targetSlug: string;      // after resolve: "cursor"
  targetType: 'agent' | 'role' | 'all' | 'unknown';
  message: string;         // message part of the log line
  raw: string;             // log line
}>;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function parseMentions(
  entries: LogEntry[],
  roles: RolesMap,
  agentIds: readonly AgentId[]
): Mention[] {
  const mentions: Mention[] = [];
  const validAgentIds = new Set<string>(agentIds);

  for (const entry of entries) {
    const message = entry.message;
    
    // Regex matching @([a-z][a-z0-9-]*) preceding start-of-line or space.
    // Omit matches with preceding non-whitespace (e.g. emails like name@domain.com)
    const regex = /(?:^|\s)@([a-z][a-z0-9-]*)/g;
    let match;

    while ((match = regex.exec(message)) !== null) {
      const rawSlug = match[1];
      const rawTarget = `@${rawSlug}`;
      
      let targetSlug = rawSlug;
      let targetType: 'agent' | 'role' | 'all' | 'unknown' = 'unknown';

      if (rawSlug === 'all') {
        targetType = 'all';
        targetSlug = 'all';
      } else if (validAgentIds.has(rawSlug)) {
        targetType = 'agent';
        targetSlug = rawSlug;
      } else if (roles[rawSlug]) {
        targetType = 'role';
        targetSlug = roles[rawSlug];
      }

      // Compute stable first 16 characters SHA-256 hash ID
      const tsIso = entry.ts instanceof Date ? entry.ts.toISOString() : new Date(entry.ts).toISOString();
      const inputStr = `${tsIso}|${entry.role}|${entry.agentId}|${rawTarget}|${message}`;
      const id = sha256(inputStr).slice(0, 16);

      mentions.push({
        id,
        ts: entry.ts instanceof Date ? entry.ts : new Date(entry.ts),
        fromRole: entry.role,
        fromAgent: entry.agentId,
        rawTarget,
        targetSlug,
        targetType,
        message,
        raw: entry.raw,
      });
    }
  }

  return mentions;
}
