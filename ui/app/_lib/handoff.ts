import type { AgentArchiveMessage, AgentArchiveThread } from './agentArchiveDb';

export type WorkspaceGitState = {
  available: boolean;
  branch?: string;
  head?: string;
  headSubject?: string;
  dirtyCount?: number;
  dirtyFiles?: string[];
  untrackedCount?: number;
  untrackedFiles?: string[];
  recentCommits?: string[];
  error?: string;
};

export function providerDisplayName(provider: AgentArchiveThread['provider']) {
  if (provider === 'claude-code') return 'Claude Code';
  if (provider === 'opencode') return 'OpenCode';
  if (provider === 'antigravity') return 'Antigravity';
  return 'Codex';
}

export function providerReplyLabel(provider: AgentArchiveThread['provider']) {
  if (provider === 'claude-code') return 'CLAUDE REPLY';
  if (provider === 'opencode') return 'OPENCODE REPLY';
  if (provider === 'antigravity') return 'ANTIGRAVITY REPLY';
  return 'CODEX REPLY';
}

/**
 * Harness noise: messages stored with the user role that the user never
 * typed. Counting them inflates the prompt count, and when one comes last the
 * `Latest User Request` section becomes useless (an interrupt used to be the
 * only "request" a handoff carried).
 */
const NOISE_PATTERNS: RegExp[] = [
  /^\[Request interrupted by user\]/,
  /^\[Request interrupted by user for tool use\]/,
  /^<task-notification>/,
  /^<local-command-(stdout|stderr)>/,
  /^<command-(name|message|args)>/,
  /^<system-reminder>/,
  /^<ci-monitor-event>/,
  /^<in-app-browser-context/,
  /^<ide_(opened_file|diagnostics)>/,
  /^<user-memory-input>/,
  /^<environment_context>/,
  /^Caveat: The messages below were generated/,
  /^\[Image:[^\]]*\]\s*$/,
  /^Shell cwd was reset to \S+\s*$/,
  /^API Error:/,
  /^\[No response requested\]/,
];

export function isHarnessNoise(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * One user turn and its closing message.
 *
 * The closing message is the last assistant message before the next real user
 * turn. Agents summarise when they finish a turn; the messages in between are
 * running commentary. Taking the last one gives the turn's outcome in one
 * piece. An interrupted turn has a short closing, which is correct: that turn
 * really did not finish.
 */
export type HandoffTurn = {
  index: number;
  request: string;
  requestOrdinal: number;
  closing: string;
  replyCount: number;
  interrupted: boolean;
  /** Tools used in the turn with their counts, most used first. */
  tools: Array<[string, number]>;
  /** Tool results in the turn that reported an error. */
  toolErrors: number;
  /** How many times the context was compacted during the turn. */
  compactions: number;
};

export function buildTurns(messages: AgentArchiveMessage[]): HandoffTurn[] {
  const ordered = messages.map((message, index) => ({ message, index }));
  /**
   * The `kind === 'text'` check matters: tool RESULTS are also stored with
   * `role: 'user'`. Without it every tool output would count as a separate
   * user turn and turn detection would fall apart.
   */
  const isConversation = (message: AgentArchiveMessage) => (message.kind ?? 'text') === 'text';
  const realUserTurns = ordered.filter(
    (entry) => entry.message.role === 'user' && isConversation(entry.message) && !isHarnessNoise(entry.message.text),
  );
  const interruptedAfter = new Set(
    ordered
      .filter((entry) => entry.message.role === 'user' && /^\[Request interrupted by user/.test(entry.message.text.trim()))
      .map((entry) => entry.index),
  );

  return realUserTurns.map((entry, turnIndex) => {
    const nextIndex = realUserTurns[turnIndex + 1]?.index ?? ordered.length;
    const between = ordered.filter(
      (candidate) =>
        candidate.index > entry.index &&
        candidate.index < nextIndex &&
        candidate.message.role === 'assistant' &&
        isConversation(candidate.message) &&
        candidate.message.text.trim().length > 0,
    );
    const closing = between.at(-1);
    /* Which tools the turn used: the densest answer to "what was actually
       done". Counts only, not full outputs. */
    const toolCounts = new Map<string, number>();
    let toolErrors = 0;
    let compactions = 0;
    for (const candidate of ordered) {
      if (candidate.index <= entry.index || candidate.index >= nextIndex) continue;
      const kind = candidate.message.kind ?? 'text';
      if (kind === 'tool_use') {
        const name = candidate.message.toolName || 'tool';
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
      if (candidate.message.isError) toolErrors += 1;
      if (kind === 'compaction') compactions += 1;
    }
    const interrupted = Array.from(interruptedAfter).some(
      (index) => index > entry.index && index < nextIndex,
    );
    return {
      index: turnIndex,
      request: entry.message.text.trim(),
      requestOrdinal: entry.index,
      closing: closing?.message.text.trim() || '',
      replyCount: between.length,
      interrupted,
      tools: [...toolCounts.entries()].sort((left, right) => right[1] - left[1]),
      toolErrors,
      compactions,
    };
  });
}

/**
 * Open-work candidates. Deliberately narrow: loose words ("remaining",
 * "still", "missing") produce many false positives in summaries. High
 * precision beats recall here because the full turn text is in the handoff
 * anyway; this list is a pointer, not the source. English and Turkish phrases
 * are both recognised.
 */
const OPEN_TASK_PATTERN =
  /(^- \[ \]|\bTODO\b|\bnot (?:yet )?(?:committed|done|fixed|implemented|tested|pushed)\b|\bI (?:did not|didn't|could not|couldn't) (?:commit|finish|fix|add|test|run)\b|\bneeds? your (?:decision|input|approval)\b|\bleft (?:open|for you)\b|\bstill (?:failing|broken|open)\b|commit\s*(et|ed)[a-zçğıöşü]*medim|dokunmadım|yapmadım|yapamadım|düzeltmedim|ekleyemedim|\bsenin\s+\S+\s*(gerek|eklemen|kararın|yapman)|kararın gereken|sende kaldı|hallolmadı|açık kaldı)/i;

export type OpenTask = { text: string; turn: number };

/**
 * Tasks come back with their source turn.
 *
 * An item from an old turn may already be resolved; without the turn number
 * the next agent cannot tell stale from current and redoes finished work. We
 * do not infer "closed" automatically: closing something wrongly costs more
 * than showing something stale.
 */
export function extractOpenTasks(turns: HandoffTurn[], limit = 8): OpenTask[] {
  const seen = new Set<string>();
  const found: OpenTask[] = [];
  for (const turn of [...turns].reverse()) {
    for (const rawLine of turn.closing.split('\n')) {
      const line = rawLine
        .trim()
        .replace(/^[-*]\s*\[ \]\s*/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\*{0,2}\d+[.)]\s*/, '')
        .replace(/^\*\*\s*/, '')
        /* Removing a leading `**` leaves its partner alone, which would bold
           the rest of the markdown. */
        .replace(/\*\*/g, (match, offset, whole) => ((whole.match(/\*\*/g) || []).length % 2 === 1 ? '' : match));
      // Section headings trigger the pattern but are not tasks; their items are caught below them.
      if (line.startsWith('#')) continue;
      if (line.length < 12 || line.length > 400) continue;
      if (!OPEN_TASK_PATTERN.test(rawLine.trim())) continue;
      /* Digits and emphasis are stripped for matching: "9 files changed" and
         "8 files changed" are two versions of one sentence, not two tasks. */
      const key = line.toLowerCase().replace(/\d+/g, '#').replace(/[*`_—–-]/g, '').replace(/\s+/g, ' ').slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ text: line, turn: turn.index + 1 });
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/**
 * A quoted turn closing carries its own markdown headings. Left alone, an
 * agent's "## Result" heading sits at the same level as the handoff's own
 * "## Open Tasks" and the document structure breaks. Quoted content must
 * follow the hierarchy of the document that quotes it.
 */
function demoteHeadings(text: string, levels = 2) {
  return text.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, space: string) => {
    const depth = Math.min(6, hashes.length + levels);
    return `${'#'.repeat(depth)}${space}`;
  });
}

/**
 * Secrets must not leak.
 *
 * The handoff is built from the transcript, and a transcript can contain a
 * printed `.env` or a token. Handoffs get copied to other agents, other
 * machines and sometimes issues, so this is exactly where leaking is easiest.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-ant-[A-Za-z0-9_-]{8,})/g, 'sk-ant-***'],
  [/\b(sk-[A-Za-z0-9]{20,})/g, 'sk-***'],
  [/\b(ghp_[A-Za-z0-9]{20,})/g, 'ghp_***'],
  [/\b(gho_[A-Za-z0-9]{20,})/g, 'gho_***'],
  [/\b(github_pat_[A-Za-z0-9_]{20,})/g, 'github_pat_***'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})/g, 'xox-***'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, 'AKIA***'],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt.***'],
  [/((?:API|SECRET|ACCESS|PRIVATE|AUTH)_?(?:KEY|TOKEN|SECRET)\s*[=:]\s*)(\S{8,})/gi, '$1***'],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1 *** $2'],
];

export function redactSecrets(text: string) {
  let output = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) output = output.replace(pattern, replacement);
  return output;
}

/** Tools whose input names a file path. */
const FILE_TOOLS = new Set(['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit', 'str_replace_editor']);
/** Shell tools: names differ per provider, behaviour is the same. */
const SHELL_TOOLS = new Set(['Bash', 'exec', 'exec_command', 'shell_command', 'shell', 'run_terminal_cmd']);
/** Codex patches list the changed files EXPLICITLY in their headers. */
const PATCH_TOOLS = new Set(['apply_patch', 'edit_file', 'str_replace']);
const PATCH_FILE = /^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s*(.+)$/gm;

/**
 * File paths that appear in shell commands.
 *
 * Looking at file tools is not enough: a session may change files entirely
 * through the shell (heredoc, sed, python). One measured session had 174 shell
 * calls and zero Edit/Write calls, so the list came out empty. The extension
 * allowlist is deliberate: treating every token as a path fills the output
 * with junk.
 */
const SOURCE_PATH = /\b[\w.@/-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|php|swift|kt|sql|sh|ya?ml|toml|json|md|css|scss|html)\b/g;

function harvestShellPaths(text: string, into: Map<string, number>) {
  const matches = text.match(SOURCE_PATH);
  if (!matches) return;
  for (const raw of matches) {
    const file = raw.replace(/^['"(]+/, '').replace(/['")]+$/, '');
    // Dependencies and build output are not the session's work.
    if (/node_modules|\.next|\/dist\/|package-lock|pnpm-lock/.test(file)) continue;
    if (file.length < 4 || file.length > 160) continue;
    into.set(file, (into.get(file) || 0) + 1);
  }
}

/**
 * Files the session actually touched.
 *
 * The next agent's first question is "which files are involved". Git status
 * only shows uncommitted ones; committed or merely read files are missing
 * there. This list comes from the tool calls, so it is the session's own trail.
 */
export function collectTouchedFiles(messages: AgentArchiveMessage[], limit = 18) {
  const edited = new Map<string, number>();
  const read = new Map<string, number>();
  const mentioned = new Map<string, number>();
  for (const message of messages) {
    if ((message.kind ?? 'text') !== 'tool_use') continue;
    const tool = (message.toolName || '').split('.').at(-1) || '';
    const readTool = /^(Read|read|read_file|view_file|find_symbol|get_symbols_overview|search_for_pattern)$/.test(tool) || /__(find_symbol|get_symbols_overview|search_for_pattern)$/.test(tool);
    const editTool = /^(Edit|Write|edit|write|write_to_file|replace_file_content|multi_replace_file_content|NotebookEdit|MultiEdit|str_replace_editor|replace_content|replace_symbol_body|insert_after_symbol|insert_before_symbol)$/.test(tool) || /__(replace_content|replace_symbol_body|insert_after_symbol|insert_before_symbol)$/.test(tool);
    if (readTool || editTool) {
      let args: Record<string, unknown> | null = null;
      try { args = JSON.parse(message.text); } catch { /* Codex/Claude normalized tool arguments use key: value lines. */ }
      const keys = ['file_path','filePath','path','relative_path','TargetFile','AbsolutePath','NotebookPath'];
      let file = keys.map(key => args?.[key]).find(value => typeof value === 'string') as string | undefined;
      if (!file) {
        const match = message.text.match(/^(?:file_path|filePath|path|relative_path|TargetFile|AbsolutePath|NotebookPath):[ \t]*(.+)$/m);
        if (match) file = match[1].trim().replace(/^["']|["']$/g, '');
      }
      if (file) {
        const target = readTool ? read : edited;
        target.set(file, (target.get(file) || 0) + 1);
        continue;
      }
    }
    if (FILE_TOOLS.has(tool)) {
      const match = message.text.match(/file_path:\s*(\S+)/) || message.text.match(/path:\s*(\S+)/);
      if (match) {
        const target = tool === 'Read' ? read : edited;
        target.set(match[1], (target.get(match[1]) || 0) + 1);
        continue;
      }
    }
    if (PATCH_TOOLS.has(tool)) {
      /* Patch headers are declarations, not guesses: the tool itself says
         which file changed. */
      let hit: RegExpExecArray | null;
      PATCH_FILE.lastIndex = 0;
      let found = false;
      while ((hit = PATCH_FILE.exec(message.text)) !== null) {
        const file = hit[1].trim();
        edited.set(file, (edited.get(file) || 0) + 1);
        found = true;
      }
      if (found) continue;
    }
    if (SHELL_TOOLS.has(tool)) harvestShellPaths(message.text, mentioned);
  }
  const rank = (entries: Map<string, number>) =>
    [...entries.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit);
  // Do not repeat files already listed through file tools.
  for (const [file] of [...edited, ...read]) mentioned.delete(file);
  return { edited: rank(edited), read: rank(read), mentioned: rank(mentioned) };
}

/**
 * Where the previous agent got stuck.
 *
 * These are not open work: they are questions only the human can answer.
 * Without them the next agent runs into the same wall. The pattern is narrow:
 * not every question mark, only sentences asking for a decision or approval.
 */
const OPEN_QUESTION_PATTERN =
  /(\bwhich (?:one|option) (?:do you|would you|should I)\b|\bdo you want me to\b|\bshould I\b.*\?|\byour (?:call|decision)\b|\blet me know (?:if|which|whether)\b|\bcan you confirm\b|hangisini|karar\s+senin|senin\s+kararın|onay(ın|ini|ını)?\s|hangi(sini)?\s+(istersin|tercih)|ne\s+yapayım|istersen\s+söyle|sana\s+kalmış|teyit\s+eder)/i;

export function extractOpenQuestions(turns: HandoffTurn[], limit = 5) {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const turn of [...turns].reverse()) {
    for (const rawLine of turn.closing.split('\n')) {
      const line = rawLine.trim().replace(/^[-*]\s+/, '');
      if (line.length < 15 || line.length > 300 || line.startsWith('#')) continue;
      if (!OPEN_QUESTION_PATTERN.test(line)) continue;
      const key = line.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(line);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n… (shortened; the full text is in the dashboard and the archive DB)`;
}

/**
 * Full text for the newest turns, shortened text for older ones. Without a
 * budget a seven-turn session produced a 15k-character handoff; the latest
 * turns matter most to the next agent, so the budget is spent newest first.
 */
function allocateTurnBodies(turns: HandoffTurn[], budget = 9000) {
  const bodies = new Map<number, string>();
  let remaining = budget;
  for (const turn of [...turns].reverse()) {
    if (!turn.closing) {
      bodies.set(turn.index, '(no closing message recorded for this turn)');
      continue;
    }
    const body = demoteHeadings(turn.closing);
    if (remaining >= body.length) {
      bodies.set(turn.index, body);
      remaining -= body.length;
    } else {
      bodies.set(turn.index, truncate(body, Math.max(400, remaining)));
      remaining = 0;
    }
  }
  return bodies;
}

/**
 * Build output directories drown the list: in one measured case all 25 lines
 * were `public/admin/assets/*.js` and the real source files fell off. Crowded
 * directories collapse into one line; the count is kept.
 */
function collapseByDirectory(entries: string[], threshold = 5) {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const filePath = entry.replace(/^.{2}\s+/, '').trim();
    const slash = filePath.lastIndexOf('/');
    const directory = slash === -1 ? '.' : filePath.slice(0, slash);
    const bucket = groups.get(directory);
    if (bucket) bucket.push(entry);
    else groups.set(directory, [entry]);
  }
  const lines: string[] = [];
  for (const [directory, bucket] of groups) {
    if (bucket.length > threshold) lines.push(`${directory}/ — ${bucket.length} files (collapsed)`);
    else lines.push(...bucket);
  }
  if (lines.length <= 40) return lines;
  return [...lines.slice(0, 40), `… and ${lines.length - 40} more lines`];
}

function gitSection(git: WorkspaceGitState | null) {
  if (!git) return ['- Git state was not read.'];
  if (!git.available) return [`- Git state unavailable: ${git.error || 'not a repository'}`];
  const lines = [
    `- Branch: \`${git.branch || '(unknown)'}\``,
    `- HEAD: \`${git.head || '?'}\` ${git.headSubject || ''}`.trimEnd(),
    `- Uncommitted files: ${git.dirtyCount ?? 0} · untracked: ${git.untrackedCount ?? 0}`,
  ];
  if (git.dirtyFiles?.length) {
    lines.push('- Changed files:');
    lines.push('```');
    lines.push(...collapseByDirectory(git.dirtyFiles));
    lines.push('```');
  }
  if (git.recentCommits?.length) {
    lines.push('- Recent commits:');
    lines.push('```');
    lines.push(...git.recentCommits);
    lines.push('```');
  }
  return lines;
}

export function buildHandoffMarkdown(
  thread: AgentArchiveThread,
  messages: AgentArchiveMessage[],
  git: WorkspaceGitState | null = null,
) {
  const provider = providerDisplayName(thread.provider);
  const turns = buildTurns(messages);
  const rawUserCount = messages.filter((message) => message.role === 'user').length;
  const rawReplyCount = messages.filter((message) => message.role === 'assistant').length;
  const latestTurn = turns.at(-1);
  const latestPrompt = latestTurn?.request || '(no recorded user request)';
  /**
   * The compaction warning belongs at the top.
   *
   * Turn closings from before a compaction point may not be original text;
   * the model may have read its own summary. It decides how far the next agent
   * can trust this document, so it must not be buried between detail sections.
   */
  const compactionTurns = turns.filter((turn) => turn.compactions > 0);
  const compactionCount = turns.reduce((total, turn) => total + turn.compactions, 0);

  const openTasks = extractOpenTasks(turns);
  const openQuestions = extractOpenQuestions(turns);
  const touched = collectTouchedFiles(messages);
  const bodies = allocateTurnBodies(turns, 9000);
  const dbPath = thread.archiveDbPath || '~/.switchyard/data.db';
  const resumeCommand =
    provider === 'Claude Code'
      ? `claude --resume ${thread.id}`
      : provider === 'OpenCode'
      ? `opencode --session ${thread.id}`
      : provider === 'Antigravity'
      ? `open -a Antigravity`
      : `codex resume ${thread.id}`;
  const transcriptQuery = `SELECT ordinal, role, kind, tool_name, is_error, timestamp, text FROM agent_messages WHERE session_id = '${thread.id}' ORDER BY ordinal;`;

  /**
   * Long sessions also need a cap on the NUMBER of turns.
   *
   * The budget only shortened turn bodies; the request text and tool summary
   * add a fixed cost per turn. A measured 1036-patch session produced a 157k
   * character handoff, enough to eat the next agent's whole context window.
   * Older turns shrink to one line; their full text is in the transcript.
   */
  const DETAILED_TURNS = 12;
  const detailedFrom = Math.max(0, turns.length - DETAILED_TURNS);
  const olderTurns = turns.slice(0, detailedFrom);
  const recentTurns = turns.slice(detailedFrom);

  /* In very long sessions even the one-line list grows, and the headlines of
     old turns quickly lose value. */
  const OLDER_SUMMARY_CAP = 60;
  const omittedTurns = Math.max(0, olderTurns.length - OLDER_SUMMARY_CAP);
  const olderShown = olderTurns.slice(-OLDER_SUMMARY_CAP);

  const olderSummary = olderTurns.length
    ? [
        `### Earlier ${olderTurns.length} turns (summary)`,
        ...(omittedTurns ? ['', `_The first ${omittedTurns} turns are omitted; the full list is in the transcript._`] : []),
        '',
        ...olderShown.map(
          (turn) =>
            `${turn.index + 1}. ${truncate(turn.request.replace(/\s+/g, ' '), 140)}${
              turn.tools.length ? ` — ${turn.tools.slice(0, 4).map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(', ')}` : ''
            }`,
        ),
        '',
      ]
    : [];

  const timeline = recentTurns.flatMap((turn) => [
    `### Turn ${turn.index + 1}${turn.interrupted ? ' (interrupted by the user)' : ''} — ${turn.replyCount} agent messages`,
    '',
    '**Request:**',
    '```text',
    truncate(turn.request, 700),
    '```',
    '',
    ...(turn.compactions ? [`> Warning: the context was compacted ${turn.compactions} time(s) in this turn.`, ''] : []),
    ...(turn.tools.length
      ? [
          `**Tools used:** ${turn.tools.map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(' · ')}${turn.toolErrors ? ` — ${turn.toolErrors} errors` : ''}`,
          '',
        ]
      : []),
    '**Turn closing:**',
    '',
    bodies.get(turn.index) || '(none)',
    '',
  ]);

  const document = [
    `# Session Handoff: ${thread.title}`,
    '',
    `> Generated: ${new Date().toISOString()}`,
    `> Provider: ${provider}`,
    `> Session ID: ${thread.id}`,
    '',
    '## MANDATORY FIRST STEPS',
    '- [ ] Change to the working directory and read the project instructions.',
    '- [ ] Try the native resume command below; if it fails, use the archive DB fallback.',
    '- [ ] Read the turn summaries below; do not redo finished work.',
    '- [ ] Verify the Git state; this handoff is a snapshot from when it was generated and may be stale.',
    '',
    '## Current State',
    `- Project: ${thread.project}`,
    `- Working directory: ${thread.cwd || '(unknown)'}`,
    `- Last update: ${thread.updatedAt || '(unknown)'}`,
    `- Real user turns: **${turns.length}** (raw records: ${rawUserCount} user / ${rawReplyCount} agent messages; the difference is interrupts, task notifications and system messages)`,
    `- Native source: ${thread.sourceAvailable ? 'available' : 'missing; use the archive DB fallback'}`,
    '',
    ...(compactionCount
      ? [
          '## Context Compaction',
          `The context of this session was compacted **${compactionCount} time(s)** (turn ${compactionTurns.map((turn) => turn.index + 1).join(', ')}).`,
          '',
          'Turn closings from before a compaction point may not be original text; the model may have read its own summary. Check the full transcript before relying on a detail from an early turn.',
          '',
        ]
      : []),
    '## Context Coverage / Evidence',
    '- This brief is a summary, not a lossless model-state transfer. Read the accompanying transcript/native snapshot for exact evidence.',
    `- Archived records: ${messages.length}; reasoning: ${messages.filter(m => m.kind === 'thinking').length}; tool calls: ${messages.filter(m => m.kind === 'tool_use').length}; tool results: ${messages.filter(m => m.kind === 'tool_result').length}; attachments: ${messages.filter(m => m.kind === 'attachment').length}.`,
    '- Hidden/encrypted reasoning, deleted history, live processes and remote-only state cannot be reconstructed from this document.',
    '- Tool calls indicate attempts; confirm success from results and current files. Historical permissions are not fresh authorization.',
    '',
    '### Recent recorded evidence (not a final answer)',
    ...messages.filter(m => m.kind === 'thinking' || m.kind === 'tool_result' || m.isError).slice(-6).map(m => `- [${m.kind || 'text'} ${m.id}] ${truncate(m.text.replace(/\s+/g, ' '), 500)}`),
    '',
    '## Workspace Git State',
    ...gitSection(git),
    '',
    '## Accomplished, turn by turn',
    '',
    turns.length ? '' : '(No real user turns were recorded in this session.)',
    ...olderSummary,
    ...timeline,
    '## Immediate Next Step',
    openTasks.length
      ? `${openTasks[0].text}${openTasks[0].turn === turns.length ? '' : `  _(from turn ${openTasks[0].turn}; check that it is still current)_`}`
      : latestTurn
      ? `Complete the latest request: "${truncate(latestTurn.request, 200)}"`
      : '(could not be determined; infer it from the turn summaries below.)',
    '',
    '> One next step only. Everything else is under "Open Tasks".',
    '',
    '## Critical Files',
    ...(touched.edited.length || touched.read.length || touched.mentioned.length
      ? [
          ...(touched.edited.length
            ? [
                'Edit attempts (from the tool log; confirm success with the results and Git):',
                '```',
                ...touched.edited.map(([file, count]) => (count > 1 ? `${file}  (${count}×)` : file)),
                '```',
              ]
            : []),
          ...(touched.read.length
            ? [
                'Read:',
                '```',
                ...touched.read.map(([file, count]) => (count > 1 ? `${file}  (${count}×)` : file)),
                '```',
              ]
            : []),
          ...(touched.mentioned.length
            ? [
                'Mentioned in commands:',
                '```',
                ...touched.mentioned.map(([file, count]) => (count > 1 ? `${file}  (${count}×)` : file)),
                '```',
              ]
            : []),
        ]
      : ['- No file records were found in this session.']),
    '',
    ...(openQuestions.length
      ? [
          '## Open Questions',
          '> Only the user can answer these. Ask before running into the same wall again.',
          '',
          ...openQuestions.map((question) => `- ${question}`),
          '',
        ]
      : []),
    '## Open Tasks',
    openTasks.length
      ? '> Extracted automatically from the transcript; the turn number in brackets is the source. Items from older turns may already be done; check them.'
      : '> No open-work markers were found in the transcript; these are the default checks.',
    '',
    ...(openTasks.length
      ? openTasks.map((task) => `- [ ] _(turn ${task.turn})_ ${task.text}`)
      : [
          '- [ ] Complete the latest user request.',
          '- [ ] Run the relevant tests after changing code.',
        ]),
    '',
    '## Dead Ends / Blockers',
    `- If the native source is missing, ${resumeCommand} may fail; use the archive DB fallback with the same session ID.`,
    '- The DB fallback only provides the transcript and metadata; it does not restore the provider\'s temporary tool or process state.',
    '- This handoff carries turn closings, not intermediate steps. If the reason for a decision is missing, the full transcript is in the dashboard and the DB.',
    '',
    '## Resume Instructions',
    '### 1. Native provider resume (preferred)',
    '```bash',
    `cd ${thread.cwd || '<working-directory>'}`,
    resumeCommand,
    '```',
    `Native transcript path: \`${thread.sourcePath || '(not recorded)'}\``,
    '',
    '### 2. Archive DB fallback (when the native source is missing)',
    'If the native JSONL was deleted, the account changed or the provider resume fails, the transcript is still here; the session ID is the same in both places.',
    '',
    `Archive DB: \`${dbPath}\``,
    `Session record: \`agent_sessions.id = '${thread.id}'\``,
    '',
    '```bash',
    `sqlite3 '${dbPath}' <<'SQL'`,
    '.headers on',
    '.mode markdown',
    `SELECT id, provider, title, cwd, source_path, updated_at FROM agent_sessions WHERE id = '${thread.id}';`,
    transcriptQuery,
    'SQL',
    '```',
    '',
    `Dashboard fallback URL: \`http://127.0.0.1:3010/?tab=codex&provider=${thread.provider}&session=${thread.id}\``,
    '',
    '### 3. Instruction for the new agent',
    'Read the turn summaries, verify the current project and Git state, and continue from the latest request without redoing finished work.',
    '',
    '## Latest User Request',
    '```text',
    latestPrompt,
    '```',
    '',
    '## Artifacts',
    `- Native source: ${thread.sourcePath || '(not recorded)'}`,
    `- Archive DB: ${dbPath}`,
    `- Session ID: ${thread.id}`,
    '',
    '## Environment Notes',
    `- Provider: ${provider}`,
    `- Working directory: ${thread.cwd || '(unknown)'}`,
    '- Full transcript: open the conversation in Switchyard and expand "Full conversation".',
  ].join('\n');

  /* Redact once, at the end. Cleaning section by section makes it easy to
     miss one. */
  return redactSecrets(document);
}
