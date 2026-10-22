import { readTranscriptLocalImage } from '../../../_lib/transcriptLocalImage';
import { readFile } from 'node:fs/promises';
import { getAgentThread, getAgentSourcePaths } from '../../../_lib/agentArchive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serves an image from the source transcript.
 *
 * Image data is not written to the database: a single screenshot is hundreds
 * of KB of base64, and putting it in the page payload once pushed the page
 * to hundreds of MB. Here it is decoded in a separate request, only for the
 * image actually viewed; the browser caches it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const messageId = url.searchParams.get('messageId');
  if (messageId) {
    const image = await readTranscriptLocalImage(messageId, Number(url.searchParams.get('reference') ?? '-1'));
    if (!image) return new Response('image reference unavailable', {status:404});
    return new Response(new Uint8Array(image.bytes), {headers:{'Content-Type':image.type,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}});
  }
  const id = url.searchParams.get('id');
  const index = Number(url.searchParams.get('index') ?? '-1');
  if (!id || !Number.isInteger(index) || index < 0) {
    return new Response('id and index required', { status: 400 });
  }

  const thread = getAgentThread(id);
  if (!thread?.sourcePath) return new Response('unknown session', { status: 404 });

  let text: string;
  try {
    text = (await Promise.all((await getAgentSourcePaths(id)).map(file => readFile(file, 'utf8')))).join('\n');
  } catch {
    return new Response('source unavailable', { status: 404 });
  }

  let seen = 0;
  if (thread.provider === 'codex') {
    for (const line of text.split('\n')) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type !== 'response_item' || record.payload?.type !== 'message' || !['user','assistant'].includes(record.payload.role)) continue;
      for (const part of Array.isArray(record.payload.content) ? record.payload.content : []) {
        if (part?.type !== 'input_image') continue;
        if (seen++ !== index) continue;
        const match = typeof part.image_url === 'string' ? part.image_url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i) : null;
        if (!match || match[2].length > 30_000_000) return new Response('unsupported', { status: 415 });
        return new Response(new Uint8Array(Buffer.from(match[2], 'base64')), { headers: { 'Content-Type': match[1], 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    return new Response('not found', { status: 404 });
  }
  for (const line of text.split('\n')) {
    if (!line.trim() || !line.includes('"image"')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    /* Must count the SAME records as the parser: the index comes from the
       same count on both sides. The parser skips meta records and compaction
       summaries; if they are not skipped here, the index shifts to another image. */
    if (!isRecord(record) || !isRecord(record.message)) continue;
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    if (record.isMeta === true || record.isCompactSummary === true) continue;
    const content = record.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) continue;
      if (seen++ !== index) continue;
      const source = block.source;
      const mediaType = typeof source.media_type === 'string' ? source.media_type : '';
      const data = typeof source.data === 'string' ? source.data : '';
      // Known image types only; even with a trusted source file, sending the
      // browser an arbitrary content-type is needless risk.
      if (!ALLOWED_TYPES.has(mediaType) || !data) return new Response('unsupported', { status: 415 });
      const bytes = Buffer.from(data, 'base64');
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': mediaType,
          'Content-Length': String(bytes.length),
          // Transcripts are append-only: an image, once written, never changes.
          'Cache-Control': 'private, max-age=31536000, immutable',
          /* A `sandbox` CSP would be wrong here: applied to an image response,
             the browser does not render the image at all. For a same-origin
             image the right protection is to stop the browser from sniffing
             the content-type. */
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }
  return new Response('not found', { status: 404 });
}
