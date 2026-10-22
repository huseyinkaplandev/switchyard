import type { AgentArchiveMessage, AgentMessageKind } from './agentArchiveDb';

/** Preserve typed OpenCode parts instead of silently retaining only text. */
export function opencodeParts(part: Record<string, unknown>): Array<Pick<AgentArchiveMessage, 'text' | 'kind' | 'toolName' | 'isError'>> {
  if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') {
    return [{ text: part.text, kind: part.type === 'reasoning' ? 'thinking' : 'text' }];
  }
  if (part.type === 'compaction') return [{ text: JSON.stringify(part), kind: 'compaction' }];
  if (part.type === 'file') return [{ text: JSON.stringify(part), kind: 'attachment' }];
  if (part.type !== 'tool' || !part.state || typeof part.state !== 'object') return [];
  const state = part.state as Record<string, unknown>;
  const toolName = typeof part.tool === 'string' ? part.tool : 'tool';
  const result: Array<{text: string; kind: AgentMessageKind; toolName: string; isError?: boolean}> = [
    { text: JSON.stringify(state.input ?? {}, null, 2), kind: 'tool_use', toolName },
  ];
  if (state.output !== undefined || state.error !== undefined) result.push({
    text: typeof (state.error ?? state.output) === 'string' ? String(state.error ?? state.output) : JSON.stringify(state.error ?? state.output),
    kind: 'tool_result', toolName, isError: state.status === 'error' || state.error !== undefined,
  });
  return result;
}
