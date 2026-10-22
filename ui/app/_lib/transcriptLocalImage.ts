import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentThread, getAgentThreadMessages } from './agentArchive';
import { localImageReference, markdownImageReferences } from './transcriptImageUrls';

/** Resolve only references already present in the selected archived message. */
export async function readTranscriptLocalImage(messageId: string, index: number) {
  const match = messageId.match(/^(codex|claude-code|opencode|antigravity):([^:]+):\d+$/);
  if (!match || !Number.isInteger(index) || index < 0) return null;
  const thread = getAgentThread(match[2]);
  if (!thread || thread.provider !== match[1]) return null;
  const message = getAgentThreadMessages(thread.id).find(message => message.id === messageId);
  const reference = message && markdownImageReferences(message.text)[index];
  if (!reference || !localImageReference(reference)) return null;
  let file = reference;
  try {
    file = /^file:/i.test(file) ? fileURLToPath(file) : decodeURIComponent(file);
    if (/^\/[a-z]:[\\/]/i.test(file)) file = file.slice(1);
    if (!path.isAbsolute(file)) file = path.resolve(thread.cwd, file);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    const bytes = await fs.readFile(file);
    const type = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : bytes.toString('ascii',0,6).match(/^GIF8[79]a$/) ? 'image/gif'
      : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null;
    return type ? { bytes, type } : null;
  } catch { return null; }
}
