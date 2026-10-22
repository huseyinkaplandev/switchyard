import os from 'node:os';
import path from 'node:path';

/**
 * Every filesystem root the server reads goes through this module.
 *
 * Demo mode (SWITCHYARD_DEMO=1) swaps the home directory for a generated
 * fixture home, ignores the provider override variables and refuses to run
 * when that fixture home would resolve to the real user profile. That keeps
 * screenshots and demos from ever touching real conversations.
 */

export function isDemoMode(): boolean {
  return process.env.SWITCHYARD_DEMO === '1';
}

function realHome(): string {
  try { return os.userInfo().homedir; } catch { return os.homedir(); }
}

export function demoRoot(): string {
  return path.resolve(process.env.SWITCHYARD_DEMO_ROOT || path.join(process.cwd(), '..', '.demo'));
}

export function homeDir(): string {
  if (!isDemoMode()) return os.homedir();
  const home = path.join(demoRoot(), 'home');
  if (path.resolve(home).toLowerCase() === path.resolve(realHome()).toLowerCase()) {
    throw new Error('Demo mode refuses to use the real home directory');
  }
  return home;
}

export function getDataDir(): string {
  if (isDemoMode()) return path.join(demoRoot(), 'data');
  const envDir = process.env.SWITCHYARD_DATA_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), '.switchyard');
}

/** Roaming application data on Windows (%APPDATA%). */
export function appDataDir(): string {
  if (isDemoMode() || !process.env.APPDATA) return path.join(homeDir(), 'AppData', 'Roaming');
  return process.env.APPDATA;
}

/** Local application data on Windows (%LOCALAPPDATA%). */
export function localAppDataDir(): string {
  if (isDemoMode() || !process.env.LOCALAPPDATA) return path.join(homeDir(), 'AppData', 'Local');
  return process.env.LOCALAPPDATA;
}

function override(name: string): string | undefined {
  return isDemoMode() ? undefined : process.env[name] || undefined;
}

export function codexHome(): string {
  return path.resolve(override('CODEX_HOME') || path.join(homeDir(), '.codex'));
}

export function antigravityHome(): string {
  return path.resolve(override('ANTIGRAVITY_HOME') || path.join(homeDir(), '.gemini', 'antigravity'));
}

export function opencodeDataDir(): string {
  const value = override('OPENCODE_HOME') || override('OPENCODE_DATA_DIR');
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
  const value = override('SWITCHYARD_MAC_HOME');
  return value ? path.resolve(value) : null;
}

/** IANA zone used for "today" windows; defaults to the system zone. */
export function displayTimeZone(): string {
  return process.env.SWITCHYARD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
