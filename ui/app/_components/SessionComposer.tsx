'use client';

import { useEffect, useRef, useState } from 'react';
import { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import { ArrowUp, Loader2, Square, Paperclip, X } from 'lucide-react';
import AssistantMessage from './assistant-ui/AssistantMessage';
import { TRANSLATIONS, type Locale } from '../_lib/translations';

type Job = { id: string; status: string; output: string; error: string };
type Capability = { supported: boolean; reason?: string; blockedReason?: string; provider?: string; nativeId?: string; job?: Job };
export default function SessionComposer({ kind, sessionId, providerLabel, locale, onComplete, knownMessages }: {
  kind: 'archive' | 'local'; sessionId: string; providerLabel: string; locale: Locale; onComplete?: () => Promise<void> | void;
  knownMessages?: Array<{ role: string; text: string }>;
}) {
  const t = TRANSLATIONS[locale];
  const [capability, setCapability] = useState<Capability | null>(null);
  const [draft, setDraft] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<Array<{ id: string; url: string; name: string }>>([]);
  const previewImages = useRef<Array<{url:string}>>([]);
  useEffect(() => {
    for (const image of previewImages.current) if (!images.some(next => next.url === image.url) && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
    previewImages.current = images;
  }, [images]);
  useEffect(() => () => { for (const image of previewImages.current) if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url); }, []);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ id: string; text: string; imageKey: string } | null>(null);
  const inFlight = useRef(false);
  const completed = useRef('');
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const storageKey = `session-message:${kind}:${sessionId}`;
  const busy = sending || job?.status === 'starting' || job?.status === 'running';
  function reason(code: string) {
    const labels: Record<string, string> = {
      unsupported: t.composerUnsupported, remote_copy: t.composerRemote, source_missing: t.composerSourceMissing,
      workspace_missing: t.composerWorkspaceMissing, cli_missing: t.composerCliMissing, session_busy: t.composerBusy,
      unknown_session: t.composerSourceMissing, worker_stopped: t.composerStopped, cancelled: t.composerStopped,
      timeout: t.composerTimeout, transport_failed: t.composerFailed,
      invalid_origin: t.composerFailed, invalid_request: t.composerFailed, conflict: t.composerBusy,
      active_writer: t.composerActiveWriter, image_limit: t.composerImageLimit, image_type: t.composerImageType, image_failed: t.composerImageFailed,
    };
    return labels[code] || code || t.composerFailed;
  }
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/agent/message?kind=${kind}&id=${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'transport_failed');
        if (!alive) return;
        setCapability(data);
        if (data.job) setJob(data.job);
        const saved = sessionStorage.getItem(storageKey);
        if (saved && !data.job) {
          const response = await fetch(`/api/agent/message?job=${encodeURIComponent(saved)}`, { signal: controller.signal, cache: 'no-store' });
          if (response.ok) { const result = await response.json(); if (alive) setJob(result.job); }
        }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : 'transport_failed'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [kind, sessionId, storageKey]);

  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/agent/message?kind=${kind}&id=${encodeURIComponent(sessionId)}`, { cache: 'no-store', signal: controller.signal });
        if (response.ok && alive) setCapability(await response.json());
      } catch {}
      if (alive) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 5000);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [kind, sessionId]);

  async function attach(files: File[]) {
    if (!files.length || busy || uploading || uploadLock.current) return;
    if (capability?.provider !== 'codex') { setError(t.composerImageCodex); return; }
    if (files.length + images.length > 4 || files.some(file => file.size > 5 * 1024 * 1024)) { setError('image_limit'); return; }
    uploadLock.current = true; setUploading(true); setError('');
    try {
      for (const file of files) {
        const data = new FormData(); data.set('image', file);
        const response = await fetch('/api/agent/message/image', { method: 'POST', body: data });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'image_failed');
        setImages(current => [...current, { ...result, url: URL.createObjectURL(file), name: file.name || t.composerScreenshot }]);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'image_failed'); }
    finally { uploadLock.current = false; setUploading(false); }
  }

  useEffect(() => {
    if (!job || (job.status !== 'starting' && job.status !== 'running')) return;
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/agent/message?job=${encodeURIComponent(job.id)}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'transport_failed');
        if (!alive) return;
        setJob(data.job);
        if (data.job.status === 'starting' || data.job.status === 'running') timer = setTimeout(poll, 800);
      } catch (err) { if (alive) { setError(err instanceof Error ? err.message : 'transport_failed'); timer = setTimeout(poll, 3000); } }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job || job.status === 'starting' || job.status === 'running' || completed.current === job.id) return;
    completed.current = job.id;
    sessionStorage.removeItem(storageKey);
    if (job.status !== 'completed') { setError(job.error || 'transport_failed'); if (attempt.current) setDraft(attempt.current.text); attempt.current = null; }
    else {
      setError(''); attempt.current = null; setImages([]);
      Promise.resolve(onCompleteRef.current?.()).then(() => { setSubmitted(''); setJob(null); }).catch(() => setError(t.composerRefreshFailed));
    }
  }, [job, storageKey, t.composerRefreshFailed]);

  async function send(override?: string) {
    const message = (override ?? draft).trim() || (images.length ? t.composerImagePrompt : '');
    if (!message || busy || uploading || inFlight.current || !capability?.supported || capability.blockedReason) return;
    inFlight.current = true; setSending(true); setError('');
    const imageKey = images.map(image => image.id).join(',');
    if (!attempt.current || attempt.current.text !== message || attempt.current.imageKey !== imageKey) attempt.current = { id: crypto.randomUUID(), text: message, imageKey };
    const requestId = attempt.current.id;
    sessionStorage.setItem(storageKey, requestId);
    try {
      const response = await fetch('/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: sessionId, message, requestId, images: images.map(image => image.id) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'transport_failed');
      setSubmitted(message); setJob(result.job); setDraft('');
    } catch (err) { setError(err instanceof Error ? err.message : 'transport_failed'); }
    finally { setSending(false); inFlight.current = false; }
  }
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [], isRunning: !!busy, isDisabled: loading || !capability?.supported,
    isSendDisabled: !!capability?.blockedReason || uploading,
    onNew: async message => { await send(message.content.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '').join('\n')); },
    onCancel: async () => { if (!job) return; try { const response = await fetch('/api/agent/message', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: job.id }) }); if (!response.ok) throw new Error(); } catch { setError('transport_failed'); } },
  });
  useEffect(() => { runtime.thread.composer.setText(draft); }, [draft, runtime]);
  return <AssistantRuntimeProvider runtime={runtime}><div className="session-composer">
    {submitted && busy && !knownMessages?.some(message => message.role === 'user' && message.text.trim() === submitted) && <AssistantMessage role="user" text={submitted} locale={locale} queued />}
    {job?.output && !knownMessages?.some(message => message.role === 'assistant' && message.text.trim() === job.output.trim()) && <AssistantMessage role="assistant" label={providerLabel} text={job.output} locale={locale} live={!!busy} />}
    <ComposerPrimitive.Root onSubmit={event => { event.preventDefault(); void send(); }} aria-label={t.composerLabel}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)); } }}>
      {images.length > 0 && <div className="composer-images">{images.map(image => <figure key={image.id}><img src={image.url} alt={image.name} /><button type="button" disabled={!!busy || uploading} aria-label={`${t.composerRemoveImage}: ${image.name}`} onClick={() => setImages(current => current.filter(item => item.id !== image.id))}><X size={14} /></button></figure>)}</div>}
      <ComposerPrimitive.Input addAttachmentOnPaste={false} unstable_focusOnThreadSwitched={false} aria-label={t.composerLabel} placeholder={t.composerPlaceholder.replace('{agent}', providerLabel)} value={draft} maxLength={32000} minRows={2} maxRows={8}
        disabled={loading || !capability?.supported || !!busy} onChange={event => setDraft(event.target.value)}
        onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void attach(files); } }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <div className="composer-footer">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { void attach(Array.from(event.target.files || [])); event.target.value = ''; }} />
        <button type="button" className="composer-attach" disabled={loading || !capability?.supported || capability.provider !== 'codex' || !!busy || uploading || images.length >= 4} aria-label={t.composerAttachImage} title={capability?.provider === 'codex' ? t.composerAttachImage : t.composerImageCodex} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}</button>
        <span title={capability?.nativeId || sessionId}>{providerLabel} · {(capability?.nativeId || sessionId).slice(0, 8)}<br />{t.composerKeys}</span>
        {job && busy && <button type="button" aria-label={t.composerStop} title={t.composerStop} onClick={async () => {
          try {
            const response = await fetch('/api/agent/message', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: job.id }) });
            if (!response.ok) throw new Error('transport_failed');
          } catch { setError('transport_failed'); }
        }}><Square size={14} /></button>}
        <button type="submit" disabled={loading || !capability?.supported || !!capability?.blockedReason || !!busy || uploading || (!draft.trim() && !images.length)} aria-label={t.composerSend} title={t.composerSend}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
        </button>
      </div>
    </ComposerPrimitive.Root>
    <p role={error ? 'alert' : 'status'} className="composer-status">{error ? reason(error) : loading ? t.composerChecking : uploading ? t.composerImageUploading : busy ? t.composerRunning : capability?.blockedReason ? reason(capability.blockedReason) : capability?.supported ? t.composerSameSession : reason(capability?.reason || 'transport_failed')}</p>
  </div></AssistantRuntimeProvider>;
}
