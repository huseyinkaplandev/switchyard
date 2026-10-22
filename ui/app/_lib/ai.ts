import 'server-only';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

export type AiModel = 'qwen2.5:3b' | 'qwen2.5:1.5b' | 'qwen3.5:9b';

export interface AiGenerateOpts {
  model?: AiModel;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  format?: 'json';
}

export interface AiGenerateResult {
  text: string;
  model: string;
  done: boolean;
}

export async function aiGenerate(opts: AiGenerateOpts): Promise<AiGenerateResult> {
  const { model = DEFAULT_MODEL as AiModel, system, prompt, temperature = 0.3, maxTokens = 512, format } = opts;

  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  };

  if (system) body.system = system;
  if (format === 'json') body.format = 'json';

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Ollama API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // Qwen models output thinking in a separate field; fallback to thinking when response is empty
  let responseText = (data.response || '').trim();
  const thinkingText = (data.thinking || '').trim();
  let text = responseText || thinkingText;

  // Clean up thinking boilerplate for better UX
  text = cleanThinkingOutput(text);

  return {
    text,
    model: data.model || model,
    done: !!data.done,
  };
}

export async function aiStreamGenerate(
  opts: AiGenerateOpts,
  onToken: (token: string) => void,
): Promise<string> {
  const { model = DEFAULT_MODEL as AiModel, system, prompt, temperature = 0.3, maxTokens = 512 } = opts;

  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: true,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  };

  if (system) body.system = system;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown error');
    throw new Error(`Ollama stream error (${res.status}): ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const token = (parsed.response || parsed.thinking || '').trim();
        if (token) {
          fullResponse += token;
          onToken(token);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return fullResponse;
}

export interface AiClassifyResult {
  priority: 'low' | 'normal' | 'high';
  suggestedAssignee: string | null;
  suggestedRole: string | null;
  reason: string;
}

export interface AiInsight {
  type: 'stuck_tasks' | 'top_agents' | 'velocity' | 'mention_hotspot' | 'summary';
  title: string;
  content: string;
  severity?: 'info' | 'warn' | 'alert';
  relatedTaskIds?: string[];
}

export interface AiSearchResult {
  taskId: string;
  score: number;
  reason: string;
}

export interface AiDoneCheck {
  isDone: boolean;
  confidence: number;
  reason: string;
}

/** Strip thinking-process boilerplate from Qwen model output */
function cleanThinkingOutput(text: string): string {
  if (!text) return text;
  // If text is valid JSON, don't clean it
  try { JSON.parse(text); return text; } catch {}
  // If no thinking prefix, return as-is
  if (!text.match(/Thinking\s*(Process|pattern|)/i)) return text;
  // Remove thinking prefix and return cleaned content
  let cleaned = text.replace(/^[\s\S]*?Thinking\s*(?:Process|pattern|):?\s*/i, '').trim();
  return cleaned || text;
}
