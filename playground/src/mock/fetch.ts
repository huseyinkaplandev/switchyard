import {
  archiveStatus, cancelJob, copySchedulesToCodex, createPackage, currentJob, jobs, packageDetail, handoff, schedules,
  snapshot, startDelivery, startJob, stopDelivery, syncArchive, toggleSchedule,
} from './store';

type Body = Record<string, unknown>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const captured = (value: { status: number; body: unknown } | undefined) => value ? json(value.body, value.status) : json({ error: 'unknown session' }, 404);
const latency = () => new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 120));

async function readBody(init?: RequestInit): Promise<Body> {
  if (typeof init?.body !== 'string') return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

/** Answers the routes under ui/app/api the way the real server answers them in demo mode. */
async function route(url: URL, method: string, init?: RequestInit): Promise<Response> {
  const path = url.pathname;
  const query = url.searchParams;
  const body = method === 'GET' ? {} : await readBody(init);

  if (path === '/api/agent/sync') return method === 'POST' ? json(syncArchive()) : json(archiveStatus());
  if (path === '/api/agent/focus' && method === 'POST') {
    const result = snapshot.focus[String(body.provider)];
    return result ? captured(result) : json({ error: 'Invalid provider.' }, 400);
  }
  if (path === '/api/handoff/snapshot' && method === 'POST') return captured(snapshot.handoffSnapshots[String(body.id)]);
  if (path === '/api/handoff/catalog') return json(snapshot.catalog);

  if (path === '/api/agent/message') {
    if (method === 'GET' && query.has('job')) {
      const job = jobs.get(query.get('job') || '');
      return job ? json({ job: { ...job } }) : json({ error: 'not_found' }, 404);
    }
    if (method === 'GET') {
      const id = query.get('id') || '';
      const capability = snapshot.composer[id];
      if (!capability) return json({ supported: false, reason: 'unknown_session' });
      return json({ ...capability.body, job: currentJob(id) });
    }
    if (method === 'POST') {
      const id = String(body.id ?? ''), message = String(body.message ?? ''), requestId = String(body.requestId ?? '');
      const capability = snapshot.composer[id]?.body as { supported?: boolean; provider?: string } | undefined;
      if (!capability?.supported || !message.trim() || !requestId) return json({ error: 'invalid_request' }, 400);
      if (Array.isArray(body.images) && body.images.length) return json({ error: 'image_failed' }, 400);
      return json({ job: { ...startJob(id, capability.provider ?? 'codex', message, requestId) } }, 202);
    }
    if (method === 'DELETE') {
      const job = cancelJob(String(body.job ?? ''));
      return job ? json({ job: { ...job } }) : json({ error: 'not_found' }, 404);
    }
  }
  if (path === '/api/agent/message/image') return json({ error: 'image_failed' }, 400);

  if (path === '/api/schedules') {
    if (method === 'GET') return json(schedules);
    if (method === 'PATCH') return toggleSchedule(body as never) ? json({ ok: true }) : json({ error: 'Task not found' }, 400);
    if (body.action === 'install') return captured(snapshot.schedulesInstall);
    if (body.action === 'save-skills') return captured(snapshot.schedulesSaveSkills);
    if (body.action === 'copy-to-codex') return json(copySchedulesToCodex(Array.isArray(body.ids) ? body.ids.map(String) : undefined));
    return json({ error: 'Invalid request' }, 400);
  }

  if (path === '/api/handoff/packages') {
    if (method === 'GET') return json({ packages: handoff.packages });
    try {
      const pkg = createPackage(body.keys, body.targetProvider);
      return json(packageDetail(pkg.id), 201);
    } catch (error) { return json({ error: (error as Error).message }, 400); }
  }
  const packageMatch = path.match(/^\/api\/handoff\/packages\/([^/]+)$/);
  if (packageMatch) {
    const id = decodeURIComponent(packageMatch[1]);
    if (method === 'GET') { const detail = packageDetail(id); return detail ? json(detail) : json({ error: 'Package unavailable' }, 404); }
    try {
      if (!packageDetail(id)) throw new Error('Package unavailable');
      if (body.action === 'start' || body.action === 'open') return json(startDelivery(id, body.action, body.itemId as string | undefined), 202);
      if (body.action !== 'stop') throw new Error('Invalid action');
      return json(stopDelivery(id));
    } catch (error) { return json({ error: (error as Error).message }, 400); }
  }

  return json({ error: 'Not available in the playground' }, 404);
}

/**
 * Stand-in for `fetch` inside the bundled Switchyard components (injected per module by the Vite
 * config, so the host page's own `fetch` is never patched). `/api/**` is answered in memory;
 * anything else goes to the real `fetch`.
 */
export async function playgroundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, 'http://playground.invalid');
  if (url.origin !== 'http://playground.invalid' || !url.pathname.startsWith('/api/')) return fetch(input, init);
  await latency();
  return route(url, (init?.method || 'GET').toUpperCase(), init);
}
