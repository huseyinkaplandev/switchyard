/** Next may normalize a loopback request URL to localhost. Keep port/scheme isolation. */
export function sameLocalOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get('origin') || '');
    const target = new URL(request.url);
    const loopback = (name: string) => ['localhost','127.0.0.1','[::1]'].includes(name);
    return origin.protocol === target.protocol && origin.port === target.port && loopback(origin.hostname) && loopback(target.hostname);
  } catch { return false; }
}
