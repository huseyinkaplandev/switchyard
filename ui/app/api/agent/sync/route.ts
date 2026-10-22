import { NextResponse } from 'next/server';
import { getAgentArchiveStatus, syncAgentSessions } from '../../../_lib/agentArchive';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getAgentArchiveStatus());
}

export async function POST() {
  try {
    return NextResponse.json(await syncAgentSessions());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed.' }, { status: 500 });
  }
}
