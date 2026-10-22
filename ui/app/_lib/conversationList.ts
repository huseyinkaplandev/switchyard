import type { AgentArchiveThread } from './agentArchiveDb';
import type { HandoffCandidate } from './desktopHandoff/types';

export type ConversationScope = 'active' | 'archived' | 'all';
export type ConversationKind = 'all' | 'normal' | 'scheduled';

export function normalizeProjectPath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

/** Native Desktop identity links rotated CLI histories; titles never identify chats. */
function desktopIdentity(item: HandoffCandidate) {
  return item.desktopId ? JSON.stringify([item.provider, item.platform, item.sourceAccount, item.desktopId]) : item.key;
}

function preferCandidate(next: HandoffCandidate, previous: HandoffCandidate) {
  const nextCurrent = next.sourceId === next.currentSourceId;
  const previousCurrent = previous.sourceId === previous.currentSourceId;
  if (nextCurrent !== previousCurrent) return nextCurrent;
  return (next.activityAt || '') > (previous.activityAt || '');
}

export function latestScheduledCandidates(candidates: HandoffCandidate[], allRuns: boolean) {
  const native = new Map<string, HandoffCandidate>();
  for (const candidate of candidates) {
    const key = desktopIdentity(candidate);
    const previous = native.get(key);
    if (!previous || preferCandidate(candidate, previous)) native.set(key, candidate);
  }
  const rows = new Map<string, HandoffCandidate>();
  for (const candidate of native.values()) {
    const key = !allRuns && candidate.scheduledTaskId
      ? JSON.stringify([candidate.provider, candidate.platform, candidate.sourceAccount, candidate.scheduledTaskId, normalizeProjectPath(candidate.projectRoot || candidate.cwd)])
      : desktopIdentity(candidate);
    const previous = rows.get(key);
    if (!previous || (candidate.activityAt || '') > (previous.activityAt || '')) rows.set(key, candidate);
  }
  return [...rows.values()];
}

/** Collapse runs only when native task, account, platform and project agree. */
export function conversationList(threads: AgentArchiveThread[], metadata: Record<string,HandoffCandidate>, scope: ConversationScope, kind: ConversationKind, allRuns: boolean) {
  const counts: Record<string,number> = {};
  const groups = new Map<string,AgentArchiveThread>();
  const native = new Map<string,AgentArchiveThread>();
  const result: AgentArchiveThread[] = [];
  for (const thread of threads) {
    const item = metadata[thread.id];
    const key = item?.desktopId ? desktopIdentity(item) : `${thread.provider}:${thread.id}`;
    const previous = native.get(key);
    if (!previous || (item && metadata[previous.id] ? preferCandidate(item, metadata[previous.id]) : thread.updatedAt > previous.updatedAt)) native.set(key,thread);
  }
  for (const thread of native.values()) {
    const item=metadata[thread.id];
    const archived=item?.archived ?? thread.archived;
    if (scope==='active' && archived || scope==='archived' && !archived) continue;
    if (kind==='scheduled' && item?.chatType!=='scheduled' || kind==='normal' && item?.chatType==='scheduled') continue;
    if (thread.sourcePath && /[\\/]subagents[\\/]/i.test(thread.sourcePath)) continue;
    if (!thread.promptCount && !thread.responseCount) continue;
    if (allRuns || !item?.scheduledTaskId) { result.push(thread); continue; }
    const key=JSON.stringify([thread.provider,item.platform,item.sourceAccount,item.scheduledTaskId,normalizeProjectPath(item.projectRoot || thread.cwd)]);
    const previous=groups.get(key);
    if (!previous) { groups.set(key,thread); counts[thread.id]=1; }
    else {
      const newer=(item.activityAt || thread.updatedAt)>(metadata[previous.id]?.activityAt || previous.updatedAt);
      if (newer) { counts[thread.id]=counts[previous.id]+1; delete counts[previous.id]; groups.set(key,thread); }
      else counts[previous.id]++;
    }
  }
  return { threads:[...result,...groups.values()], counts };
}
