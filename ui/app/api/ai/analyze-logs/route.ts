import { NextResponse } from 'next/server';
import { aiGenerate } from '@/app/_lib/ai';
import { SYSTEM_AUTO_PROGRESS } from '@/app/_lib/prompts';
import { readAllTasks, readLog, updateTaskMetadata } from '@/app/_lib/files';
import { revalidatePath } from 'next/cache';
import { TaskStatus } from '@/app/_lib/parseTask';

export const maxDuration = 30;

export async function POST() {
  try {
    const [tasks, logText] = await Promise.all([readAllTasks(), readLog()]);

    const taskDetails = tasks
      .filter(t => t.status !== 'done')
      .map(t =>
        `[${t.id}] ${t.title} | status: ${t.status} | assignee: ${t.assignee || 'unassigned'}`
      )
      .join('\n');

    const recentLogs = logText.slice(-4000);

    const prompt = `### Active tasks\n${taskDetails || '(no tasks other than done ones)'}\n\n### Recent logs\n${recentLogs}\n\nWhich task statuses should change according to the logs?`;

    const result = await aiGenerate({
      system: SYSTEM_AUTO_PROGRESS,
      prompt,
      temperature: 0.2,
      format: 'json',
      maxTokens: 2048,
    });

    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return NextResponse.json({ updates: [], summary: 'The AI reply could not be parsed', mode: 'suggest' });
    }

    const updates = (parsed.updates || []) as Array<{
      taskId: string;
      suggestedStatus: string;
      confidence: number;
      reason: string;
    }>;

    const mode = process.env.AI_AUTO_APPLY === 'true' ? 'auto' : 'suggest';

    if (mode === 'auto') {
      const validStatuses = new Set<TaskStatus>(['inbox', 'in_progress', 'review', 'done']);
      for (const update of updates) {
        if (update.confidence >= 0.8 && validStatuses.has(update.suggestedStatus as TaskStatus)) {
          try {
            await updateTaskMetadata(update.taskId, { status: update.suggestedStatus as TaskStatus });
          } catch {
            // task might not exist
          }
        }
      }
    }

    return NextResponse.json({
      updates,
      summary: parsed.summary || '',
      mode,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, updates: [], summary: '', mode: 'suggest' },
      { status: 200 },
    );
  }
}
