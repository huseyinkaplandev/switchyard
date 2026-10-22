'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalSession, SessionMessage, SessionSource } from '../_lib/sessions';
import AssistantMessage from './assistant-ui/AssistantMessage';
import SessionComposer from './SessionComposer';
import ArchiveRuntime from './assistant-ui/ArchiveRuntime';
import JumpLatest from './assistant-ui/JumpLatest';
import AgentIcon from './AgentIcon';
import { TRANSLATIONS, type Locale } from '../_lib/translations';

export default function SessionsPanel({ locale }: { locale: Locale }) {
  const tr = locale === 'tr';
  const t = TRANSLATIONS[locale];
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [platform, setPlatform] = useState<'windows' | 'macos'>(typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'windows');
  const [source, setSource] = useState<SessionSource | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LocalSession | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const requestId = useRef(0);
  const revision = useRef('');
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sessions', { cache: 'no-store' }).then(response => response.json())
      .then(data => setSessions(data.sessions || []))
      .catch(err => setError(String(err)));
  }, []);

  const visible = useMemo(() => sessions.filter(session =>
    session.platform === platform && (source === 'all' || session.source === source)
    && session.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [sessions, platform, source, query]);

  async function openSession(session: LocalSession) {
    const current = ++requestId.current;
    setMobileDetail(true);
    setSelected(session);
    setMessages([]);
    revision.current = ''; follow.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      if (current === requestId.current) { revision.current = response.headers.get('etag') || ''; setMessages(data.messages || []); }
    } catch (err) { if (current === requestId.current) setError(String(err)); }
    finally { if (current === requestId.current) setLoading(false); }
  }

  useEffect(() => {
    if (!selected?.readable) return;
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const id = selected.id;
    const poll = async () => {
      try {
        const response = await fetch(`/api/sessions/${id}`, { cache: 'no-store', signal: controller.signal, headers: revision.current ? { 'If-None-Match': revision.current } : {} });
        if (response.ok) {
          const data = await response.json();
          if (alive) { revision.current = response.headers.get('etag') || ''; setMessages(data.messages || []); }
        }
      } catch {}
      if (alive) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [selected?.id, selected?.readable]);

  useEffect(() => {
    if (!follow.current) return;
    const frame = requestAnimationFrame(() => { const list = transcript.current; if (list && follow.current) list.scrollTo({ top: list.scrollHeight }); });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  return <section className="native-history space-y-4 text-zinc-200" data-mobile-detail={mobileDetail || undefined}>
    <div>
      <h2 className="text-lg font-semibold">{tr ? 'Yerel Sohbet Geçmişleri' : 'Local Chat History'}</h2>
      <p className="text-sm text-zinc-500">{tr ? 'Kayıtlar hesap değişiminden bağımsız tutulur. Desteklenen yerel oturumlara mesaj gönderebilirsiniz.' : 'Records remain available across account changes. Send messages to supported local sessions.'}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {(['windows', 'macos'] as const).map(os => <button key={os} aria-pressed={platform === os} onClick={() => { setPlatform(os); requestId.current += 1; setSelected(null); setMessages([]); setLoading(false); setMobileDetail(false); }}
        className={`px-3 py-2 rounded text-sm border ${platform === os ? 'border-cyan-600 text-cyan-300 bg-cyan-950/30' : 'border-zinc-700 text-zinc-400'}`}>
        {os === 'windows' ? 'Windows' : 'macOS'} ({sessions.filter(session => session.platform === os).length})
      </button>)}
      <select aria-label={tr ? 'Agent filtresi' : 'Agent filter'} value={source} onChange={event => setSource(event.target.value as SessionSource | 'all')} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm">
        <option value="all">{tr ? 'Tüm agentlar' : 'All agents'}</option>
        <option value="codex">Codex</option><option value="claude">Claude Code</option><option value="cursor">Cursor</option>
        <option value="vscode">VS Code</option><option value="vscode-insiders">VS Code Insiders</option>
        <option value="opencode">OpenCode</option><option value="antigravity">Antigravity</option><option value="kiro">Kiro</option>
      </select>
      <input aria-label={t.workspaceSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder={tr ? 'Başlıkta ara...' : 'Search titles...'} className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1 text-sm flex-1 min-w-40" />
    </div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="native-history-grid">
      <div className="native-list rounded-xl border border-zinc-800 max-h-[65vh] overflow-auto divide-y divide-zinc-800">
        {visible.length === 0 && <p className="p-4 text-sm text-zinc-500">{tr ? 'Kayıt bulunmadı. Mac kopyası için SWITCHYARD_MAC_HOME ayarlayın.' : 'No records. Set SWITCHYARD_MAC_HOME for the Mac copy.'}</p>}
        {visible.map(session => <button key={session.id} onClick={() => openSession(session)} className={`w-full text-left p-3 hover:bg-zinc-900 ${selected?.id === session.id ? 'bg-zinc-900' : ''}`}>
          <div className="native-session-title"><AgentIcon agent={session.source} /><span className="text-sm text-zinc-200 line-clamp-2 break-words">{session.title}</span></div>
          <div className="text-xs text-zinc-500 mt-1">{session.source} · {new Date(session.updatedAt).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')} {session.archived ? '· archived' : ''}</div>
        </button>)}
      </div>
      <ArchiveRuntime messages={messages}><div className="native-reader rounded-xl border border-zinc-800 p-4 space-y-3">
        <div ref={transcript} onScroll={event => { const list = event.currentTarget; follow.current = list.scrollHeight - list.scrollTop - list.clientHeight < 160; }} className="native-transcript max-h-[65vh] overflow-auto">
        <button type="button" className="conversation-back" onClick={() => setMobileDetail(false)}>{t.workspaceBack}</button>
        {!selected && <p className="text-sm text-zinc-500">{tr ? 'Görüntülemek için sohbet seçin.' : 'Select a chat to view it.'}</p>}
        {loading && <p className="text-sm text-zinc-500">{tr ? 'Yükleniyor...' : 'Loading...'}</p>}
        {selected && !selected.readable && <p className="text-sm text-amber-300">{tr ? 'Konuşma metni bu yerel biçimden okunamadı; oturum üstverisi listelenir.' : 'Conversation text could not be read from this local format; session metadata is listed.'}</p>}
        {messages.map((message, index) => <AssistantMessage key={`${selected?.id}:${index}`} role={message.role === 'user' ? 'user' : 'assistant'} text={message.text} label={message.role === 'user' ? undefined : selected?.source} locale={locale} />)}
        </div>
        {selected && <JumpLatest container={transcript} locale={locale}/>}
        {selected && <SessionComposer key={selected.id} kind="local" sessionId={selected.id} providerLabel={selected.source === 'claude' ? 'Claude Code' : selected.source} locale={locale} knownMessages={messages} onComplete={async () => {
          const current = requestId.current;
          const response = await fetch(`/api/sessions/${selected.id}`, { cache: 'no-store' });
          if (!response.ok) throw new Error('Refresh failed');
          const data = await response.json();
          if (current === requestId.current) setMessages(data.messages || []);
        }} />}
      </div></ArchiveRuntime>
    </div>
  </section>;
}
