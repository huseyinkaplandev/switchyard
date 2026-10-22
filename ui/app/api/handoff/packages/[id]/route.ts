import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readHandoffPackage, getPackageProgress, packageDirectory } from '../../../../_lib/desktopHandoff/packages';
import { sameLocalOrigin } from '../../../../_lib/desktopHandoff/origin';
import { getDesktopRuntime, startDesktopAction } from '../../../../_lib/desktopHandoff/runtime';
import { isDemoMode } from '../../../../_lib/paths';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ package: await readHandoffPackage(id), progress: await getPackageProgress(id), runtime: await getDesktopRuntime(id), directSupported: process.platform==='win32'||isDemoMode(), demo: isDemoMode(), bootstrapText: await fs.readFile(path.join(packageDirectory(id), 'bootstrap.txt'), 'utf8') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Package unavailable' }, { status: 404 }); }
}
export async function POST(request: Request, context: Context) {
  if (!sameLocalOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  try {
    const { id } = await context.params; await readHandoffPackage(id);
    const body = await request.json();
    if(body.action==='start'||body.action==='open')return NextResponse.json(await startDesktopAction(id,body.action,body.itemId),{status:202});
    if (body.action !== 'stop') throw new Error('Invalid action');
    await fs.writeFile(path.join(packageDirectory(id), 'stop'), new Date().toISOString());
    return NextResponse.json({ stopping: true });
  } catch(error) { return NextResponse.json({ error: error instanceof Error?error.message:'Invalid package action' }, { status: 400 }); }
}
