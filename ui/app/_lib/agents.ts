export type AgentId =
  | 'codex' | 'claude-code' | 'cursor' | 'vscode'
  | 'vscode-insiders' | 'opencode' | 'antigravity' | 'kiro';

export type Agent = Readonly<{
  id: AgentId;
  name: string;
  vendor: string;
  color: string;       // hex accent for cards
  initial: string;     // logo placeholder
}>;

export const AGENTS: readonly Agent[] = [
  { id: 'codex',           name: 'Codex',            vendor: 'OpenAI',     color: '#10a37f', initial: 'CX' },
  { id: 'claude-code',     name: 'Claude Code',      vendor: 'Anthropic',  color: '#d97757', initial: 'CC' },
  { id: 'cursor',          name: 'Cursor',           vendor: 'Cursor',     color: '#e4e4e7', initial: 'CU' },
  { id: 'vscode',          name: 'VS Code',          vendor: 'Microsoft',  color: '#007acc', initial: 'VS' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', vendor: 'Microsoft',  color: '#24bfa5', initial: 'VI' },
  { id: 'opencode',        name: 'OpenCode',         vendor: 'OpenCode',   color: '#a855f7', initial: 'OC' },
  { id: 'antigravity',     name: 'Antigravity',      vendor: 'Google',     color: '#4285f4', initial: 'AG' },
  { id: 'kiro',            name: 'Kiro',             vendor: 'AWS',        color: '#ff9900', initial: 'KR' },
];
