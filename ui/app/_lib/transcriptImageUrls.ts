export function markdownImageReferences(text: string): string[] {
  return [...text.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\n)]+))\)/g)]
    .map(match => (match[1] || match[2]).trim().replace(/\s+["'][^"']*["']$/, ''));
}

export function localImageReference(url: string): boolean {
  return !/^(?:https?:|data:|blob:|\/\/|\/api\/)/i.test(url)
    && /\.(?:png|jpe?g|gif|webp)$/i.test(url);
}

export function transcriptImageUrl(url: string, text: string, messageId?: string): string | null {
  if (!messageId || !localImageReference(url)) return null;
  const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
  const index = markdownImageReferences(text).findIndex(reference => decode(reference) === decode(url));
  return index < 0 ? null : `/api/agent/image?messageId=${encodeURIComponent(messageId)}&reference=${index}`;
}
