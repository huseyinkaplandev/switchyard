import { NextResponse } from 'next/server';
import { MessageError, resolveMessageTarget, currentMessageJob, readMessageJob, startMessageJob, stopMessageJob, blockedMessageReason } from '../../../_lib/sessionMessaging';
import { resolveMessageImages } from '../../../_lib/messageImages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get('origin') || '');
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.get('host');
  } catch { return false; }
}
function failure(error: unknown) {
  if (error instanceof MessageError) return NextResponse.json({ error: error.code }, { status: error.status });
  console.error('Session message transport failed', error instanceof Error ? error.message : 'unknown');
  return NextResponse.json({ error: 'transport_failed' }, { status: 500 });
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('job')) return NextResponse.json({ job: await readMessageJob(params.get('job') || '') });
    const target = await resolveMessageTarget(params.get('kind') || '', params.get('id') || '');
    const job = await currentMessageJob(target.targetKey);
    return NextResponse.json({ supported: true, provider: target.provider, nativeId: target.nativeId, job, blockedReason: await blockedMessageReason(target, job) });
  } catch (error) {
    if (error instanceof MessageError && error.code !== 'invalid_request') return NextResponse.json({ supported: false, reason: error.code });
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 100_000) throw new MessageError('invalid_request', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new MessageError('invalid_request'); }
    if (!body || typeof body !== 'object') throw new MessageError('invalid_request');
    if (typeof body.id !== 'string' || typeof body.kind !== 'string' || typeof body.requestId !== 'string' || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 32_000) throw new MessageError('invalid_request');
    const target = await resolveMessageTarget(body.kind, body.id);
    // A retry of an accepted request must return that job, even during its turn.
    try {
      const previous = await readMessageJob(body.requestId);
      if (previous.targetKey !== target.targetKey) throw new MessageError('conflict', 409);
      return NextResponse.json({ job: previous }, { status: 202 });
    } catch (error) { if (!(error instanceof MessageError) || error.status !== 404) throw error; }
    await resolveMessageTarget(body.kind, body.id, true);
    let images: string[];
    try { images = await resolveMessageImages(body.images || []); } catch { throw new MessageError('invalid_request'); }
    if (images.length && target.provider !== 'codex') throw new MessageError('unsupported');
    return NextResponse.json({ job: await startMessageJob(target, body.message, body.requestId, images) }, { status: 202 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  try {
    let body;
    try { body = await request.json(); } catch { throw new MessageError('invalid_request'); }
    if (!body || typeof body !== 'object') throw new MessageError('invalid_request');
    if (typeof body.job !== 'string') throw new MessageError('invalid_request');
    return NextResponse.json({ job: await stopMessageJob(body.job) });
  } catch (error) { return failure(error); }
}
