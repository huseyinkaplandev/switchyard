import { NextResponse } from 'next/server';
import { listLocalSessions } from '@/app/_lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ sessions: await listLocalSessions() });
}
