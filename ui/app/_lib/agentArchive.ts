import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { isHarnessNoise } from './handoff';
import { opencodeParts } from './opencodeParts';
import { codexRolloutId, groupCodexRollouts } from './codexRollout';
import { antigravityHome, codexHome, homeDir, opencodeDataDir } from './paths';
import {
  AgentArchiveMessage,
  AgentMessageKind,
  AgentArchiveStatus,
  AgentArchiveThread,
  AgentProvider,
  archiveDelete,
  archiveGetMeta,
  archiveMessages,
  archiveRemoveInternalClaudeSessions,
  archivePrune,
  archiveSessionFingerprint,
  archiveSessionIsExcluded,
  archiveSessionUpsert,
  archiveSetMeta,
  archiveStatus,
  archiveThread,
  archiveThreads,
} from './agentArchiveDb';

type JsonRecord = Record<string, unknown>;
type SourceFile = { provider: AgentProvider; filePath: string; archived: boolean; historyPaths?: string[] };

const CONTROL_PREFIXES = [
  '# AGENTS.md instructions', '# Codex Global Instructions', '# Global Instructions', '# Response annotations:',
  '<environment_context>', '<codex_internal_context', '<turn_aborted>', '<skill>',
];
const PARSER_VERSION = '20';

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonLines(text: string): JsonRecord[] {
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return isRecord(value) ? [value] : [];
    } catch { return []; }
  });
}

function cleanText(text: string) {
  const normalized = text.trim();
  if (/^<image\b[^>]*>$/.test(normalized) || normalized === '</image>') return '';
  return normalized && !CONTROL_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ? text : '';
}

function cleanAntigravityUserText(text: string): string {
  if (!text) return '';
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  let cleaned = match ? match[1] : text;
  cleaned = cleaned.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');
  cleaned = cleaned.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '');
  return cleanText(cleaned.trim());
}

function textParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return [];
    const text = cleanText(item.text);
    return text ? [text] : [];
  });
}

function codexTextParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (!isRecord(item) || typeof item.text !== 'string') return [];
    if (item.type === 'tool_use' || item.type === 'tool_result') return [];
    const text = cleanText(item.text);
    return text ? [text] : [];
  });
}

function projectName(cwd: string) {
  return cwd ? path.basename(cwd) || cwd : 'Unknown project';
}

function fallbackTitle(messages: AgentArchiveMessage[], provider: AgentProvider, id: string) {
  const firstLine = messages.find((message) => message.role === 'user')?.text.split(/\r?\n/)[0]?.trim();
  if (firstLine) return firstLine.length > 74 ? `${firstLine.slice(0, 74)}…` : firstLine;
  const label = provider === 'codex' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : provider === 'antigravity' ? 'Antigravity' : 'Claude';
  return `${label} session ${id.slice(0, 8)}`;
}

function timestamps(records: JsonRecord[], fallback: string) {
  const values = records.map((record) => record.timestamp).filter((value): value is string => typeof value === 'string').sort();
  return values.at(-1) || fallback;
}

/**
 * In Codex the error signal is not structured; it comes in two forms:
 * `function_call_output` is plain text starting with "Exit code: N";
 * `custom_tool_call_output` is JSON carrying `metadata.exit_code`.
 */
function codexOutputIsError(output: string) {
  const plain = output.match(/^Exit code:\s*(\d+)/m);
  if (plain) return Number(plain[1]) !== 0;
  try {
    const parsed: unknown = JSON.parse(output);
    if (isRecord(parsed) && isRecord(parsed.metadata) && typeof parsed.metadata.exit_code === 'number') {
      return parsed.metadata.exit_code !== 0;
    }
  } catch {
    // Not JSON; treated as no error marker
  }
  return false;
}

/** `custom_tool_call_output` is usually an {output, metadata} wrapper. */
function codexOutputText(output: string) {
  try {
    const parsed: unknown = JSON.parse(output);
    if (isRecord(parsed) && typeof parsed.output === 'string') return parsed.output;
  } catch {
    // plain text
  }
  return output;
}

/**
 * The only readable part of a `reasoning` record is `summary`.
 *
 * The same record has `encrypted_content`: kilobytes of encrypted blob.
 * Storing it bloats the database and tells nothing.
 */
function codexReasoningText(payload: JsonRecord) {
  const summary = payload.summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n');
}

function codexMessages(records: JsonRecord[], id: string, allowEventFallback = true): AgentArchiveMessage[] {
  const messages: AgentArchiveMessage[] = [];
  let ordinal = 0;
  let assetIndex = 0;
  /** Output records have no tool name; it is carried over from the calling call_id. */
  const toolNameByCallId = new Map<string, string>();
  const push = (
    role: 'user' | 'assistant',
    text: string,
    timestamp: string,
    kind: AgentMessageKind,
    toolName?: string,
    isError?: boolean,
  ) => {
    messages.push({ id: `codex:${id}:${ordinal}`, sessionId: id, provider: 'codex', role, text, timestamp, kind, toolName, isError });
    ordinal += 1;
  };

  for (const record of records) {
    const stamp = typeof record.timestamp === 'string' ? record.timestamp : '';

    /**
     * Context compaction.
     *
     * At this point the earlier history was REPLACED by a summary. Critical
     * for a receiving agent: turn endings before this marker may be the
     * model's own summary, not the original text; the transcript itself is
     * the only source for missing detail. `replacement_history` gives the
     * number of records substituted.
     */
    if (record.type === 'compacted' && isRecord(record.payload)) {
      const note = typeof record.payload.message === 'string' ? cleanText(record.payload.message) : '';
      const kept = Array.isArray(record.payload.replacement_history) ? record.payload.replacement_history.length : 0;
      const detail = note || `Context compacted; history replaced by ${kept} records.`;
      push('assistant', clip(detail, TOOL_RESULT_LIMIT), stamp, 'compaction');
      continue;
    }

    if (record.type !== 'response_item' || !isRecord(record.payload)) continue;
    const payload = record.payload;
    const timestamp = stamp;

    if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
      for (const text of codexTextParts(payload.content)) {
        push(payload.role, text, timestamp, 'text');
      }
      for (const part of Array.isArray(payload.content) ? payload.content : []) {
        if (isRecord(part) && part.type === 'input_image') {
          push(payload.role, '[image]', timestamp, 'attachment');
          messages[messages.length - 1].assetIndex = assetIndex++;
        }
      }
      continue;
    }

    if (payload.type === 'reasoning') {
      const text = cleanText(codexReasoningText(payload));
      if (text) push('assistant', clip(text, THINKING_LIMIT), timestamp, 'thinking');
      continue;
    }

    /* `function_call` arguments are a JSON string; `custom_tool_call` input
       is plain text (for example an apply_patch patch). */
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const toolName = typeof payload.name === 'string' ? payload.name : 'tool';
      if (typeof payload.call_id === 'string') toolNameByCallId.set(payload.call_id, toolName);
      let body = '';
      if (payload.type === 'function_call' && typeof payload.arguments === 'string') {
        try {
          body = compactValue(JSON.parse(payload.arguments));
        } catch {
          body = payload.arguments;
        }
      } else if (typeof payload.input === 'string') {
        body = payload.input;
      }
      push('assistant', clip(body, TOOL_INPUT_LIMIT), timestamp, 'tool_use', toolName);
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const raw = typeof payload.output === 'string' ? payload.output : '';
      const toolName = typeof payload.call_id === 'string' ? toolNameByCallId.get(payload.call_id) : undefined;
      push('user', clip(codexOutputText(raw), TOOL_RESULT_LIMIT) || '(no output)', timestamp, 'tool_result', toolName, codexOutputIsError(raw));
      continue;
    }
  }

  if (!allowEventFallback || messages.some((message) => message.kind === 'text')) return messages;
  for (const record of records) {
    if (record.type !== 'event_msg' || !isRecord(record.payload) || record.payload.type !== 'user_message' || typeof record.payload.message !== 'string') continue;
    const text = cleanText(record.payload.message);
    if (!text) continue;
    push('user', text, typeof record.timestamp === 'string' ? record.timestamp : '', 'text');
  }
  return messages;
}

/**
 * Within a Claude Code session the cwd changes constantly: each subdirectory
 * command is recorded with its own cwd. Taking the first record gives the
 * directory the session was opened in -- not where the work happened.
 * Measured example: 83 records at the workspace root, 1389 in a subproject;
 * because the handoff took the first record, it sent the receiving agent to
 * the wrong directory.
 *
 * The last record is not reliable either (one trailing `cd` poisons the
 * result), so the most frequent cwd is used; ties go to the first seen.
 */
function dominantCwd(records: JsonRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (typeof record.cwd !== 'string' || !record.cwd) continue;
    counts.set(record.cwd, (counts.get(record.cwd) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Rich content: tool calls, results, reasoning steps.
 * ------------------------------------------------------------------ */

/** Limits for tool input/output. The full version stays in the source file. */
const TOOL_INPUT_LIMIT = 700;
const TOOL_RESULT_LIMIT = 1200;
const THINKING_LIMIT = 2000;

/** Also strips data URIs embedded INSIDE text. */
function scrubEmbedded(text: string) {
  return text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[embedded data]');
}

function clip(text: string, limit: number) {
  const trimmed = scrubEmbedded(text).trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trimEnd()}\n… (+${trimmed.length - limit} chars)`;
}

/**
 * Reduces a value to a single readable line.
 *
 * Embedded base64 data is NEVER stored: a single screenshot takes megabytes,
 * and that is exactly what pushed the page to hundreds of MB once the
 * transcript was sent to the browser.
 */
function compactValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    if (/^data:[a-z/+.-]+;base64,/i.test(value)) return '[embedded data]';
    if (value.length > 220 && !/\s/.test(value.slice(0, 220))) return '[long data]';
    return value;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 2) return '…';
  if (Array.isArray(value)) return `[${value.slice(0, 6).map((item) => compactValue(item, depth + 1)).join(', ')}${value.length > 6 ? ', …' : ''}]`;
  if (isRecord(value)) {
    return Object.entries(value)
      .slice(0, 8)
      .map(([key, item]) => `${key}: ${compactValue(item, depth + 1)}`)
      .join('\n');
  }
  return '';
}

/** Tool result content: text blocks are kept, images become placeholders. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return compactValue(content);
  return content
    .map((item) => {
      if (!isRecord(item)) return '';
      if (item.type === 'text' && typeof item.text === 'string') return item.text;
      if (item.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

type RichPart = { kind: AgentMessageKind; text: string; toolName?: string; isError?: boolean };

/**
 * Splits Claude content blocks into record kinds.
 *
 * Previously only `type === 'text'` was kept and the rest dropped. The real
 * work of a session is in tool calls: which command ran, which file changed,
 * which error came back. Without them the transcript does not show what was done.
 */
function claudeParts(content: unknown): RichPart[] {
  if (typeof content === 'string') {
    const text = cleanText(content);
    return text ? [{ kind: 'text', text }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): RichPart[] => {
    if (!isRecord(item)) return [];
    if (item.type === 'text' && typeof item.text === 'string') {
      const text = cleanText(item.text);
      return text ? [{ kind: 'text', text }] : [];
    }
    if (item.type === 'thinking' && typeof item.thinking === 'string') {
      const text = cleanText(item.thinking);
      return text ? [{ kind: 'thinking', text: clip(text, THINKING_LIMIT) }] : [];
    }
    if (item.type === 'tool_use') {
      const toolName = typeof item.name === 'string' ? item.name : 'tool';
      const body = item.input === undefined ? '' : clip(compactValue(item.input), TOOL_INPUT_LIMIT);
      return [{ kind: 'tool_use', text: body, toolName }];
    }
    if (item.type === 'tool_result') {
      const body = clip(toolResultText(item.content), TOOL_RESULT_LIMIT);
      return [{ kind: 'tool_result', text: body || '(no output)', isError: item.is_error === true }];
    }
    if (item.type === 'image') return [{ kind: 'attachment', text: '[image]' }];
    return [];
  });
}

/**
 * Counts are conversation counts, not record counts.
 *
 * Since tool calls are now stored as messages too, the raw count jumped
 * tenfold; it would show "1400 prompts" instead of "12 prompts".
 */
function countConversation(messages: AgentArchiveMessage[], role: 'user' | 'assistant') {
  return messages.filter((message) => message.role === role && (message.kind ?? 'text') === 'text').length;
}

/** Loose key for matching a queued record with its processed record. */
function queueKey(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function claudeMessages(records: JsonRecord[], id: string): AgentArchiveMessage[] {
  const messages: AgentArchiveMessage[] = [];
  let ordinal = 0;
  /** tool_result records have no tool name; it is carried over from the calling tool_use. */
  const toolNameByCallId = new Map<string, string>();
  /** Images are numbered in order of appearance in the source file. */
  let assetIndex = 0;

  /**
   * Messages written WHILE the agent is running.
   *
   * A normal message enters the file twice: first as `queue-operation`
   * (queued), then as `type: "user"` (processed). For a message sent while
   * the agent is running, the SECOND NEVER APPEARS -- the message is injected
   * into a tool result, not as a separate user turn. Because the parser read
   * only `type: "user"`, these messages were lost entirely.
   *
   * Adding queue records unconditionally would double every prompt, so a
   * multiset of processed message texts is kept: a matching queue record is
   * skipped, an unmatched one (never processed) is added.
   */
  const processedCounts = new Map<string, number>();
  for (const record of records) {
    if (record.type !== 'user' || !isRecord(record.message)) continue;
    for (const part of claudeParts(record.message.content)) {
      if (part.kind !== 'text') continue;
      const key = queueKey(part.text);
      processedCounts.set(key, (processedCounts.get(key) || 0) + 1);
    }
  }

  for (const record of records) {
    if (record.type === 'queue-operation' && record.operation === 'enqueue' && typeof record.content === 'string') {
      const text = cleanText(record.content);
      /* The harness's own messages also enter the queue (task-notification,
         system-reminder). They are not user input. */
      if (!text || isHarnessNoise(text)) continue;
      const key = queueKey(text);
      const remaining = processedCounts.get(key) || 0;
      if (remaining > 0) {
        processedCounts.set(key, remaining - 1);
        continue;
      }
      messages.push({
        id: `claude-code:${id}:${ordinal}`,
        sessionId: id,
        provider: 'claude-code',
        role: 'user',
        text,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
        kind: 'text',
        queuedMidTurn: true,
      });
      ordinal += 1;
      continue;
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    if (record.isMeta === true || !isRecord(record.message)) continue;
    const role = record.type === 'user' ? 'user' : 'assistant';
    const content = record.message.content;
    /* Claude Code writes the compaction summary as a normal message,
       distinguished only by this flag. Unmarked, the summary would look like
       a prompt the user wrote. */
    if (record.isCompactSummary === true) {
      const summaryText = claudeParts(content)
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n');
      messages.push({
        id: `claude-code:${id}:${ordinal}`,
        sessionId: id,
        provider: 'claude-code',
        role: 'assistant',
        text: clip(summaryText || 'Context compacted.', TOOL_RESULT_LIMIT),
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
        kind: 'compaction',
      });
      ordinal += 1;
      continue;
    }
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!isRecord(item)) continue;
        if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
          toolNameByCallId.set(item.id, item.name);
        }
      }
    }
    for (const part of claudeParts(content)) {
      let toolName = part.toolName;
      if (part.kind === 'tool_result' && Array.isArray(content)) {
        const match = content.find((item) => isRecord(item) && item.type === 'tool_result' && typeof item.tool_use_id === 'string');
        if (isRecord(match) && typeof match.tool_use_id === 'string') toolName = toolNameByCallId.get(match.tool_use_id);
      }
      messages.push({
        id: `claude-code:${id}:${ordinal}`,
        sessionId: id,
        provider: 'claude-code',
        role,
        text: part.text,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
        kind: part.kind,
        toolName,
        isError: part.isError || record.isApiErrorMessage === true,
        assetIndex: part.kind === 'attachment' ? assetIndex++ : undefined,
      });
      ordinal += 1;
    }
  }
  return messages;
}

function antigravityMessages(records: JsonRecord[], id: string): AgentArchiveMessage[] {
  const messages: AgentArchiveMessage[] = [];
  let ordinal = 0;
  for (const record of records) {
    const source = record.source;
    const type = record.type;
    const content = record.content;
    const timestamp = typeof record.created_at === 'string' ? record.created_at : '';

    if ((source === 'USER_EXPLICIT' || type === 'USER_INPUT') && typeof content === 'string') {
      const text = cleanAntigravityUserText(content);
      if (text) {
        messages.push({
          id: `antigravity:${id}:${ordinal}`,
          sessionId: id,
          provider: 'antigravity',
          role: 'user',
          text,
          timestamp,
        });
        ordinal += 1;
      }
    } else if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
      const append = (value: unknown, kind: AgentMessageKind, toolName?: string) => {
        if (typeof value !== 'string' || !value.trim()) return;
        messages.push({
          id: `antigravity:${id}:${ordinal++}`,
          sessionId: id, provider: 'antigravity', role: 'assistant',
          text: kind === 'text' ? cleanText(value.trim()) : value.trim(),
          timestamp, kind, toolName,
        });
      };
      append(record.thinking, 'thinking');
      append(content, 'text');
      if (Array.isArray(record.tool_calls)) {
        for (const call of record.tool_calls) {
          if (!isRecord(call) || typeof call.name !== 'string') continue;
          append(JSON.stringify(call.args ?? {}, null, 2), 'tool_use', call.name);
        }
      }
    } else if (source === 'MODEL' && type === 'GENERIC' && typeof content === 'string' && content.trim()) {
      messages.push({
        id: `antigravity:${id}:${ordinal++}`,
        sessionId: id, provider: 'antigravity', role: 'assistant',
        text: clip(content, TOOL_RESULT_LIMIT), timestamp, kind: 'tool_result',
      });
    }
  }
  return messages;
}

function readVarint(buffer: Buffer, offset: number): { value: number; nextOffset: number } {
  let res = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length) {
    const b = buffer[pos++];
    res |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: res, nextOffset: pos };
}

async function antigravityIndex(): Promise<{ titles: Map<string, string>; cwds: Map<string, string> }> {
  const titles = new Map<string, string>();
  const cwds = new Map<string, string>();
  try {
    const pbPath = path.join(antigravityHome(), 'agyhub_summaries_proto.pb');
    if (!fs.existsSync(pbPath)) return { titles, cwds };
    const data = await readFile(pbPath);
    const uuidRegex = /\x0a\x24([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
    let match: RegExpExecArray | null;
    const str = data.toString('latin1');
    while ((match = uuidRegex.exec(str)) !== null) {
      const uid = match[1];
      let pos = match.index + match[0].length;
      if (pos < data.length && data[pos] === 0x12) {
        pos += 1;
        const sub = readVarint(data, pos);
        const subLen = sub.value;
        const subPos = sub.nextOffset;
        const subData = data.subarray(subPos, Math.min(data.length, subPos + subLen));
        if (subData.length > 2 && subData[0] === 0x0a) {
          const t = readVarint(subData, 1);
          const titleLen = t.value;
          const titlePos = t.nextOffset;
          const titleBytes = subData.subarray(titlePos, titlePos + titleLen);
          const title = titleBytes.toString('utf8').trim();
          if (title) titles.set(uid, title);
        }
        const subStr = subData.toString('utf8');
        const uriMatch = subStr.match(/file:\/\/(\/[^\x00-\x1f\x7f-\x9f"'\s<>]+)/);
        if (uriMatch) {
          const local = decodeURIComponent(uriMatch[1]).replace(/\/+$/, '');
          cwds.set(uid, /^\/[a-z]:\//i.test(local) ? local.slice(1).replace(/\//g, '\\') : local);
        }
      }
    }
  } catch { /* the session file remains the source of truth */ }
  return { titles, cwds };
}

function getOpencodeDbPath() {
  return path.join(opencodeDataDir(), 'opencode.db');
}

function opencodeProjectName(cwd: string) {
  return cwd ? path.basename(cwd) || cwd : 'Unknown project';
}

async function collectOpencodeSessions(forceResync: boolean): Promise<{ sessions: Array<{ thread: AgentArchiveThread; messages: AgentArchiveMessage[]; sourcePath: string; sourceMtimeMs: number; sourceSizeBytes: number }>; total: number }> {
  const dbPath = getOpencodeDbPath();
  if (!fs.existsSync(dbPath)) return { sessions: [], total: 0 };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout=3000');
    const sessions = db.prepare('SELECT id, title, directory, time_created AS timeCreated, time_updated AS timeUpdated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC').all() as Array<{ id: string; title: string; directory: string; timeCreated: number; timeUpdated: number }>;
    if (sessions.length === 0) return { sessions: [], total: 0 };
    const ids = sessions.map((s) => String(s.id)).filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');
    const msgCounts = new Map<string, number>();
    const partCounts = new Map<string, number>();
    try {
      const msgRows = db.prepare(`SELECT session_id as sessionId, count(*) as cnt FROM message WHERE session_id IN (${placeholders}) GROUP BY session_id`).all(...ids) as Array<{ sessionId: string; cnt: number }>;
      msgRows.forEach((r) => msgCounts.set(String(r.sessionId), Number(r.cnt)));
      const partRows = db.prepare(`SELECT session_id as sessionId, count(*) as cnt FROM part WHERE session_id IN (${placeholders}) GROUP BY session_id`).all(...ids) as Array<{ sessionId: string; cnt: number }>;
      partRows.forEach((r) => partCounts.set(String(r.sessionId), Number(r.cnt)));
    } catch { /* ignore */ }
    const filteredSessions = sessions.filter((s) => {
      const id = String(s.id);
      if (!id || archiveSessionIsExcluded(id)) return false;
      if (forceResync) return true;
      const sourceMtimeMs = Number(s.timeUpdated || s.timeCreated || 0);
      const sourceSizeBytes = (partCounts.get(id) || 0) * 1000 + (msgCounts.get(id) || 0);
      const fp = archiveSessionFingerprint(id);
      return !fp || fp.sourceMtimeMs !== sourceMtimeMs || fp.sourceSizeBytes !== sourceSizeBytes;
    });
    const total = sessions.filter((s) => !archiveSessionIsExcluded(String(s.id))).length;
    if (filteredSessions.length === 0) return { sessions: [], total };
    const needIds = filteredSessions.map((s) => String(s.id));
    const needPlaceholders = needIds.map(() => '?').join(',');
    const allMsgs = db.prepare(`SELECT id, session_id as sessionId, time_created as timeCreated, data FROM message WHERE session_id IN (${needPlaceholders}) ORDER BY session_id, time_created ASC`).all(...needIds) as Array<{ id: string; sessionId: string; timeCreated: number; data: string }>;
    const msgsBySession = new Map<string, typeof allMsgs>();
    for (const m of allMsgs) {
      const sid = String(m.sessionId);
      if (!msgsBySession.has(sid)) msgsBySession.set(sid, []);
      msgsBySession.get(sid)!.push(m);
    }
    const msgIds = allMsgs.map((m) => String(m.id));
    const partsByMsg = new Map<string, Array<{ data: string }>>();
    if (msgIds.length > 0) {
      const partPlaceholders = msgIds.map(() => '?').join(',');
      const allParts = db.prepare(`SELECT message_id as messageId, data FROM part WHERE message_id IN (${partPlaceholders}) ORDER BY time_created ASC`).all(...msgIds) as Array<{ messageId: string; data: string }>;
      for (const p of allParts) {
        const mid = String(p.messageId);
        if (!partsByMsg.has(mid)) partsByMsg.set(mid, []);
        partsByMsg.get(mid)!.push({ data: String(p.data) });
      }
    }
    const results: Array<{ thread: AgentArchiveThread; messages: AgentArchiveMessage[]; sourcePath: string; sourceMtimeMs: number; sourceSizeBytes: number }> = [];
    for (const session of filteredSessions) {
      const id = String(session.id);
      const cwd = String(session.directory || '');
      const titleRaw = String(session.title || '').trim();
      const sourceMtimeMs = Number(session.timeUpdated || session.timeCreated || 0);
      const sourceSizeBytes = (partCounts.get(id) || 0) * 1000 + (msgCounts.get(id) || 0);
      const updatedAt = new Date(sourceMtimeMs || Date.now()).toISOString();
      const sourcePath = `${dbPath}#${id}`;
      const messages: AgentArchiveMessage[] = [];
      let ordinal = 0;
      const msgRows = msgsBySession.get(id) || [];
      for (const msgRow of msgRows) {
        let role: 'user' | 'assistant' | null = null;
        let timestamp = '';
        try {
          const data = JSON.parse(String(msgRow.data || '{}')) as JsonRecord;
          const r = typeof data.role === 'string' ? data.role : '';
          if (r === 'user' || r === 'assistant') role = r;
          if (typeof msgRow.timeCreated === 'number') timestamp = new Date(Number(msgRow.timeCreated)).toISOString();
          else if (isRecord(data.time) && typeof data.time.created === 'number') timestamp = new Date(Number(data.time.created)).toISOString();
          else if (typeof data.timestamp === 'string') timestamp = String(data.timestamp);
        } catch { continue; }
        if (!role) continue;
        const partRows = partsByMsg.get(String(msgRow.id)) || [];
        for (const partRow of partRows) {
          try {
            const p = JSON.parse(String(partRow.data || '{}')) as JsonRecord;
            for (const part of opencodeParts(p)) {
              const text = part.kind === 'text' ? cleanText(part.text) : part.text;
              if (!text) continue;
              messages.push({ id: `opencode:${id}:${ordinal++}`, sessionId: id, provider: 'opencode', role, ...part, text, timestamp });
            }
          } catch { continue; }
        }
      }
      const title = titleRaw || fallbackTitle(messages, 'opencode', id);
      const promptCount = countConversation(messages, 'user');
      const responseCount = countConversation(messages, 'assistant');
      results.push({
        thread: { id, provider: 'opencode', title, cwd, project: opencodeProjectName(cwd), updatedAt, promptCount, responseCount, archived: false, sourcePath, sourceAvailable: true, archiveDbPath: dbPath },
        messages,
        sourcePath,
        sourceMtimeMs,
        sourceSizeBytes,
      });
    }
    return { sessions: results, total };
  } catch { return { sessions: [], total: 0 }; }
  finally { try { (db as unknown as { close?: () => void })?.close?.(); } catch { /* ignore */ } }
}

async function walkJsonl(directory: string, provider: AgentProvider, archived: boolean): Promise<SourceFile[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkJsonl(entryPath, provider, archived);
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [{ provider, filePath: entryPath, archived }] : [];
    }));
    return nested.flat();
  } catch { return []; }
}

async function walkClaudeProjectFiles(directory: string): Promise<SourceFile[]> {
  try {
    const projects = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(projects
      .filter((project) => project.isDirectory() && (project.name.startsWith('-') || /^[a-z]--/i.test(project.name)))
      .map(async (project) => {
        const projectPath = path.join(directory, project.name);
        const entries = await readdir(projectPath, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
          .map((entry) => ({ provider: 'claude-code' as const, filePath: path.join(projectPath, entry.name), archived: false }));
      }));
    return files.flat();
  } catch { return []; }
}

async function walkAntigravitySessions(directory: string): Promise<SourceFile[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return [];
      const sessionPath = path.join(directory, entry.name);
      const transcript = path.join(sessionPath, '.system_generated', 'logs', 'transcript.jsonl');
      const transcriptFull = path.join(sessionPath, '.system_generated', 'logs', 'transcript_full.jsonl');
      try {
        if (fs.existsSync(transcriptFull)) {
          return [{ provider: 'antigravity' as const, filePath: transcriptFull, archived: false }];
        }
        if (fs.existsSync(transcript)) {
          return [{ provider: 'antigravity' as const, filePath: transcript, archived: false }];
        }
      } catch { /* ignore */ }
      return [];
    }));
    return files.flat();
  } catch { return []; }
}

async function sourceFiles(): Promise<SourceFile[]> {
  const codex = codexHome();
  const results = await Promise.all([
    walkJsonl(path.join(codex, 'sessions'), 'codex', false),
    walkJsonl(path.join(codex, 'archived_sessions'), 'codex', true),
    walkClaudeProjectFiles(path.join(homeDir(), '.claude', 'projects')),
    walkAntigravitySessions(path.join(antigravityHome(), 'brain')),
  ]);
  const seen = new Set<string>();
  const unique = results.flat().filter((source) => {
    const key = `${source.provider}:${source.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rollouts = await Promise.all(unique.filter(source => source.provider === 'codex').map(async source => ({ ...source, modified: (await stat(source.filePath)).mtimeMs })));
  const grouped = groupCodexRollouts(rollouts).map(group => ({ ...group[group.length - 1], historyPaths: group.map(source => source.filePath) }));
  return [...unique.filter(source => source.provider !== 'codex'), ...grouped];
}

export async function codexIndex(root?: string) {
  const index = new Map<string, string>();
  try {
    const home = path.resolve(root || codexHome());
    const records = parseJsonLines(await readFile(path.join(home, 'session_index.jsonl'), 'utf8'));
    for (const record of records) {
      if (typeof record.id !== 'string') continue;
      if (typeof record.thread_name === 'string' && record.thread_name.trim()) index.set(record.id, record.thread_name);
    }
  } catch { /* the session file remains the source of truth */ }
  return index;
}

async function parseSource(
  source: SourceFile,
  codexTitles: Map<string, string>,
  antigravityMeta: { titles: Map<string, string>; cwds: Map<string, string> }
) {
  const [texts, metadata] = await Promise.all([Promise.all((source.historyPaths || [source.filePath]).map(file => readFile(file, 'utf8'))), stat(source.filePath)]);
  const text = texts.join('\n');
  const records = parseJsonLines(text);
  if (source.provider === 'codex') {
    const id = codexRolloutId(source.filePath);
    if (!id) return null;
    const metaRecord = records.find((record) => record.type === 'session_meta' && isRecord(record.payload));
    const meta = metaRecord?.payload as JsonRecord | undefined;
    const cwd = typeof meta?.cwd === 'string' ? meta.cwd : '';
    const messages = codexMessages(records, id);
    const fallbackUpdated = new Date(metadata.mtimeMs).toISOString();
    return { thread: { id, provider: 'codex' as const, title: codexTitles.get(id) || fallbackTitle(messages, 'codex', id), cwd, project: projectName(cwd), updatedAt: timestamps(records, fallbackUpdated), promptCount: countConversation(messages, 'user'), responseCount: countConversation(messages, 'assistant'), archived: source.archived, internal: isRecord(meta?.source) && 'subagent' in meta.source }, messages, sourceMtimeMs: metadata.mtimeMs, sourceSizeBytes: metadata.size, sourcePath: source.filePath };
  }
  if (source.provider === 'antigravity') {
    const match = source.filePath.match(/\/brain\/([0-9a-f-]{36})\//i);
    const id = match ? match[1] : path.basename(path.dirname(path.dirname(path.dirname(source.filePath))));
    if (!id) return null;
    const messages = antigravityMessages(records, id);
    let cwd = antigravityMeta.cwds.get(id) || '';
    if (!cwd) {
      for (const r of records) {
        if (typeof r.content === 'string') {
          const home = homeDir().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
          const m = [...r.content.matchAll(/((?:[A-Za-z]:)?[\\/][\w.-]+(?:[\\/][\w.-]+)+)/g)]
            .find((hit) => hit[1].replace(/\\/g, '/').toLowerCase().startsWith(home + '/'));
          if (m) {
            const cand = m[1].replace(/[\\/]+$/, '');
            if (fs.existsSync(cand)) {
              cwd = fs.statSync(cand).isDirectory() ? cand : path.dirname(cand);
              break;
            }
          }
        }
        if (Array.isArray(r.tool_calls)) {
          for (const tc of r.tool_calls) {
            if (isRecord(tc) && isRecord(tc.args)) {
              const args = tc.args as Record<string, unknown>;
              for (const k of ['Cwd', 'SearchDirectory', 'DirectoryPath', 'AbsolutePath', 'TargetFile']) {
                const v = args[k];
                if (typeof v === 'string') {
                  const cleanV = v.replace(/^["']|["']$/g, '');
                  if (path.isAbsolute(cleanV)) {
                    if (fs.existsSync(cleanV)) {
                      cwd = fs.statSync(cleanV).isDirectory() ? cleanV : path.dirname(cleanV);
                      break;
                    }
                  }
                }
              }
            }
            if (cwd) break;
          }
        }
        if (cwd) break;
      }
    }
    const title = antigravityMeta.titles.get(id) || fallbackTitle(messages, 'antigravity', id);
    const fallbackUpdated = new Date(metadata.mtimeMs).toISOString();
    return {
      thread: {
        id,
        provider: 'antigravity' as const,
        title,
        cwd,
        project: projectName(cwd),
        updatedAt: timestamps(records, fallbackUpdated),
        promptCount: countConversation(messages, 'user'),
        responseCount: countConversation(messages, 'assistant'),
        archived: false,
      },
      messages,
      sourceMtimeMs: metadata.mtimeMs,
      sourceSizeBytes: metadata.size,
      sourcePath: source.filePath,
    };
  }
  const sessionRecord = records.find((record) => typeof record.sessionId === 'string');
  const id = typeof sessionRecord?.sessionId === 'string' ? sessionRecord.sessionId : path.basename(source.filePath, '.jsonl');
  const cwd = dominantCwd(records);
  const titleRecord = records.find((record) => record.type === 'custom-title' && typeof record.customTitle === 'string');
  const customTitle = typeof titleRecord?.customTitle === 'string' ? titleRecord.customTitle : undefined;
  const messages = claudeMessages(records, id);
  const fallbackUpdated = new Date(metadata.mtimeMs).toISOString();
  return { thread: { id, provider: 'claude-code' as const, title: customTitle || fallbackTitle(messages, 'claude-code', id), cwd, project: projectName(cwd), updatedAt: timestamps(records, fallbackUpdated), promptCount: countConversation(messages, 'user'), responseCount: countConversation(messages, 'assistant'), archived: false }, messages, sourceMtimeMs: metadata.mtimeMs, sourceSizeBytes: metadata.size, sourcePath: source.filePath };
}

export type AgentSyncResult = { scanned: number; imported: number; updated: number; skipped: number; excluded: number; lastSyncedAt: string; status: AgentArchiveStatus };

let syncInFlight: Promise<AgentSyncResult> | null = null;

async function performAgentSync(): Promise<AgentSyncResult> {
  const startedAt = new Date().toISOString();
  const forceResync = archiveGetMeta('parser_version') !== PARSER_VERSION;
  const [sources, titles, antigravityMeta] = await Promise.all([sourceFiles(), codexIndex(), antigravityIndex()]);
  const { sessions: opencodeSessions, total: opencodeTotal } = await collectOpencodeSessions(forceResync);
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let excluded = 0;
  archiveRemoveInternalClaudeSessions();
  for (const source of sources) {
    const idFromName = source.provider === 'codex'
      ? codexRolloutId(source.filePath)
      : source.provider === 'antigravity'
      ? source.filePath.match(/\/brain\/([0-9a-f-]{36})\//i)?.[1]
      : path.basename(source.filePath, '.jsonl');
    if (idFromName && archiveSessionIsExcluded(idFromName)) { excluded += 1; continue; }
    /**
     * Skip unchanged files without parsing.
     *
     * The fingerprint check below used to run AFTER the file was fully read
     * and parsed as JSON, so "skip" only skipped the DB write, not the I/O.
     * Every page render read 283 session files end to end -- including
     * megabyte-sized Codex files full of base64 screenshots. The id derived
     * from the file name is already known, and stat gives mtime+size
     * without reading the file.
     */
    if (!forceResync && idFromName) {
      const knownFingerprint = archiveSessionFingerprint(idFromName);
      if (knownFingerprint) {
        const metadata = await stat(source.filePath).catch(() => null);
        if (
          metadata &&
          knownFingerprint.sourceMtimeMs === metadata.mtimeMs &&
          knownFingerprint.sourceSizeBytes === metadata.size
        ) {
          skipped += 1;
          continue;
        }
      }
    }
    const parsed = await parseSource(source, titles, antigravityMeta);
    if (!parsed || archiveSessionIsExcluded(parsed.thread.id)) { excluded += 1; continue; }
    const fingerprint = archiveSessionFingerprint(parsed.thread.id);
    if (!forceResync && fingerprint && fingerprint.sourceMtimeMs === parsed.sourceMtimeMs && fingerprint.sourceSizeBytes === parsed.sourceSizeBytes) { skipped += 1; continue; }
    archiveSessionUpsert(parsed);
    if (fingerprint) updated += 1; else imported += 1;
  }
  for (const parsed of opencodeSessions) {
    if (archiveSessionIsExcluded(parsed.thread.id)) { excluded += 1; continue; }
    const fingerprint = archiveSessionFingerprint(parsed.thread.id);
    if (!forceResync && fingerprint && fingerprint.sourceMtimeMs === parsed.sourceMtimeMs && fingerprint.sourceSizeBytes === parsed.sourceSizeBytes) { skipped += 1; continue; }
    archiveSessionUpsert(parsed);
    if (fingerprint) updated += 1; else imported += 1;
  }
  archiveSetMeta('parser_version', PARSER_VERSION);
  archiveSetMeta('last_synced_at', startedAt);
  return { scanned: sources.length + opencodeTotal, imported, updated, skipped: skipped + (opencodeTotal - opencodeSessions.length), excluded, lastSyncedAt: startedAt, status: archiveStatus() };
}

export function syncAgentSessions(): Promise<AgentSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performAgentSync().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export function listAgentThreads(provider?: AgentProvider) {
  return archiveThreads().filter((thread) => !provider || thread.provider === provider);
}

/** Server-resolved native source; also used for read-only synced Mac histories. */
export async function readNativeHandoffSource(filePath: string, provider: 'codex' | 'claude-code') {
  return parseSource({ filePath, provider, archived: false }, new Map(), { titles: new Map(), cwds: new Map() });
}

export function getAgentThread(id: string) {
  return archiveThread(id);
}

export function getAgentThreadMessages(id: string) {
  return archiveMessages(id);
}

export function deleteAgentThread(id: string) {
  archiveDelete(id);
}

export function pruneAgentThreads(days: number) {
  return archivePrune(days);
}

export function getAgentArchiveStatus() {
  return archiveStatus();
}

export { archiveGetMeta };

/* ------------------------------------------------------------------ *
 * Live tailing: catch new messages in the open chat as soon as they arrive.
 * ------------------------------------------------------------------ */

export type AgentTailResult = {
  /** Only messages after `fromOrdinal`. */
  messages: AgentArchiveMessage[];
  /** Byte offset where the next read starts. */
  byteOffset: number;
  /** Total message count in the file (the next `fromOrdinal`). */
  ordinalCount: number;
  assetCount?: number;
};

function messagesFromRecords(records: JsonRecord[], provider: AgentProvider, id: string, allowEventFallback = true) {
  if (provider === 'codex') return codexMessages(records, id, allowEventFallback);
  if (provider === 'antigravity') return antigravityMessages(records, id);
  return claudeMessages(records, id);
}

/** IDs of messages produced during streaming are shifted to their real position in the file. */
function shiftOrdinals(messages: AgentArchiveMessage[], provider: AgentProvider, id: string, offset: number, assetOffset = 0) {
  return messages.map((message, index) => ({ ...message, id: `${provider}:${id}:${offset + index}`, ...(message.assetIndex === undefined ? {} : { assetIndex: message.assetIndex + assetOffset }) }));
}

/**
 * Reads the whole file. Runs once on the first stream tick: there is no other
 * way to align byte offset with message order, because message order is not
 * line order (not every line produces a message).
 */
export async function getAgentSourcePaths(id: string): Promise<string[]> {
  const thread = archiveThread(id);
  if (!thread?.sourcePath || thread.provider === 'opencode') return [];
  if (thread.provider !== 'codex') return [thread.sourcePath];
  const source = (await sourceFiles()).find(source => source.provider === 'codex' && codexRolloutId(source.filePath) === id);
  return source?.historyPaths || [thread.sourcePath];
}

export async function readAgentMessagesFromSource(id: string): Promise<AgentTailResult | null> {
  const thread = archiveThread(id);
  if (!thread?.sourcePath || thread.provider === 'opencode') return null;
  let text: string;
  try {
    const paths = await getAgentSourcePaths(id);
    const texts = await Promise.all(paths.map(file => readFile(file, 'utf8')));
    text = texts.join('\n');
    // Tail offsets belong to the current writer segment, not the combined history.
    const messages = messagesFromRecords(parseJsonLines(text), thread.provider, id);
    return { messages, byteOffset: Buffer.byteLength(texts[texts.length - 1], 'utf8'), ordinalCount: messages.length, assetCount: messages.filter(message => message.kind === 'attachment').length };
  } catch {
    return null;
  }
}

/**
 * Reads only the appended bytes.
 *
 * Session files are append-only JSONL. Reparsing a 13 MB file on every new
 * message is unnecessary; everything after the last known offset is enough.
 *
 * Two edge cases:
 * - The writer may not have finished the line yet. So only up to the last
 *   `\n` is parsed and the cursor advances only that far; a half line is
 *   read complete on the next tick.
 * - If the file shrank (rewritten), tail reading is meaningless; null is
 *   returned so the caller falls back to a full read.
 */
export async function tailAgentMessages(
  id: string,
  fromByte: number,
  fromOrdinal: number,
  fromAsset = 0,
): Promise<AgentTailResult | null> {
  const thread = archiveThread(id);
  if (!thread?.sourcePath || thread.provider === 'opencode') return null;
  let metadata;
  try {
    metadata = await stat(thread.sourcePath);
  } catch {
    return null;
  }
  if (metadata.size < fromByte) return null;
  if (metadata.size === fromByte) {
    return { messages: [], byteOffset: fromByte, ordinalCount: fromOrdinal };
  }

  const handle = await open(thread.sourcePath, 'r');
  try {
    const length = metadata.size - fromByte;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, fromByte);
    const chunk = buffer.toString('utf8');
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline === -1) {
      // A single half line: no complete record to parse yet.
      return { messages: [], byteOffset: fromByte, ordinalCount: fromOrdinal };
    }
    const complete = chunk.slice(0, lastNewline + 1);
    const records = parseJsonLines(complete);
    const fresh = messagesFromRecords(records, thread.provider, id, false);
    return {
      messages: shiftOrdinals(fresh, thread.provider, id, fromOrdinal, fromAsset),
      assetCount: fromAsset + fresh.filter(message => message.kind === 'attachment').length,
      byteOffset: fromByte + Buffer.byteLength(complete, 'utf8'),
      ordinalCount: fromOrdinal + fresh.length,
    };
  } finally {
    await handle.close();
  }
}
