import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from './paths';
import { mentionsReadGetAll, mentionsReadAdd } from './db';

export async function readMentionsRead(): Promise<Set<string>> {
  const fromDb = mentionsReadGetAll();
  if (fromDb.size) return fromDb;

  // Migrate from file
  const filePath = path.join(getDataDir(), 'mentions-read.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      mentionsReadAdd(parsed);
      return new Set<string>(parsed);
    }
  } catch {}
  return new Set<string>();
}

export async function markMentionsRead(ids: readonly string[]): Promise<void> {
  const existing = mentionsReadGetAll();
  const newIds = ids.filter(id => !existing.has(id));
  if (!newIds.length) return;

  let allIds = [...existing, ...newIds];
  if (allIds.length > 5000) {
    console.warn(`[markMentionsRead Warning] mentions-read pool size exceeded 5000. Trimming oldest 2500 entries.`);
    allIds = allIds.slice(-2500);
  }

  mentionsReadAdd(newIds);

  try {
    await fs.mkdir(getDataDir(), { recursive: true });
    await fs.writeFile(path.join(getDataDir(), 'mentions-read.json'), JSON.stringify(allIds, null, 2), 'utf-8');
  } catch {}
}

export async function markMentionRead(id: string): Promise<void> {
  await markMentionsRead([id]);
}
