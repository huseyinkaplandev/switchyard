import { NextResponse } from 'next/server';
import { aiGenerate, AiInsight } from '@/app/_lib/ai';
import { SYSTEM_INSIGHTS } from '@/app/_lib/prompts';
import { readAllTasks } from '@/app/_lib/files';
import { readLog } from '@/app/_lib/files';

export const maxDuration = 30;

export async function GET() {
  try {
    const [tasks, logText] = await Promise.all([readAllTasks(), readLog()]);

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter(t => t.status === 'done').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
    const reviewTasks = tasks.filter(t => t.status === 'review').length;
    const inboxTasks = tasks.filter(t => t.status === 'inbox').length;

    const taskSummary = `Total: ${totalTasks} | Done: ${doneTasks} | In Progress: ${inProgressTasks} | Review: ${reviewTasks} | Inbox: ${inboxTasks}`;

    const taskDetails = tasks.map(t =>
      `[${t.id}] ${t.title} | status: ${t.status} | assignee: ${t.assignee || 'unassigned'} | priority: ${t.priority} | created: ${t.created}`
    ).join('\n');

    const recentLogs = logText.slice(-1500);

    const prompt = `### Task status\n${taskSummary}\n\n### Task details\n${taskDetails}\n\n### Recent logs\n${recentLogs}\n\nProduce useful insights from the data above.`;

    const result = await aiGenerate({
      system: SYSTEM_INSIGHTS,
      prompt,
      temperature: 0.3,
      format: 'json',
      maxTokens: 2048,
    });

    let insights: AiInsight[];
    try {
      insights = JSON.parse(result.text);
    } catch {
      insights = [{
        type: 'summary',
        title: 'AI Insight',
        content: taskSummary,
        severity: 'info',
      }];
    }

    return NextResponse.json({ insights, taskSummary });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Insights generation failed', insights: [], taskSummary: '' },
      { status: 200 },
    );
  }
}
