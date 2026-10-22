import { NextRequest } from 'next/server';
import { aiStreamGenerate } from '@/app/_lib/ai';
import { SYSTEM_CHAT } from '@/app/_lib/prompts';
import { readAllTasks } from '@/app/_lib/files';
import { readLog } from '@/app/_lib/files';
import { AGENTS } from '@/app/_lib/agents';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [tasks, logText] = await Promise.all([readAllTasks(), readLog()]);

    const agentList = AGENTS.map(a => `${a.id}`).join(', ');
    const taskSummary = tasks.map(t =>
      `[${t.id}] "${t.title}" | ${t.status} | ${t.assignee || 'none'} | ${t.priority}`
    ).join('\n');
    const recentLogs = logText.slice(-1500);

    const context = `Agents: ${agentList}\n\nTasks:\n${taskSummary}\n\nLogs:\n${recentLogs}`;

    const prompt = `${context}\n\nUser question: ${message}\n\nAnswer:`;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullResponse = '';
          await aiStreamGenerate(
            {
              system: SYSTEM_CHAT,
              prompt,
              temperature: 0.3,
              maxTokens: 1024,
            },
            (token) => {
              fullResponse += token;
              controller.enqueue(encoder.encode(token));
            },
          );
          controller.close();
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n\n_(AI connection error: ${err.message})_`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
