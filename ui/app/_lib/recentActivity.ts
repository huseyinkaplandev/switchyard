/** Only real message timestamps qualify; file metadata is deliberately excluded. */
export function recentActivity(at: string | null | undefined, now: number) {
  if (!at || !now) return null;
  const elapsed = now - Date.parse(at);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 120 * 60_000) return null;
  return { minutes: Math.floor(elapsed / 60_000), hot: elapsed < 15 * 60_000 };
}
