import { NextResponse } from 'next/server';
import { aiGenerate } from '@/app/_lib/ai';
import { SYSTEM_DAILY_REPORT } from '@/app/_lib/prompts';
import { readAllTasks, readLog } from '@/app/_lib/files';
import { AGENTS } from '@/app/_lib/agents';

export const maxDuration = 30;

export async function GET() {
  try {
    const [tasks, logText] = await Promise.all([readAllTasks(), readLog()]);

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const doneToday = tasks.filter(t => t.status === 'done');
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const inReview = tasks.filter(t => t.status === 'review');
    const inbox = tasks.filter(t => t.status === 'inbox');

    const agentActivity = AGENTS.map(a => {
      const assigned = tasks.filter(t => t.assignee === a.id);
      const doneCount = assigned.filter(t => t.status === 'done').length;
      return `- ${a.id}: ${assigned.length} task, ${doneCount} done`;
    }).join('\n');

    const prompt = `Date: ${today}

Tasks: ${tasks.length} total
Done: ${doneToday.length} | In Progress: ${inProgress.length} | Review: ${inReview.length} | Inbox: ${inbox.length}

Agents: ${agentActivity}

Recent log: ${logText.slice(-1000)}

Write the daily report. Keep it short.`;

    const result = await aiGenerate({
      system: SYSTEM_DAILY_REPORT,
      prompt,
      temperature: 0.3,
      maxTokens: 1024,
    });

    return NextResponse.json({
      date: today,
      report: result.text,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, report: '' },
      { status: 200 },
    );
  }
}
