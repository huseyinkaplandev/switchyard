// Replaces ui/app/_actions (Next server actions) inside the playground bundle. The Vite config
// redirects every import of that module here. Each export keeps the real action's signature.
import type * as Actions from '@ui/_actions';
import type { WorkspaceGitState } from '@ui/_lib/handoff';
import type { AgentId } from '@ui/_lib/agents';
import {
  archive, archiveStatus, armLiveReplay, currentState, liveConversationId, markHandled as storeMarkHandled,
  setLead as storeSetLead, snapshot, syncArchive, threadMessages,
} from './store';

type Signature<Name extends keyof typeof Actions> = (typeof Actions)[Name];
const delay = <T>(value: T, ms = 120) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const demoOnly = (what: string) => () => Promise.reject(new Error(`Demo mode: ${what} is not available in the browser playground.`));

export const listCodexThreads: Signature<'listCodexThreads'> = () => delay(clone(archive.threads));

export const getCodexThreadMessages: Signature<'getCodexThreadMessages'> = (id) => {
  if (id === liveConversationId) armLiveReplay();
  return delay(clone(threadMessages(id)), 160);
};

export const getAgentThreadSnapshot: Signature<'getAgentThreadSnapshot'> = (id) =>
  delay(archive.threads.some(thread => thread.id === id) ? clone(snapshot.threadSnapshots[id] ?? null) : null);

export const syncAgentArchive: Signature<'syncAgentArchive'> = () => delay(syncArchive(), 400);

export const getWorkspaceGitState: Signature<'getWorkspaceGitState'> = (cwd) =>
  delay(snapshot.gitStates[cwd] ?? ({ available: false, error: 'directory not found' } satisfies WorkspaceGitState));

export const getAgentArchiveHealth: Signature<'getAgentArchiveHealth'> = () => delay(archiveStatus());

export const removeAgentSession: Signature<'removeAgentSession'> = async (id) => {
  const before = archive.threads.length;
  archive.threads = archive.threads.filter(thread => thread.id !== id);
  archive.deleted += before - archive.threads.length;
  await delay(undefined);
};

export const pruneAgentArchive: Signature<'pruneAgentArchive'> = async (days) => {
  const cutoff = Date.now() - days * 86_400_000;
  const before = archive.threads.length;
  archive.threads = archive.threads.filter(thread => !thread.archived || Date.parse(thread.updatedAt) >= cutoff);
  archive.deleted += before - archive.threads.length;
  return delay(before - archive.threads.length);
};

export const getState: Signature<'getState'> = () => delay(currentState(), 40);
export const listTasks: Signature<'listTasks'> = () => delay(clone(snapshot.tasks), 40);

export const setLead: Signature<'setLead'> = async (id: AgentId) => { storeSetLead(id); await delay(undefined); };
export const markHandled: Signature<'markHandled'> = async (ids) => { storeMarkHandled(ids); await delay(undefined); };

export const buildPrompt: Signature<'buildPrompt'> = async (id) => {
  const task = snapshot.tasks.find(item => item.id === id);
  if (!task) throw new Error(`Task with id ${id} not found`);
  const role = task.role || 'architect';
  const assignee = task.assignee || 'codex';
  return `# AGENTS.md\n${snapshot.state.agentsMd}\n\n---\n\n# Assigned Task: ${task.id}\nRole: ${role}\nAssignee: ${assignee}\n\n${task.body}\n\n---\n\nFirst step: read the last 30 lines of LIVE_LOG.md.\nWhen done: log-agent ${assignee} ${role} "${task.id} done, <short summary>"`;
};

// The views in the playground never reach these; they exist so every import of the module resolves.
export const getTask: Signature<'getTask'> = async (id) => snapshot.tasks.find(task => task.id === id) ?? null;
export const updateTaskStatus: Signature<'updateTaskStatus'> = demoOnly('editing tasks');
export const updateTaskAssignee: Signature<'updateTaskAssignee'> = demoOnly('editing tasks');
export const createTask: Signature<'createTask'> = demoOnly('creating tasks');
export const updateTask: Signature<'updateTask'> = demoOnly('editing tasks');
export const deleteTask: Signature<'deleteTask'> = demoOnly('deleting tasks');
export const bulkUpdateTaskStatus: Signature<'bulkUpdateTaskStatus'> = demoOnly('editing tasks');
export const bulkDeleteTasks: Signature<'bulkDeleteTasks'> = demoOnly('deleting tasks');
export const updateAgentsMd: Signature<'updateAgentsMd'> = demoOnly('editing AGENTS.md');
export const getAgentsHistory: Signature<'getAgentsHistory'> = async () => [];
export const getHistoryVersion: Signature<'getHistoryVersion'> = async () => snapshot.state.agentsMd;
export const listDrafts: Signature<'listDrafts'> = async () => [];
export const getDraft: Signature<'getDraft'> = async () => null;
export const createDraft: Signature<'createDraft'> = demoOnly('saving drafts');
export const updateDraft: Signature<'updateDraft'> = demoOnly('saving drafts');
export const deleteDraft: Signature<'deleteDraft'> = demoOnly('deleting drafts');
