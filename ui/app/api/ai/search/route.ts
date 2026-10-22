import { NextRequest, NextResponse } from 'next/server';
import { aiGenerate, AiSearchResult } from '@/app/_lib/ai';
import { SYSTEM_SEARCH } from '@/app/_lib/prompts';
import { readAllTasks } from '@/app/_lib/files';

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const tasks = await readAllTasks();
    const taskList = tasks.map(t =>
      `[${t.id}] ${t.title} | status: ${t.status} | assignee: ${t.assignee || 'unassigned'} | priority: ${t.priority} | body: ${t.body.slice(0, 300)}`
    ).join('\n');

    // Truncate task list for faster processing
    const shortList = taskList.length > 2000 ? taskList.slice(0, 2000) + '\n... (truncated)' : taskList;
    const prompt = `User query: "${query}"\n\nTasks:\n${shortList}\n\nFind and score the tasks related to this query. Return only a JSON array.`;

    const result = await aiGenerate({
      system: SYSTEM_SEARCH,
      prompt,
      temperature: 0.2,
      format: 'json',
    });

    let results: AiSearchResult[];
    try {
      const parsed = JSON.parse(result.text);
      // Normalize: AI might return single object or array
      if (Array.isArray(parsed)) {
        results = parsed;
      } else if (parsed.taskId && parsed.score) {
        results = [parsed];
      } else if (parsed.results && Array.isArray(parsed.results)) {
        results = parsed.results;
      } else {
        results = [];
      }
    } catch {
      results = [];
    }

    // Fallback: keyword search if AI fails
    if (results.length === 0) {
      const q = query.toLowerCase();
      results = tasks
        .filter(t => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
        .map(t => ({
          taskId: t.id,
          score: 0.5,
          reason: 'Keyword match',
        }));
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, results: [] },
      { status: 200 },
    );
  }
}
