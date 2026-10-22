import os from 'node:os';
import path from 'node:path';

/** Every filesystem root the server reads goes through this module. */

export function homeDir(): string {
  return os.homedir();
}

export function getDataDir(): string {
  const envDir = process.env.SWITCHYARD_DATA_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), '.switchyard');
}

/** Roaming application data on Windows (%APPDATA%). */
export function appDataDir(): string {
  return process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming');
}

/** Local application data on Windows (%LOCALAPPDATA%). */
export function localAppDataDir(): string {
  return process.env.LOCALAPPDATA || path.join(homeDir(), 'AppData', 'Local');
}

export function codexHome(): string {
  return path.resolve(process.env.CODEX_HOME || path.join(homeDir(), '.codex'));
}

export function antigravityHome(): string {
  return path.resolve(process.env.ANTIGRAVITY_HOME || path.join(homeDir(), '.gemini', 'antigravity'));
}

export function opencodeDataDir(): string {
  const value = process.env.OPENCODE_HOME || process.env.OPENCODE_DATA_DIR;
  return value ? path.resolve(value) : path.join(homeDir(), '.local', 'share', 'opencode');
}

/** Claude Desktop's data folder (accounts, scheduled tasks, Code session metadata). */
export function claudeDesktopDir(): string {
  return process.platform === 'darwin'
    ? path.join(homeDir(), 'Library', 'Application Support', 'Claude')
    : path.join(appDataDir(), 'Claude');
}

/** A read-only copy of a second machine's home (for example a synced Mac). */
export function secondaryMacHome(): string | null {
  const value = process.env.SWITCHYARD_MAC_HOME;
  return value ? path.resolve(value) : null;
}

/** IANA zone used for "today" windows; defaults to the system zone. */
export function displayTimeZone(): string {
  return process.env.SWITCHYARD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
