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
