import { NextResponse } from 'next/server';
import { getHandoffCatalog } from '../../../_lib/desktopHandoff/catalog';
import { resolveTimeWindow, withinWindow } from '../../../_lib/desktopHandoff/activity';
import { displayTimeZone } from '../../../_lib/paths';
import type { TimePreset } from '../../../_lib/desktopHandoff/types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const window = resolveTimeWindow((query.get('time') || 'all') as TimePreset, new Date().toISOString(), displayTimeZone(), { from: query.get('from') || '', to: query.get('to') || '' });
    const result = await getHandoffCatalog();
    return NextResponse.json({ ...result, candidates: result.candidates.filter(c => withinWindow(c.activityAt, window)), window }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Catalog failed' }, { status: 400 }); }
}
