import { NextResponse } from 'next/server';
import { storeMessageImage, readMessageImage } from '../../../../_lib/messageImages';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const origin = new URL(request.headers.get('origin') || '');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.get('host')) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
    if (Number(request.headers.get('content-length')) > 6 * 1024 * 1024) return NextResponse.json({ error: 'image_limit' }, { status: 413 });
    const data = await request.formData();
    const image = data.get('image');
    if (!(image instanceof File)) throw new Error('image_type');
    return NextResponse.json(await storeMessageImage(image));
  } catch (error) { return NextResponse.json({ error: error instanceof Error && ['image_limit','image_type'].includes(error.message) ? error.message : 'image_failed' }, { status: 400 }); }
}
export async function GET(request: Request) {
  try {
    const image = await readMessageImage(new URL(request.url).searchParams.get('id') || '');
    return new Response(new Uint8Array(image.bytes), { headers: { 'Content-Type': image.type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Image not found', { status: 404 }); }
}
