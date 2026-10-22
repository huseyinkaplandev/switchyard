import { fromThreadMessageLike } from '@assistant-ui/react';
export function assistantMessage({ id, role, text, timestamp, live }: { id: string; role: string; text: string; timestamp?: string; live?: boolean }) {
  return fromThreadMessageLike({ id, role: role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant', content: [{ type: 'text', text }],
    ...(timestamp && Number.isFinite(Date.parse(timestamp)) ? { createdAt: new Date(timestamp) } : {}),
    ...(role !== 'user' && role !== 'system' ? { status: live ? { type: 'running' as const } : { type: 'complete' as const, reason: 'stop' as const } } : {}),
    metadata: { custom: { originalRole: role } },
  }, id, { type: 'complete', reason: 'stop' });
}
