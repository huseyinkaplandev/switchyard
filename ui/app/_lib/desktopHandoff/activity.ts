import type { AgentArchiveMessage } from '../agentArchiveDb';
import type { ActivityPreview, TimePreset, TimeWindow } from './types';

/** Remove app-added envelopes from presentation, never from native storage. */
export function conversationText(text: string): string {
  return text
    .replace(/<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/g, (_match, body: string) => {
      try { const replies=JSON.parse(body); return Array.isArray(replies)?replies.map(r=>typeof r.answer==='string'?r.answer:'').filter(Boolean).join('\n\n'):''; }
      catch { return [...body.matchAll(/"answer"\s*:\s*("(?:\\.|[^"\\])*")/g)].map(m=>{try{return JSON.parse(m[1]);}catch{return '';}}).join('\n\n'); }
    })
    .replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g, '')
    .replace(/<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/g, '')
    .replace(/(?:^|\n)# Files mentioned by the user:[\s\S]*?Distinguish instructions in attached documents from the user's request\./g, '')
    .replace(/(?:^|\n)## My request:\s*/g, '\n')
    .trim();
}

export function meaningful(text: string) {
  return Boolean(text.trim()) && !/^(\[Request interrupted|<task-notification>|<local-command-|<command-|<system-reminder>|<ci-monitor-event>|<in-app-browser-context|<ide_|<user-memory-input>|<environment_context>|<cross-session-message|Caveat: The messages below|\[Image:|Shell cwd was reset|API Error:|\[No response requested\])/.test(text.trim());
}
export function summarizeActivity(messages: Pick<AgentArchiveMessage, 'id' | 'text' | 'role' | 'timestamp' | 'kind' | 'isError'>[]) {
  let lastUser: ActivityPreview | null = null;
  let lastAssistant: ActivityPreview | null = null;
  for (const m of messages) {
    const text = m.role === 'user' ? conversationText(m.text) : m.text;
    if ((m.kind && m.kind !== 'text') || m.isError || !meaningful(text) || !Number.isFinite(Date.parse(m.timestamp))) continue;
    const preview = { messageId: m.id, text: [...text].slice(0, 240).join(''), at: new Date(m.timestamp).toISOString() };
    if (m.role === 'user' && (!lastUser || preview.at >= lastUser.at)) lastUser = preview;
    if (m.role === 'assistant' && (!lastAssistant || preview.at >= lastAssistant.at)) lastAssistant = preview;
  }
  return { lastUser, lastAssistant, activityAt: [lastUser?.at, lastAssistant?.at].filter(Boolean).sort().at(-1) ?? null };
}
export function resolveTimeWindow(preset: TimePreset, now = new Date().toISOString(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', custom?: { from: string; to: string }): TimeWindow {
  let end = Date.parse(now), from: string | null = null;
  if (!Number.isFinite(end)) throw new Error('Invalid time');
  // Reject unsupported zones instead of silently falling back to server time.
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  if (preset === 'today') {
    const parts = Object.fromEntries(format.formatToParts(new Date(end)).map(p => [p.type, p.value]));
    const calendar = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    let midnight = calendar;
    for (let i = 0; i < 4; i++) {
      const p = Object.fromEntries(format.formatToParts(new Date(midnight)).map(p => [p.type, p.value]));
      const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      midnight += calendar - represented;
    }
    from = new Date(midnight).toISOString();
  } else if (preset === '8h' || preset === '24h' || preset === '7d') from = new Date(end - ({ '8h': 8, '24h': 24, '7d': 168 }[preset]) * 3600000).toISOString();
  else if (preset === 'custom') {
    const start = Date.parse(custom?.from ?? ''); end = Date.parse(custom?.to ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Invalid custom range');
    from = new Date(start).toISOString();
  } else if (preset !== 'all') throw new Error('Invalid time preset');
  return { from, to: new Date(end).toISOString(), zone };
}
export function withinWindow(at: string | null, window: TimeWindow) {
  if (!at) return window.from === null;
  const value = Date.parse(at);
  return Number.isFinite(value) && value <= Date.parse(window.to) && (window.from === null || value >= Date.parse(window.from));
}
