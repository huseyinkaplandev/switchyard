import path from 'node:path';

/** Writer suffix identifies a persistence segment, not a different chat. */
export function codexRolloutId(filePath: string): string | undefined {
  return path.basename(filePath).match(/-([0-9a-f-]{36})(?:_[0-9a-f-]{36})?\.jsonl$/i)?.[1];
}

export function groupCodexRollouts<T extends { filePath: string; modified: number }>(files: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const id = codexRolloutId(file.filePath);
    if (!id) continue;
    const group = groups.get(id) || [];
    group.push(file); groups.set(id, group);
  }
  return [...groups.values()].map(group => group.sort((a, b) => a.modified - b.modified || a.filePath.localeCompare(b.filePath)));
}
