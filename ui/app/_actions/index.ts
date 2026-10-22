'use server';

import { revalidatePath } from 'next/cache';
import { readWorkspaceGitState } from '../_lib/workspaceGit';
import { AgentId, AGENTS } from '../_lib/agents';
import { LogEntry, parseLog } from '../_lib/parseLog';
import { Task, TaskStatus } from '../_lib/parseTask';
import { getRoles, RolesMap } from '../_lib/roles';
import { Mention, parseMentions } from '../_lib/parseMentions';
import { readMentionsRead, markMentionsRead } from '../_lib/mentions';
import {
  readAgentsMd,
  readLead,
  readLog,
  writeLead,
  readAllTasks,
  writeTaskFile,
  updateTaskMetadata,
  deleteTaskFile,
  getNextTaskId,
  writeAgentsMd,
  listAgentsHistory,
  readAgentsHistoryVersion,
  AgentsHistoryEntry,
} from '../_lib/files';
import { draftList, draftGetById, draftCreate, draftUpdate, draftDelete } from '../_lib/db';
import {
  deleteAgentThread,
  getAgentArchiveStatus,
  getAgentThread,
  getAgentThreadMessages,
  listAgentThreads,
  pruneAgentThreads,
  syncAgentSessions,
} from '../_lib/agentArchive';
export async function listCodexThreads() {
  /**
   * Server rendering does NOT wait for a full filesystem scan.
   *
   * When the archive already has rows, return them at once and refresh in
   * the background; the client syncs periodically and reloads the list when
   * something changed. An empty archive (first start) is worth waiting for:
   * otherwise the user would see an empty list.
   */
  const cached = listAgentThreads();
  if (cached.length === 0) {
    await syncAgentSessions();
    return listAgentThreads();
  }
  void syncAgentSessions().catch(() => undefined);
  return cached;
}

export async function getCodexThreadMessages(id: string) {
  return getAgentThreadMessages(id);
}

export async function getAgentThreadSnapshot(id: string) {
  return getAgentThread(id);
}

export async function syncAgentArchive() {
  return syncAgentSessions();
}

export async function getWorkspaceGitState(cwd: string) {
  return readWorkspaceGitState(cwd);
}

export async function getAgentArchiveHealth() {
  return getAgentArchiveStatus();
}

export async function removeAgentSession(id: string) {
  deleteAgentThread(id);
  revalidatePath('/');
}

export async function pruneAgentArchive(days: number) {
  const deleted = pruneAgentThreads(days);
  revalidatePath('/');
  return deleted;
}

export async function getState(): Promise<{
  entries: LogEntry[];
  lead: AgentId;
  agentsMd: string;
  rolesWarning: string | null;
  roles: RolesMap;
  mentions: {
    pending: Mention[];
    byAgent: Record<AgentId, number>;
  };
}> {
  // Read all files concurrently without caching
  const [agentsMd, logText, leadText, rolesResult, readSet] = await Promise.all([
    readAgentsMd(),
    readLog(),
    readLead(),
    getRoles(),
    readMentionsRead(),
  ]);

  const parsedLogs = parseLog(logText);
  // Max last 500 lines for the log list displayed in UI
  const entries = parsedLogs.slice(-500);
  const lead = leadText as AgentId;

  // Parse all mentions out of all loaded logs history (parsedLogs)
  const allMentions = parseMentions(parsedLogs, rolesResult.roles, AGENTS.map(a => a.id));

  // Filter out handled (read) mention IDs
  const pending = allMentions.filter(m => !readSet.has(m.id));

  // Group pending counts by agent
  const byAgent = {} as Record<AgentId, number>;
  for (const agent of AGENTS) {
    byAgent[agent.id] = 0;
  }

  for (const mention of pending) {
    if (mention.targetType === 'all') {
      // @all expands to all agents
      for (const agent of AGENTS) {
        byAgent[agent.id]++;
      }
    } else if (mention.targetType === 'agent' || mention.targetType === 'role') {
      const slug = mention.targetSlug as AgentId;
      if (byAgent[slug] !== undefined) {
        byAgent[slug]++;
      }
    }
  }

  return {
    entries,
    lead,
    agentsMd,
    rolesWarning: rolesResult.error,
    roles: rolesResult.roles,
    mentions: {
      pending,
      byAgent,
    },
  };
}

export async function setLead(id: AgentId): Promise<void> {
  await writeLead(id);
  revalidatePath('/');
}

// ==========================================
// TASK SYSTEM SERVER ACTIONS
// ==========================================

export async function listTasks(): Promise<Task[]> {
  return await readAllTasks();
}

export async function getTask(id: string): Promise<Task | null> {
  const tasks = await readAllTasks();
  return tasks.find(t => t.id === id) || null;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  await updateTaskMetadata(id, { status });
  revalidatePath('/');
}

export async function updateTaskAssignee(id: string, assignee: string | null): Promise<void> {
  let role: string | null = null;
  if (assignee === 'codex' || assignee === 'claude-code' || assignee === 'cursor') {
    role = 'architect';
  } else if (assignee) {
    role = 'frontend';
  }
  
  await updateTaskMetadata(id, { assignee, role });
  revalidatePath('/');
}

export async function buildPrompt(id: string): Promise<string> {
  const [tasks, agentsMd] = await Promise.all([
    readAllTasks(),
    readAgentsMd(),
  ]);

  const task = tasks.find(t => t.id === id);
  if (!task) {
    throw new Error(`Task with id ${id} not found`);
  }

  const role = task.role || 'architect';
  const assignee = task.assignee || 'codex';

  return `# AGENTS.md
${agentsMd}

---

# Assigned Task: ${task.id}
Role: ${role}
Assignee: ${assignee}

${task.body}

---

First step: read the last 30 lines of LIVE_LOG.md.
When done: log-agent ${assignee} ${role} "${task.id} done, <short summary>"`;
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export async function createTask(taskData: {
  title: string;
  priority: 'low' | 'normal' | 'high';
  assignee: string | null;
  body: string;
}): Promise<void> {
  const nextId = await getNextTaskId();
  const slug = generateSlug(taskData.title) || 'task';
  const filename = `${nextId}-${slug}.md`;
  const created = new Date().toISOString().split('T')[0];

  let role: string | null = null;
  if (taskData.assignee === 'codex' || taskData.assignee === 'claude-code' || taskData.assignee === 'cursor') {
    role = 'architect';
  } else if (taskData.assignee) {
    role = 'frontend';
  }

  const newTask: Task = {
    id: nextId,
    title: taskData.title,
    status: 'inbox',
    assignee: taskData.assignee,
    role,
    created,
    priority: taskData.priority,
    body: taskData.body,
    filename,
  };

  await writeTaskFile(newTask);
  revalidatePath('/');
}

// ==========================================
// AGENTS.MD EDITOR ACTION WRAPPERS (TASK-0005)
// ==========================================

export async function updateAgentsMd(content: string): Promise<void> {
  await writeAgentsMd(content);
  revalidatePath('/');
}

export async function getAgentsHistory(): Promise<AgentsHistoryEntry[]> {
  return await listAgentsHistory();
}

export async function getHistoryVersion(filename: string): Promise<string> {
  return await readAgentsHistoryVersion(filename);
}

export async function updateTask(id: string, fields: {
  title?: string;
  priority?: 'low' | 'normal' | 'high';
  assignee?: string | null;
  body?: string;
}): Promise<void> {
  const tasks = await readAllTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) {
    throw new Error(`Task with id ${id} not found`);
  }

  let role = task.role;
  if (fields.assignee !== undefined) {
    const a = fields.assignee;
    if (a === 'codex' || a === 'claude-code' || a === 'cursor') {
      role = 'architect';
    } else if (a) {
      role = 'frontend';
    } else {
      role = null;
    }
  }

  const updated: Task = {
    ...task,
    title: fields.title ?? task.title,
    priority: fields.priority ?? task.priority,
    assignee: fields.assignee !== undefined ? fields.assignee : task.assignee,
    role,
    body: fields.body ?? task.body,
  };

  await writeTaskFile(updated);
  revalidatePath('/');
}

export async function deleteTask(id: string): Promise<void> {
  await deleteTaskFile(id);
  revalidatePath('/');
}

export async function bulkUpdateTaskStatus(ids: string[], status: TaskStatus): Promise<void> {
  for (const id of ids) {
    await updateTaskMetadata(id, { status });
  }
  revalidatePath('/');
}

export async function bulkDeleteTasks(ids: string[]): Promise<void> {
  for (const id of ids) {
    await deleteTaskFile(id);
  }
  revalidatePath('/');
}

export async function markHandled(ids: readonly string[]): Promise<void> {
  await markMentionsRead(ids);
  revalidatePath('/');
}

// ==========================================
// DRAFT SERVER ACTIONS
// ==========================================

export type DraftDTO = {
  id: string;
  title: string;
  body: string;
  priority: string;
  assignee: string | null;
  created_at: string;
  updated_at: string;
};

export async function listDrafts(): Promise<DraftDTO[]> {
  return draftList();
}

export async function getDraft(id: string): Promise<DraftDTO | null> {
  return draftGetById(id);
}

export async function createDraft(data: {
  title: string;
  body: string;
  priority: string;
  assignee: string | null;
}): Promise<DraftDTO> {
  const id = `draft_${Date.now()}`;
  draftCreate({ id, title: data.title, body: data.body, priority: data.priority, assignee: data.assignee });
  const created = draftGetById(id);
  if (!created) throw new Error('Failed to create draft');
  revalidatePath('/');
  return created;
}

export async function updateDraft(id: string, data: {
  title?: string;
  body?: string;
  priority?: string;
  assignee?: string | null;
}): Promise<void> {
  draftUpdate(id, data);
  revalidatePath('/');
}

export async function deleteDraft(id: string): Promise<void> {
  draftDelete(id);
  revalidatePath('/');
}
