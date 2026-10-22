import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from './paths';
import { AGENTS } from './agents';
import { parseTask, Task } from './parseTask';
import {
  configGet, configSet,
  tasksGetAll, taskUpsert, taskGet, taskUpdate, taskDelete,
  historyInsert, historyGetAll, historyGetById, historyPrune,
  logInsert, logsGetLast,
  rolesGetAll, rolesReplaceAll,
  mentionsReadGetAll, mentionsReadAdd,
} from './db';

const DEFAULT_AGENTS_MD_CONTENT = `# AI Agents Specification

This document lists the active AI coding agents running on this system.

## Registered Agents
- **Codex** (OpenAI) - Lead Agent
- **Claude Code** (Anthropic)
- **Cursor** (Cursor)
- **VS Code** (Microsoft)
- **VS Code Insiders** (Microsoft)
- **OpenCode** (OpenCode)
- **Antigravity** (Google)
- **Kiro** (AWS)

## Mention protocol
To ask another agent or role for work, put \`@<slug>\` in a log line.
Example:
[2026-05-24 19:32] architect/codex: schema is ready, @frontend needs the type file
[2026-05-24 19:45] qa/vscode-insiders: @all the build is broken, hold on

Valid slugs: codex, claude-code, cursor, vscode, vscode-insiders,
opencode, antigravity, kiro, lead, architect, backend, frontend, reviewer,
qa, all
`;

export async function ensureDataDir(): Promise<void> {
  const dir = getDataDir();
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  }
}

export async function readAgentsMd(): Promise<string> {
  const fromDb = configGet('agents_md');
  if (fromDb) return fromDb;
  await ensureDataDir();
  const filePath = path.join(getDataDir(), 'AGENTS.md');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    configSet('agents_md', content);
    return content;
  } catch {
    configSet('agents_md', DEFAULT_AGENTS_MD_CONTENT);
    return DEFAULT_AGENTS_MD_CONTENT;
  }
}

const TAIL_BYTES = 100 * 1024;

export async function readLog(): Promise<string> {
  await ensureDataDir();
  const filePath = path.join(getDataDir(), 'LIVE_LOG.md');
  try {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return '';
    if (stat.size <= TAIL_BYTES) {
      return await fs.readFile(filePath, 'utf8');
    }
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(TAIL_BYTES);
      await fh.read(buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
      const text = buf.toString('utf8');
      const firstNewline = text.indexOf('\n');
      return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

export async function readLead(): Promise<string> {
  const fromDb = configGet('lead');
  if (fromDb) return fromDb;
  await ensureDataDir();
  const filePath = path.join(getDataDir(), 'LEAD.md');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const val = content.trim();
    configSet('lead', val);
    return val;
  } catch {
    configSet('lead', 'codex');
    return 'codex';
  }
}

export async function writeLead(agentId: string): Promise<void> {
  const validIds = AGENTS.map(a => a.id);
  if (!validIds.includes(agentId as any)) {
    throw new Error(`Invalid agentId: ${agentId}`);
  }
  configSet('lead', agentId);
  await ensureDataDir();
  await fs.writeFile(path.join(getDataDir(), 'LEAD.md'), agentId, 'utf-8');
}

export async function readAllTasks(): Promise<Task[]> {
  const rows = tasksGetAll();
  if (rows.length) return rows as Task[];
  await ensureDataDir();
  const dir = path.join(getDataDir(), 'tasks');
  try {
    const filenames = await fs.readdir(dir);
    for (const filename of filenames) {
      if (!filename.endsWith('.md')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, filename), 'utf-8');
        const parsed = parseTask(filename, raw);
        taskUpsert(parsed);
      } catch {}
    }
  } catch {}
  return tasksGetAll() as Task[];
}

export async function writeTaskFile(task: Task): Promise<void> {
  const filename = task.filename || generateFilenameFromTask(task);
  taskUpsert({ ...task, filename });
  await ensureDataDir();
  const dir = path.join(getDataDir(), 'tasks');
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = `---
id: ${task.id}
title: ${task.title}
status: ${task.status}
assignee: ${task.assignee || 'null'}
role: ${task.role || 'null'}
created: ${task.created}
priority: ${task.priority}
---`;
  await fs.writeFile(path.join(dir, filename), `${frontmatter}\n\n${task.body}`, 'utf-8');
}

function generateFilenameFromTask(task: Pick<Task, 'id' | 'title'>): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `${task.id}-${slug}.md`;
}

export async function deleteTaskFile(id: string): Promise<void> {
  const existing = taskGet(id);
  if (!existing) throw new Error(`Task with id ${id} not found`);
  taskDelete(id);
  const dir = path.join(getDataDir(), 'tasks');
  try {
    await fs.unlink(path.join(dir, existing.filename!));
  } catch {
    // file might already be deleted, that's fine
  }
}

export async function updateTaskMetadata(id: string, fields: Partial<Omit<Task, 'id' | 'filename' | 'body' | 'title'>>): Promise<void> {
  const existing = taskGet(id);
  if (!existing) throw new Error(`Task with id ${id} not found`);
  await writeTaskFile({ ...existing, ...fields } as Task);
}

export async function getNextTaskId(): Promise<string> {
  const tasks = await readAllTasks();
  let maxId = 0;
  for (const t of tasks) {
    const match = t.id.match(/^TASK-(\d{4})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  return `TASK-${String(maxId + 1).padStart(4, '0')}`;
}

export type AgentsHistoryEntry = Readonly<{
  filename: string;
  ts: Date;
  size: number;
  firstLine: string;
}>;

function getHistoryISOString(): string {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD}T${HH}-${mm}-${ss}`;
}

export async function writeAgentsMd(content: string): Promise<void> {
  const currentContent = await readAgentsMd();
  if (currentContent === content) return;

  configSet('agents_md', content);

  const tsStr = getHistoryISOString();
  historyInsert(tsStr, `AGENTS-${tsStr}.md`, currentContent);
  historyPrune(20);

  await ensureDataDir();
  await fs.writeFile(path.join(getDataDir(), 'AGENTS.md'), content, 'utf-8');
  const historyDir = path.join(getDataDir(), '.history');
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(path.join(historyDir, `AGENTS-${tsStr}.md`), currentContent, 'utf-8');
  try {
    const files = await fs.readdir(historyDir);
    const backupFiles = files.filter(f => f.startsWith('AGENTS-') && f.endsWith('.md')).sort();
    if (backupFiles.length > 20) {
      for (const f of backupFiles.slice(0, backupFiles.length - 20)) {
        await fs.unlink(path.join(historyDir, f)).catch(() => {});
      }
    }
  } catch {}
}

export async function listAgentsHistory(): Promise<AgentsHistoryEntry[]> {
  const entries = historyGetAll();
  return entries.map(e => ({
    filename: e.filename,
    ts: new Date(e.ts),
    size: e.content.length,
    firstLine: e.content.split(/\r?\n/)[0] || '',
  }));
}

export async function readAgentsHistoryVersion(filename: string): Promise<string> {
  const entry = historyGetAll().find(e => e.filename === filename);
  if (entry) return entry.content;
  const historyDir = path.join(getDataDir(), '.history');
  return await fs.readFile(path.join(historyDir, filename), 'utf-8');
}
