import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from './paths';
const root = () => path.join(getDataDir(), 'message-images');
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$/i;
export async function storeMessageImage(file: File) {
  if (file.size < 12 || file.size > 5 * 1024 * 1024) throw new Error('image_limit');
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
  if (!ext) throw new Error('image_type');
  const id = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(root(), id), bytes, { mode: 0o600, flag: 'wx' });
  return { id, url: `/api/agent/message/image?id=${id}` };
}
export async function resolveMessageImages(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string' || !validId.test(id))) throw new Error('image_limit');
  return Promise.all(ids.map(async id => {
    const file = path.join(root(), id);
    const [realFile, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root())]);
    if (path.dirname(realFile) !== realRoot) throw new Error('image_limit');
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error('image_limit');
    return file;
  }));
}
export async function readMessageImage(id: string) {
  const [file] = await resolveMessageImages([id]);
  return { bytes: await fs.readFile(file), type: id.endsWith('.jpg') ? 'image/jpeg' : id.endsWith('.webp') ? 'image/webp' : 'image/png' };
}
