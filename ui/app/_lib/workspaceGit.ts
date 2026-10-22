import { exec } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { WorkspaceGitState } from './handoff';

const run = promisify(exec);

/**
 * Code was the most often missing part of a handoff: the receiving agent
 * cannot continue without knowing the branch, the HEAD and what is in the
 * working tree. This is a snapshot from when the handoff was produced; the
 * handoff text marks it as "may be stale".
 */
export async function readWorkspaceGitState(cwd: string): Promise<WorkspaceGitState> {
  if (!cwd || !fs.existsSync(cwd)) return { available: false, error: 'directory not found' };
  const options = { cwd, timeout: 5000, maxBuffer: 1024 * 1024 } as const;
  try {
    await run('git rev-parse --is-inside-work-tree', options);
  } catch {
    return { available: false, error: 'not a git repository' };
  }
  /* `trim: false` is required for porcelain: its XY status field is two
     characters, and a deleted file arrives with a LEADING space, as in " D path".
     Trimming the whole output removes only the FIRST line's leading space,
     shifting that line by one character and breaking path parsing. */
  const read = async (command: string, trim = true) => {
    try {
      const { stdout } = await run(command, options);
      return trim ? stdout.trim() : stdout.replace(/\n+$/, '');
    } catch {
      return '';
    }
  };
  const [branch, head, headSubject, porcelain, log] = await Promise.all([
    read('git rev-parse --abbrev-ref HEAD'),
    read('git rev-parse --short HEAD'),
    read('git log -1 --format=%s'),
    read('git status --porcelain', false),
    read('git log --oneline -8'),
  ]);
  const statusLines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const untracked = statusLines.filter((line) => line.startsWith('??'));
  const tracked = statusLines.filter((line) => !line.startsWith('??'));
  return {
    available: true,
    branch,
    head,
    headSubject,
    dirtyCount: tracked.length,
    untrackedCount: untracked.length,
    untrackedFiles: untracked.map(line => line.slice(3)),
    /* Truncation happens on the handoff side, not here: it folds by
       directory first. Truncating here would make the fold report low counts. */
    dirtyFiles: tracked,
    recentCommits: log ? log.split('\n').filter(Boolean) : [],
  };
}
