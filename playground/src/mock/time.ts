const MINUTE = 60_000;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;

/** Minutes between local midnight and now, as fixtures/demo/build.mjs computes it. */
export function todaySpanMinutes(now: number) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.max(6, Math.floor((now - midnight.getTime()) / MINUTE) - 2);
}

/**
 * Moves a snapshot timestamp to the viewer's clock.
 *
 * The snapshot stores absolute times from the moment it was generated. Each one keeps its distance
 * from that moment; items from the last few hours are squeezed into today exactly like the fixture
 * builder does, so "today" filters stay true early in the morning too.
 */
export function createClock(generatedAt: number, generatedSpan: number, now = Date.now()) {
  const span = todaySpanMinutes(now);
  return (time: number) => {
    const minutesAgo = (generatedAt - time) / MINUTE;
    if (minutesAgo < 0 || minutesAgo > 600) return now - minutesAgo * MINUTE;
    const original = generatedSpan < 180 ? (minutesAgo * 180) / generatedSpan : minutesAgo;
    return now - Math.min(original, (span * original) / 180) * MINUTE;
  };
}

/** Rewrites every ISO timestamp inside a JSON-like value, including ones embedded in text. */
export function shiftTimes<T>(value: T, shift: (time: number) => number): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return item.replace(ISO, (match) => new Date(shift(Date.parse(match))).toISOString());
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
    return item;
  };
  return walk(value) as T;
}

/** `[YYYY-MM-DD HH:MM]` in local time, the LIVE_LOG.md prefix. */
export function logStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
