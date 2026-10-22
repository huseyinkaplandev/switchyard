import 'server-only';
import crypto from 'node:crypto';
import path from 'node:path';
import { listAgentThreads, readNativeHandoffSource, codexIndex } from '../agentArchive';
import { listLocalSessions, locateLocalSession } from '../sessions';
import fs from 'node:fs/promises';
import { archiveActivityMessages } from '../agentArchiveDb';
import { summarizeActivity } from './activity';
import { classifyDesktop, readClaudeDesktopMetadata } from './claudeMetadata';
import type { HandoffCandidate } from './types';
import { claudeDesktopDir, getDataDir, secondaryMacHome } from '../paths';

const remoteActivity = new Map<string, { revision: string; summary: ReturnType<typeof summarizeActivity> }>();

async function collectHandoffCatalog() {
  const codexTitles = await codexIndex();
  const macHome = secondaryMacHome();
  const macTitles = macHome ? await codexIndex(path.join(macHome,'.codex')) : new Map<string,string>();
  const local = await readClaudeDesktopMetadata(path.join(claudeDesktopDir(), 'claude-code-sessions'));
  const mac = macHome ? await readClaudeDesktopMetadata(path.join(macHome, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'), 'macos') : null;
  const warnings = [...local.warnings, ...(mac?.warnings ?? [])];
  const candidates: HandoffCandidate[] = [];
  for (const thread of listAgentThreads()) {
    if (thread.provider !== 'claude-code' && thread.provider !== 'codex') continue;
    const sources = thread.provider === 'claude-code' ? [...(local.map.get(thread.id) ?? []), ...(mac?.map.get(thread.id) ?? [])] : [];
    for (const metadata of sources.length ? sources : [null]) {
      const platform = metadata?.platform ?? (thread.cwd.startsWith('/') ? 'macos' : 'windows');
      const key = crypto.createHash('sha256').update(JSON.stringify([thread.provider, thread.id, platform, metadata?.account ?? null, metadata?.desktopId ?? null])).digest('hex');
      candidates.push({ key, sourceId: thread.id, desktopId: metadata?.desktopId ?? null, currentSourceId: metadata?.nativeId, provider: thread.provider, platform, sourceAccount: metadata?.account ?? null, projectRoot: metadata?.projectRoot || thread.cwd, cwd: metadata?.cwd || thread.cwd, title: metadata ? metadata.title : thread.provider==='codex' ? codexTitles.get(thread.id) ?? '' : '', chatType: classifyDesktop(metadata), scheduledTaskId: metadata?.scheduledTaskId ?? null, archived: metadata?.archived ?? thread.archived, sourceAvailable: Boolean(thread.sourceAvailable), ...summarizeActivity(archiveActivityMessages(thread.id)) });
    }
  }
  if (macHome) for (const session of await listLocalSessions()) {
    if (session.platform !== 'macos' || !['claude','codex'].includes(session.source)) continue;
    const located = await locateLocalSession(session.id); if (!located) continue;
    const stat = await fs.stat(located.file).catch(() => null); if (!stat) continue;
    const provider = session.source === 'claude' ? 'claude-code' : 'codex';
    const nativeId = path.basename(located.file).match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ?? '';
    const sources = mac?.map.get(nativeId) ?? [];
    let cached = remoteActivity.get(session.id); const revision = `${stat.size}:${stat.mtimeMs}`;
    let parsed: Awaited<ReturnType<typeof readNativeHandoffSource>> | null = null;
    if (cached?.revision !== revision) {
      parsed = await readNativeHandoffSource(located.file, provider);
      if (!parsed) continue;
      cached = { revision, summary: summarizeActivity(parsed.messages) }; remoteActivity.set(session.id, cached);
    }
    for (const metadata of sources.length ? sources : [null]) {
      if (!parsed && !metadata) parsed = await readNativeHandoffSource(located.file, provider);
      const cwd = metadata?.cwd ?? parsed?.thread.cwd ?? '';
      const key = crypto.createHash('sha256').update(JSON.stringify([provider, session.id, 'macos', metadata?.account ?? null])).digest('hex');
      candidates.push({ key, sourceId: session.id, desktopId: metadata?.desktopId ?? null, currentSourceId: metadata?.nativeId, provider, platform: 'macos', sourceAccount: metadata?.account ?? null, projectRoot: metadata?.projectRoot ?? cwd, cwd, title: metadata?.title ?? (provider==='codex' ? macTitles.get(nativeId) ?? '' : ''), chatType: classifyDesktop(metadata), scheduledTaskId: metadata?.scheduledTaskId ?? null, archived: session.archived, sourceAvailable: true, ...cached!.summary });
    }
  }
  const accountLabels: Record<string,string> = {};
  try {
    const saved=JSON.parse((await fs.readFile(path.join(getDataDir(),'desktop-account-labels.json'),'utf8')).replace(/^\uFEFF/,''));
    const knownAccounts=new Set(candidates.filter(c=>c.provider==='claude-code').map(c=>c.sourceAccount));
    for(const [account,email] of Object.entries(saved)) {
      if(knownAccounts.has(account)&&typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))accountLabels[account]=email;
    }
  } catch { /* Display aliases are optional; native account identity remains authoritative. */ }
  return { candidates: candidates.sort((a,b) => (b.activityAt ?? '').localeCompare(a.activityAt ?? '')), warnings, accountLabels };
}

let pending: ReturnType<typeof collectHandoffCatalog> | null = null;
let cache: Awaited<ReturnType<typeof collectHandoffCatalog>> | null = null;
let cacheAt=0;
export async function getHandoffCatalog(fresh=false) {
  if (!fresh && cache && Date.now()-cacheAt<2500) return cache;
  if (pending) return pending;
  pending=collectHandoffCatalog().then(result=>{cache=result;cacheAt=Date.now();return result;}).finally(()=>{pending=null;});
  return pending;
}
