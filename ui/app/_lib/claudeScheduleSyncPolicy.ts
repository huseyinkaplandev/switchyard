type Status = { exportedFrom?: string | null; accounts: Array<{ key: string; live: boolean; valid: boolean | string; missing: string[]; notEnabled: string[] }> };
type State = { lastAccount: string; needsInstall?: boolean };
/** A newly opened stale destination must never become the authoritative source. */
export function scheduleCaptureSource(current: string, state: State | null, status: Status): string | null {
  if (state?.lastAccount && state.lastAccount !== current && status.accounts.some(a => a.key === state.lastAccount)) return state.lastAccount;
  const live = status.accounts.find(a => a.live);
  const matches = live?.valid === true && !live.missing.length && !live.notEnabled.length;
  if (status.exportedFrom === current || (state?.lastAccount === current && !state.needsInstall) || matches) return current;
  return null;
}
