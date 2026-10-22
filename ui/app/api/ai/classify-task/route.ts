import { NextRequest, NextResponse } from 'next/server';
import { aiGenerate, AiClassifyResult } from '@/app/_lib/ai';
import { SYSTEM_CLASSIFY, SYSTEM_DONE_CHECK } from '@/app/_lib/prompts';
import { readAllTasks } from '@/app/_lib/files';
import { readLog } from '@/app/_lib/files';

export async function POST(req: NextRequest) {
  try {
    const { title, body, taskId } = await req.json();

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const classifyPrompt = `Task title: ${title}\nTask description: ${body || '(no description)'}\n\nSuggest a priority, an assignee and a role for this task.`;

    const result = await aiGenerate({
      system: SYSTEM_CLASSIFY,
      prompt: classifyPrompt,
      temperature: 0.2,
      format: 'json',
    });

    let classification: AiClassifyResult;
    try {
      classification = JSON.parse(result.text);
    } catch {
      // fallback
      classification = {
        priority: 'normal',
        suggestedAssignee: null,
        suggestedRole: null,
        reason: 'The AI reply could not be parsed; default values were used.',
      };
    }

    // If taskId provided, also check if done
    let doneCheck = null;
    if (taskId) {
      try {
        const [tasks, logText] = await Promise.all([readAllTasks(), readLog()]);
        const task = tasks.find(t => t.id === taskId);
        if (task) {
          const donePrompt = `Task ID: ${taskId}\nTitle: ${task.title}\nDescription: ${task.body}\n\nRecent logs:\n${logText.slice(-2000)}\n\nIs this task finished?`;
          const doneResult = await aiGenerate({
            system: SYSTEM_DONE_CHECK,
            prompt: donePrompt,
            temperature: 0.2,
            format: 'json',
          });
          doneCheck = JSON.parse(doneResult.text);
        }
      } catch {
        // non-critical
      }
    }

    return NextResponse.json({ classification, doneCheck });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'AI classification failed' },
      { status: 500 },
    );
  }
}
