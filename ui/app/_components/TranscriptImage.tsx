'use client';

import { useState } from 'react';
import { ImageOff, Maximize2, X } from 'lucide-react';

type Props = {
  sessionId: string;
  assetIndex?: number;
  locale: 'tr' | 'en';
};

/**
 * Screenshot inside a transcript.
 *
 * Loaded from the source file with a separate request; image data is not
 * carried in the database or the page payload. `loading="lazy"` matters: a
 * session can hold dozens of screenshots, and downloading them all at once
 * would bring back exactly the cost we avoid.
 */
export default function TranscriptImage({ sessionId, assetIndex, locale }: Props) {
  const sourceKey = `${sessionId}:${assetIndex}`;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [retry, setRetry] = useState(0);

  if (assetIndex === undefined || failedSource === sourceKey) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 font-mono text-[11px] text-zinc-600">
        <ImageOff size={12} /> {locale === 'tr' ? 'görsel yüklenemedi' : 'image could not load'}
        {assetIndex !== undefined && <button type="button" onClick={() => {setFailedSource(null);setRetry(value=>value+1);}}>{locale==='tr'?'Tekrar dene':'Retry'}</button>}
      </div>
    );
  }

  const src = `/api/agent/image?id=${encodeURIComponent(sessionId)}&index=${assetIndex}&retry=${retry}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="group relative block overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-600"
        title={locale === 'tr' ? 'Büyütmek için tıkla' : 'Click to enlarge'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={locale === 'tr' ? 'Sohbetteki ekran görüntüsü' : 'Screenshot from the conversation'}
          loading="lazy"
          onError={() => setFailedSource(sourceKey)}
          className="max-h-[420px] w-auto max-w-full object-contain"
        />
        <span className="absolute right-2 top-2 rounded bg-black/70 p-1.5 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 size={13} />
        </span>
      </button>

      {zoomed && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomed(false); }}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label={locale === 'tr' ? 'Kapat' : 'Close'}
            className="absolute right-5 top-5 rounded-lg bg-zinc-900/90 p-2 text-zinc-300 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}
