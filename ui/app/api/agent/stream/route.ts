import fs from 'node:fs';
import {
  getAgentThread,
  getAgentThreadMessages,
  readAgentMessagesFromSource,
  tailAgentMessages,
} from '../../../_lib/agentArchive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** If a file event is missed, the change is noticed after this long at most. */
const SAFETY_POLL_MS = 1000;
/** Keeps intermediaries from dropping the connection as dead. */
const HEARTBEAT_MS = 15000;
/** fs.watch emits several events per write; avoids repeating the same tick. */
const DEBOUNCE_MS = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('id required', { status: 400 });

  const initialThread = getAgentThread(id);
  if (!initialThread) return new Response('unknown session', { status: 404 });
  let thread = initialThread;

  const fromOrdinal = Math.max(0, Number(url.searchParams.get('fromOrdinal') || 0));

  const encoder = new TextEncoder();
  let closed = false;
  let dispose: (() => void) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let byteOffset = 0;
      let ordinalCount = 0;
      let assetCount = 0;
      let running = false;
      let pending = false;

      /**
       * OpenCode is a SQLite database, not a file; it cannot be tailed.
       * Reading the full list and sending everything after the known
       * position is the only option. For others this path runs only on the first tick.
       */
      const readAll = async () => {
        if (thread.provider === 'opencode') {
          const all = getAgentThreadMessages(id);
          const fresh = all.slice(ordinalCount || fromOrdinal);
          ordinalCount = all.length;
          send('snapshot', { messages: all, ordinalCount });
          return fresh;
        }
        const full = await readAgentMessagesFromSource(id);
        if (!full) return [];
        byteOffset = full.byteOffset;
        ordinalCount = full.ordinalCount;
        assetCount = full.assetCount || 0;
        send('snapshot', { messages: full.messages, ordinalCount });
        return full.messages.slice(fromOrdinal);
      };

      const pump = async () => {
        if (closed) return;
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          const currentThread = getAgentThread(id);
          if (currentThread && currentThread.sourcePath !== thread.sourcePath) {
            thread = currentThread;
            byteOffset = 0;
          }
          let fresh;
          if (thread.provider === 'opencode' || byteOffset === 0) {
            fresh = await readAll();
          } else {
            const tail = await tailAgentMessages(id, byteOffset, ordinalCount, assetCount);
            // If the file shrank (rewritten), tailing is meaningless: read from the start.
            if (!tail) {
              byteOffset = 0;
              fresh = await readAll();
            } else {
              byteOffset = tail.byteOffset;
              ordinalCount = tail.ordinalCount;
              assetCount = tail.assetCount ?? assetCount;
              fresh = tail.messages;
            }
          }
          if (fresh.length) send('messages', { messages: fresh, ordinalCount });
        } catch {
          // One failed tick does not end the stream; the next tick retries.
        } finally {
          running = false;
          if (pending) {
            pending = false;
            void pump();
          }
        }
      };

      send('open', { id, provider: thread.provider });
      await pump();
      send('ready', { ordinalCount });

      let debounce: NodeJS.Timeout | null = null;
      let watcher: fs.FSWatcher | null = null;
      if (thread.sourcePath && thread.provider !== 'opencode') {
        try {
          watcher = fs.watch(thread.sourcePath, () => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => void pump(), DEBOUNCE_MS);
          });
        } catch {
          // fs.watch is not reliable on every file system; the safety tick covers it.
        }
      }

      const safety = setInterval(() => void pump(), SAFETY_POLL_MS);
      const heartbeat = setInterval(() => send('ping', { t: Date.now() }), HEARTBEAT_MS);

      const cleanup = () => {
        closed = true;
        clearInterval(safety);
        clearInterval(heartbeat);
        if (debounce) clearTimeout(debounce);
        watcher?.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener('abort', cleanup);
      dispose = cleanup;
      if (request.signal.aborted || closed) cleanup();
    },
    cancel() {
      closed = true; dispose?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
