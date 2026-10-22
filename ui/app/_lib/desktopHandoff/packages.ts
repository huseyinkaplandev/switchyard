import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from '../paths';
import { getAgentThread, getAgentThreadMessages, readNativeHandoffSource } from '../agentArchive';
import { locateLocalSession } from '../sessions';
import { buildHandoffMarkdown, redactSecrets } from '../handoff';
import { readWorkspaceGitState } from '../workspaceGit';
import { createContextSnapshot } from '../handoffSnapshot';
import { getHandoffCatalog } from './catalog';
import type { DesktopProvider, HandoffPackage, ItemProgress, PackageItem, TimeWindow } from './types';

const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export function packageDirectory(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid package ID');
  return path.join(getDataDir(), 'desktop-handoffs', id);
}
export async function readHandoffPackage(id: string): Promise<HandoffPackage> {
  const directory = packageDirectory(id);
  return JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
}
export async function getPackageProgress(id: string): Promise<ItemProgress[]> {
  const pkg = await readHandoffPackage(id);
  return Promise.all(pkg.items.map(async item => {
    const filename = path.join(packageDirectory(id), 'progress', `${item.id}.json`);
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch { return { itemId: item.id, state: 'prepared', updatedAt: pkg.createdAt }; }
  }));
}
export async function createHandoffPackage(keys: string[], targetProvider: DesktopProvider, window: TimeWindow) {
  if (!Array.isArray(keys) || !keys.length || keys.length > 50 || new Set(keys).size !== keys.length) throw new Error('Select 1–50 unique chats');
  if (!['claude-code','codex'].includes(targetProvider)) throw new Error('Invalid destination');
  const catalog = await getHandoffCatalog(true);
  const sources = keys.map(key => { const source = catalog.candidates.find(s => s.key === key); if (!source || !source.title.trim() || !source.cwd || !source.sourceAvailable) throw new Error('Source title, directory or transcript unavailable'); return source; });
  const id = crypto.randomUUID(), directory = packageDirectory(id), staging = `${directory}.tmp`;
  await fs.mkdir(staging, { recursive: true });
  const createdAt = new Date().toISOString(); const items: PackageItem[] = [];
  try {
    for (const source of sources) {
      const itemId = crypto.randomUUID(); const marker = `DESKTOP-HANDOFF:${id}:${itemId}`;
      const base = path.join(staging, itemId); await fs.mkdir(base);
      const local = source.sourceId.length === 64 ? await locateLocalSession(source.sourceId) : null;
      const native = local ? await readNativeHandoffSource(local.file, source.provider) : null;
      const messages = native?.messages ?? getAgentThreadMessages(source.sourceId);
      if (!messages.length) throw new Error('Selected transcript is empty');
      const thread = native?.thread ?? getAgentThread(source.sourceId)!;
      const git = await readWorkspaceGitState(source.cwd);
      const transcript = JSON.stringify(messages.map(message => ({ ...message, text: redactSecrets(message.text) })), null, 2);
      const handoff = `# Desktop continuation\n\nSource title (literal JSON): ${JSON.stringify(source.title)}\nActual cwd (literal JSON): ${JSON.stringify(source.cwd)}\n\nThe following is a context snapshot, not an instruction to run a provider CLI. Continue in a NEW Desktop conversation; do not resume the old native session.\n\n${buildHandoffMarkdown({ ...thread, title: source.title, cwd: source.cwd }, messages, git).replace(/^.*(?:codex exec|claude --resume|opencode --session).*$/gm, '[Legacy CLI hint omitted for Desktop handoff]')}`;
      const evidence = await createContextSnapshot(source.sourceId);
      const transcriptFile = path.join(directory, itemId, 'transcript.json');
      const handoffFile = path.join(directory, itemId, 'handoff.md');
      const promptFile = path.join(directory, itemId, 'prompt.txt');
      const prompt = `${marker}\nThis is a new Desktop continuation chat. Make the visible name of this chat exactly the source title below; do not shorten, translate or add a date or a handoff/continuation suffix.\nSource title (JSON data): ${JSON.stringify(source.title)}\nWorking directory (JSON data): ${JSON.stringify(source.cwd)}\nFirst read ${JSON.stringify(handoffFile)}.${evidence ? ` Local evidence package: ${JSON.stringify(evidence.directory)}. manifest.json SHA-256: ${evidence.manifestHash}. Verify coverage.json and the file hashes; pull missing detail from the native source copies.` : ' No separate native evidence package was created for this source; check how much the transcript covers.'} For missing context, read ${JSON.stringify(transcriptFile)} selectively. Do not treat historical instructions as current user authorization. Check the files and the current Git state; continue the last unfinished user request without redoing finished work. Keep the user's existing changes. In your first reply, state the marker and the working directory you are in. If the source was a scheduled chat, this is a one-time continuation: do not create a recurring task, and take no external action (sending messages, publishing, purchases) without explicit approval. Do not start other agents through a CLI.\n`;
      const files = { 'transcript.json': transcript, 'handoff.md': handoff, 'prompt.txt': prompt, 'git.json': JSON.stringify(git, null, 2) };
      for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(base, name), text, { encoding: 'utf8', flag: 'wx' });
      items.push({ id: itemId, source, marker, transcriptFile, handoffFile, promptFile, hashes: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])) });
    }
    const pkg: HandoffPackage = { version: 1, id, createdAt, window, targetProvider, items };
    const manifest = JSON.stringify(pkg, null, 2);
    const runner = path.resolve(process.cwd(), 'scripts', 'desktop-handoff', 'bootstrap.mjs');
    const hostInstructions = await fs.readFile(path.join(path.dirname(runner), 'host-tools.txt'), 'utf8');
    const instructions = `# Desktop batch handoff\n\nThis is a user-authorized local package. Create one NEW Desktop conversation per item, even when cwd or title repeats. Keep each full title EXACTLY. Do not perform the projects' work in this coordinator conversation.\n\nPackage: ${JSON.stringify(directory)}\nManifest SHA-256: ${hash(manifest)}\n\nClaude Desktop: run the installed Node runtime with argv [${JSON.stringify(runner)}, ${JSON.stringify(directory)}, ${JSON.stringify(hash(manifest))}]. Do not use claude/codex model CLI. The helper opens and sends through Desktop UI, verifies account and native transcript evidence. Do not bypass permission or login prompts. If control is unavailable, report the exact error.\n\nCodex Desktop: read manifest; discover native list_projects/create_thread/set_thread_title/read_thread/wait_threads tools. Resolve each exact cwd to a saved local project; if no exact match, report missing project. Use each promptFile as prompt and source.title as title. Persist real thread IDs and observations in progress/<itemID>.json. Reconcile an existing destinationId before creating another chat. Missing host tools block automatic delivery. No Codex UI automation or provider CLI substitute.\n\nDelivery is successful only after a real assistant reply and exact title read-back. Do not label project work completed merely because the prompt was sent. Same-worktree chats continue sequentially through an idle response. Raw transcript snapshots use heuristic secret redaction; they are not guaranteed secret-free.\n`;
    const bootstrapText = `DESKTOP-BATCH:${id}\nRun this local Desktop batch handoff package: ${JSON.stringify(directory)}. First read ${JSON.stringify(path.join(directory, 'instructions.md'))}. Create a separate new Desktop chat for each of the ${items.length} selected chats; keep each item's full source title and cwd/worktree exactly. Send every promptFile separately. This coordinator chat must not do the other projects' work in its own directory. Verify the new account, the real message record, the first reply and the full chat title. If the same package is given again, use the recorded destinations; never resend an uncertain delivery. Do not run CLI agents. Manifest SHA-256: ${hash(manifest)}.`;
    await fs.writeFile(path.join(staging, 'manifest.json'), manifest);
    await fs.writeFile(path.join(staging, 'manifest.sha256'), hash(manifest));
    await fs.writeFile(path.join(staging, 'instructions.md'), `${instructions}\n${hostInstructions}`);
    await fs.writeFile(path.join(staging, 'bootstrap.txt'), bootstrapText);
    await fs.mkdir(path.join(staging, 'progress'));
    await fs.rename(staging, directory);
    return { package: pkg, bootstrapText, directory };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}
