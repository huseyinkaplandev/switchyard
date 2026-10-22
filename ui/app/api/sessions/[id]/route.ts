import { NextResponse } from 'next/server';
import { getLocalSession, localSessionRevision } from '@/app/_lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revision = await localSessionRevision(id);
  if (revision && request.headers.get('if-none-match') === revision) return new Response(null, { status: 304, headers: { ETag: revision } });
  const result = await getLocalSession(id);
  return result ? NextResponse.json(result, { headers: { ...(revision ? { ETag: revision } : {}), 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Session not found' }, { status: 404 });
}
