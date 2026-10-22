import { NextRequest, NextResponse } from 'next/server';
import { aiGenerate } from '@/app/_lib/ai';
import { SYSTEM_ENHANCE_TASK } from '@/app/_lib/prompts';

export interface EnhanceTaskResult {
  enhancedTitle: string;
  enhancedBody: string;
  changes: string[];
  summary: string;
}

export async function POST(req: NextRequest) {
  try {
    const { title, body } = await req.json();

    if (!body) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    const enhancePrompt = `Task title: ${title || '(no title)'}\n\nTask description:\n${body}\n\nImprove this task so AI agents understand it better, including the title.`;

    const result = await aiGenerate({
      system: SYSTEM_ENHANCE_TASK,
      prompt: enhancePrompt,
      temperature: 0.3,
      format: 'json',
      maxTokens: 1024,
    });

    let enhancement: EnhanceTaskResult;
    try {
      enhancement = JSON.parse(result.text);
    } catch {
      enhancement = {
        enhancedTitle: title || '',
        enhancedBody: body,
        changes: [],
        summary: 'The AI reply could not be parsed; the original body was kept.',
      };
    }

    return NextResponse.json({ originalTitle: title || '', originalBody: body, ...enhancement });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'AI enhancement failed' },
      { status: 500 },
    );
  }
}
