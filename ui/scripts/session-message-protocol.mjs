export function invocation(provider, nativeId, message, images = []) {
  if (provider === 'codex') return { args: ['exec', 'resume', '--json', '--skip-git-repo-check', ...images.flatMap(file => ['--image', file]), nativeId, '-'], stdin: message };
  if (images.length) throw new Error('image_unsupported');
  if (provider === 'claude-code') return { args: ['--print', '--resume', nativeId, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'], stdin: message };
  if (provider === 'opencode') return { args: ['run', '--session', nativeId, '--format', 'json', '--', message], stdin: '' };
  throw new Error('unsupported');
}

/** Extract user-visible response only; do not publish tool input or credentials. */
export function parseOutput(provider, line) {
  let data;
  try { data = JSON.parse(line); } catch { return null; }
  if (provider === 'codex') {
    if (data.type === 'item.completed' && data.item?.type === 'agent_message') return { text: data.item.text || '', append: true };
    if (data.type === 'error' || data.type === 'turn.failed') return { error: data.message || data.error?.message || 'Agent run failed' };
  }
  if (provider === 'claude-code') {
    if (data.type === 'stream_event' && data.event?.type === 'content_block_delta' && data.event.delta?.type === 'text_delta') return { text: data.event.delta.text || '', delta: true };
    if (data.type === 'result') return data.is_error ? { error: (data.errors || []).join('\n') || data.result || 'Agent run failed' } : { text: data.result || '', final: true };
  }
  if (provider === 'opencode') {
    if (data.type === 'text') return { text: data.part?.text || '', append: true };
    if (data.type === 'error') return { error: data.error?.data?.message || data.error?.message || 'Agent run failed' };
  }
  return null;
}
