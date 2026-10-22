import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, unlink, stat } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

async function cleanupOldUploads(dir: string) {
  const now = Date.now();
  const files = await readdir(dir).catch(() => []);
  for (const file of files) {
    const fp = path.join(dir, file);
    try {
      const s = await stat(fp);
      if (now - s.mtimeMs > MAX_AGE_MS) {
        await unlink(fp);
      }
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    const ext = file.type.split('/')[1] || 'png';
    const name = `pasted-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    
    // Clean up files older than 1 week before saving new one
    await cleanupOldUploads(uploadDir);

    const filePath = path.join(uploadDir, name);
    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${name}` });
  } catch (err) {
    console.error('Upload failed:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
