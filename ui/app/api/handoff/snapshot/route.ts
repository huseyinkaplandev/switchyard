import { NextResponse } from 'next/server';
import { createContextSnapshot } from '../../../_lib/handoffSnapshot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try {
    if (!origin || !host || new URL(origin).host !== host) return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 });
    const input = await request.json();
    if (typeof input.id !== 'string' || input.id.length > 200) return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    return NextResponse.json(await createContextSnapshot(input.id));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Snapshot failed' }, { status: 400 }); }
}
