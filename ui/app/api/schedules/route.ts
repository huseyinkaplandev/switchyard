import { NextRequest, NextResponse } from 'next/server';
import { copyClaudeTasksToCodex, claudeSyncStatus, DemoModeError, getActiveClaudeAccount, installClaudeTasks, listScheduledTasks, saveAllSkills, monitorClaudeAccountChanges, setScheduledTaskEnabled } from '@/app/_lib/schedules';
import { isDemoMode } from '@/app/_lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const autoMigration = await monitorClaudeAccountChanges();
    const [tasks, activeClaudeAccount, claudeSync] = await Promise.all([listScheduledTasks(), getActiveClaudeAccount(), claudeSyncStatus()]);
    return NextResponse.json({ tasks, activeClaudeAccount, autoMigration, claudeSync, demo: isDemoMode(), platform: process.platform === 'darwin' ? 'macos' : 'windows' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 });
  }
  try {
    const input = await request.json();
    if (input.action === 'copy-to-codex') {
      if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some((id: unknown) => typeof id !== 'string'))) {
        return NextResponse.json({ error: 'Invalid task ids' }, { status: 400 });
      }
      return NextResponse.json(await copyClaudeTasksToCodex(input.ids));
    }

    if (input.action === 'save-skills') {
      return NextResponse.json(await saveAllSkills());
    }
    if (input.action !== 'install') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    return NextResponse.json(await installClaudeTasks());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Migration failed', demo: error instanceof DemoModeError }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 });
  }
  try {
    const input = await request.json();
    if (!['codex', 'claude', 'antigravity'].includes(input.source) || typeof input.id !== 'string'
      || typeof input.account !== 'string' || typeof input.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    await setScheduledTaskEnabled(input.source, input.account, input.id, input.enabled);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 400 });
  }
}
