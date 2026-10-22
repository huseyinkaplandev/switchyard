import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatType, SourcePlatform } from './types';

export type DesktopSource = { desktopId: string; nativeId: string; account: string; title: string; cwd: string; projectRoot: string; scheduledTaskId: string | null; archived: boolean; platform: SourcePlatform };
export function classifyDesktop(source: DesktopSource | null): ChatType { return !source ? 'unknown' : source.scheduledTaskId ? 'scheduled' : 'normal'; }
export async function readClaudeDesktopMetadata(root: string, platform: SourcePlatform = process.platform === 'win32' ? 'windows' : 'macos') {
  const map = new Map<string, DesktopSource[]>(); const warnings: string[] = [];
  async function dirs(dir: string) { return (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter(x => x.isDirectory() && !x.isSymbolicLink()); }
  for (const account of await dirs(root)) for (const org of await dirs(path.join(root, account.name))) {
    const directory = path.join(root, account.name, org.name);
    for (const file of await fs.readdir(directory).catch(() => [])) {
      if (!/^local_[\w-]+\.json$/.test(file)) continue;
      try {
        const raw = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
        if (typeof raw.cliSessionId !== 'string' || typeof raw.sessionId !== 'string' || typeof raw.cwd !== 'string') throw new Error('Invalid metadata');
        const entry: DesktopSource = { desktopId: raw.sessionId, nativeId: raw.cliSessionId, account: `${account.name}/${org.name}`, title: typeof raw.title === 'string' ? raw.title : '', cwd: raw.cwd, projectRoot: typeof raw.originCwd === 'string' ? raw.originCwd : raw.cwd, scheduledTaskId: typeof raw.scheduledTaskId === 'string' && raw.scheduledTaskId ? raw.scheduledTaskId : null, archived: Boolean(raw.isArchived), platform };
        const ids = new Set([entry.nativeId, ...(Array.isArray(raw.priorCliSessionIds) ? raw.priorCliSessionIds.filter((id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) : [])]);
        for (const id of ids) map.set(id, [...(map.get(id) ?? []), entry]);
      } catch { warnings.push(`Unreadable Desktop metadata: ${file}`); }
    }
  }
  return { map, warnings };
}
