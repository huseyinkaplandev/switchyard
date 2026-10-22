import { NextResponse } from 'next/server';
import { createHandoffPackage, packageDirectory, readHandoffPackage } from '../../../_lib/desktopHandoff/packages';
import { resolveTimeWindow } from '../../../_lib/desktopHandoff/activity';
import { displayTimeZone } from '../../../_lib/paths';
import { getDataDir } from '../../../_lib/paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sameLocalOrigin } from '../../../_lib/desktopHandoff/origin';
export const dynamic = 'force-dynamic';
export async function GET() {
  const names = await fs.readdir(path.join(getDataDir(), 'desktop-handoffs')).catch(() => []);
  const packages = [];
  for (const id of names) { try { packageDirectory(id); packages.push(await readHandoffPackage(id)); } catch { /* staging or incomplete package */ } }
  return NextResponse.json({ packages: packages.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,50) });
}
export async function POST(request: Request) {
  if (!sameLocalOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  try {
    const body = await request.json();
    const window = resolveTimeWindow(body.time ?? 'all', new Date().toISOString(), displayTimeZone(), body.custom);
    return NextResponse.json(await createHandoffPackage(body.keys, body.targetProvider, window), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Package failed' }, { status: 400 }); }
}
