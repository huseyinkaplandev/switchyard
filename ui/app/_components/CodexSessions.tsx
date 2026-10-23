'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import ArchiveRuntime from './assistant-ui/ArchiveRuntime';
import JumpLatest from './assistant-ui/JumpLatest';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  Hash,
  LoaderCircle,
  MessageSquareText,
  BookOpen,
  Scissors,
  Search,
  Terminal,
  Trash2,
  RefreshCw,
  ExternalLink,
  Database,
  AlertTriangle,
  ArrowDownUp,
  Filter,
  Layers3,
  UserRound,
  Wrench,
  Clipboard,
  FileCode2,
  X,
} from 'lucide-react';
import { getAgentArchiveHealth, getAgentThreadSnapshot, getCodexThreadMessages, getWorkspaceGitState, pruneAgentArchive, removeAgentSession, syncAgentArchive } from '../_actions';
import MessageMarkdown from './MessageMarkdown';
import AssistantMessage from './assistant-ui/AssistantMessage';
import SessionComposer from './SessionComposer';
import AgentIcon from './AgentIcon';
import { recentActivity } from '../_lib/recentActivity';
import { conversationList, normalizeProjectPath, type ConversationScope, type ConversationKind } from '../_lib/conversationList';
import { conversationText, summarizeActivity, resolveTimeWindow, withinWindow } from '../_lib/desktopHandoff/activity';
import DesktopHandoffDialog from './DesktopHandoffDialog';
import type { HandoffCandidate } from '../_lib/desktopHandoff/types';
import HarnessCheckpoint from './HarnessCheckpoint';
import ReadingMode from './ReadingMode';
import SessionPreview from './SessionPreview';
import TranscriptImage from './TranscriptImage';
import StreamingText from './StreamingText';
import ToolTrace from './ToolTrace';
import TranscriptNav from './TranscriptNav';
import { buildHandoffMarkdown, providerDisplayName, providerReplyLabel } from '../_lib/handoff';
import type { WorkspaceGitState } from '../_lib/handoff';
import type { AgentArchiveMessage as CodexMessage, AgentArchiveStatus, AgentArchiveThread as CodexThreadSummary } from '../_lib/agentArchiveDb';
import { TRANSLATIONS, type Locale } from '../_lib/translations';

/** Blocks rendered on first paint; the rest open on demand. */
const INITIAL_WINDOW = 150;
const WINDOW_STEP = 300;


type ProjectGroup = {
  key: string;
  label: string;
  cwd: string;
  threads: CodexThreadSummary[];
};

type DisplayMode = 'prompts' | 'responses' | 'both';
type SortMode = 'recent' | 'oldest' | 'title';
type GroupMode = 'project' | 'month' | 'none';
type ContentFilter = 'all' | 'with-prompts' | 'with-replies';

function formatDate(value: string, locale: Locale) {
  if (!value) return locale === 'tr' ? 'Tarih bilinmiyor' : 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildCombinedContent(messages: CodexMessage[]) {
  return messages
    .map((message, index) => `${message.role === 'user' ? 'PROMPT' : providerReplyLabel(message.provider)} ${String(index + 1).padStart(2, '0')}\n\n${message.text}`)
    .join('\n\n────────────────────────────────────────\n\n');
}

function formatMonth(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === 'tr' ? 'Tarih bilinmiyor' : 'Unknown date';
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' }).format(date);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function CodexSessions({
  initialThreads,
  locale,
}: {
  initialThreads: CodexThreadSummary[];
  locale: Locale;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('session'));
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [selectedMessages, setSelectedMessages] = useState<CodexMessage[] | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('both');
  const [copied, setCopied] = useState<string | null>(null);
  const initialProvider = searchParams.get('provider');
  const [provider, setProvider] = useState<'codex' | 'claude-code' | 'opencode' | 'antigravity'>(
    initialProvider === 'claude-code'
      ? 'claude-code'
      : initialProvider === 'opencode'
      ? 'opencode'
      : initialProvider === 'antigravity'
      ? 'antigravity'
      : 'codex'
  );
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const t = TRANSLATIONS[locale];
  const [mobileDetail, setMobileDetail] = useState(Boolean(searchParams.get('session')));
  const [groupMode, setGroupMode] = useState<GroupMode>('project');
  const [dateFilter, setDateFilter] = useState<'all'|'today'|'8h'|'24h'|'7d'>('all');
  const [recentQuery, setRecentQuery] = useState('');
  const [recentExpanded, setRecentExpanded] = useState(false);
  const fromRecent = useRef(false);
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [conversationScope, setConversationScope] = useState<ConversationScope>('active');
  const [conversationKind, setConversationKind] = useState<ConversationKind>('all');
  const [allScheduledRuns, setAllScheduledRuns] = useState(false);
  const [sourceAccount, setSourceAccount] = useState('all');
  const [accountLabels, setAccountLabels] = useState<Record<string,string>>({});
  const [status, setStatus] = useState<AgentArchiveStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [handoffThread, setHandoffThread] = useState<CodexThreadSummary | null>(null);
  const [handoffMessages, setHandoffMessages] = useState<CodexMessage[]>([]);
  const [handoffText, setHandoffText] = useState('');
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffSyncing, setHandoffSyncing] = useState(false);
  const [handoffCopied, setHandoffCopied] = useState(false);
  /** Last seen archive counts; a full page refresh fires only when they change. */
  const lastCountsRef = useRef<string | null>(null);
  /** IDs of messages that arrived via the stream; only these reveal word by word. */
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [streamLive, setStreamLive] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const followingLatest = useRef(true);
  /** Show tool/reasoning records. On: the actual work becomes visible. */
  const [showTools, setShowTools] = useState(false);
  /**
   * How many blocks to render.
   *
   * Once tool records were stored, one session grew from 544 messages to
   * 4613; rendering them all at once (plus markdown parsing for every text
   * message) froze the tab. Windowing from the end is enough because
   * navigation jumps to prompts: it needs the window to cover the target,
   * not random access.
   */
  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
  const [readingOpen, setReadingOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [activityNow, setActivityNow] = useState(0);
  useEffect(() => {
    setActivityNow(Date.now());
    const timer = setInterval(() => setActivityNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [catalogActivity, setActivity] = useState<Record<string,HandoffCandidate>>({});
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const activity = useMemo(() => {
    const item = selectedId && catalogActivity[selectedId];
    if (!item || !selectedMessages) return catalogActivity;
    return { ...catalogActivity, [selectedId!]: { ...item, ...summarizeActivity(selectedMessages) } };
  }, [catalogActivity, selectedId, selectedMessages]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/handoff/catalog');
        if (!response.ok) throw new Error('Conversation catalog unavailable');
        const body = await response.json();
        if (active) {
          const entries: Record<string,HandoffCandidate>={};
          for (const c of body.candidates as HandoffCandidate[]) if (!entries[c.sourceId] || entries[c.sourceId].archived && !c.archived) entries[c.sourceId]=c;
          setActivity(entries);
          setAccountLabels(body.accountLabels || {});
          setCatalogReady(true);
          setCatalogError(false);
        }
      } catch { if (active) setCatalogError(true); }
    };
    void refresh(); const interval = window.setInterval(refresh,30000);
    return () => { active=false; window.clearInterval(interval); };
  }, []);
  /** Hovered row id and position; the preview opens from these. */
  const [preview, setPreview] = useState<{ id: string; rect: DOMRect } | null>(null);
  /** Messages still revealing word by word. `liveIds` carries the badge and persists;
      this one is temporary and hands off to markdown when the reveal ends. */
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  const sourceAccounts=[...new Set(initialThreads.filter(thread=>thread.provider===provider).map(thread=>activity[thread.id]?.sourceAccount).filter((a):a is string=>Boolean(a)))];
  const list = useMemo(() => conversationList(initialThreads.filter(thread=>thread.provider===provider && (sourceAccount==='all' || activity[thread.id]?.sourceAccount===sourceAccount)), activity, conversationScope, conversationKind, allScheduledRuns), [initialThreads,provider,activity,conversationScope,conversationKind,allScheduledRuns,sourceAccount]);
  const catalogRequired = provider === 'claude-code' || provider === 'codex';
  const providerThreads = catalogRequired && !catalogReady ? [] : list.threads;
  const providerLabel = providerDisplayName(provider);
  function displayTitle(thread: CodexThreadSummary) {
    const title = activity[thread.id]?.title || thread.title;
    if (!/^(?:<|# (?:Context|Files|AGENTS)|Exit code:|\(no output\))/.test(title)) return title;
    return conversationText(activity[thread.id]?.lastUser?.text || '').slice(0,90) || t.auiUntitled;
  }

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
    const filtered = providerThreads.filter((thread) => {
      const matchesQuery = !normalizedQuery || [thread.title, thread.project, thread.cwd, thread.id]
        .some((value) => value.toLocaleLowerCase('tr-TR').includes(normalizedQuery));
      const matchesContent = contentFilter === 'all'
        || contentFilter === 'with-prompts' && thread.promptCount > 0
        || contentFilter === 'with-replies' && thread.responseCount > 0;
      const matchesDate = dateFilter === 'all' || !activityNow || withinWindow(activity[thread.id]?.activityAt || thread.updatedAt, resolveTimeWindow(dateFilter,new Date(activityNow).toISOString()));
      return matchesQuery && matchesContent && matchesDate;
    });
    return [...filtered].sort((left, right) => {
      if (sortMode === 'title') return left.title.localeCompare(right.title, locale === 'tr' ? 'tr' : 'en');
      const direction = sortMode === 'recent' ? -1 : 1;
      return direction * (activity[left.id]?.activityAt || left.updatedAt).localeCompare(activity[right.id]?.activityAt || right.updatedAt);
    });
  }, [activity, activityNow, dateFilter, contentFilter, locale, providerThreads, query, sortMode]);

  const recents = useMemo(() => providerThreads.filter(thread => !recentQuery.trim() || (activity[thread.id]?.title || thread.title).toLocaleLowerCase(locale).includes(recentQuery.toLocaleLowerCase(locale))).sort((a,b)=>(activity[b.id]?.activityAt || b.updatedAt).localeCompare(activity[a.id]?.activityAt || a.updatedAt)), [providerThreads, activity, recentQuery, locale]);
  function period(thread?: CodexThreadSummary) {
    const at = thread && (activity[thread.id]?.activityAt || thread.updatedAt);
    const now = activityNow || Date.now();
    if (!at || !Number.isFinite(Date.parse(at))) return t.auiOlder;
    const today = resolveTimeWindow('today',new Date(now).toISOString());
    if (withinWindow(at,today)) return t.auiToday;
    const age = now-Date.parse(at);
    return age<=7*86400000 ? t.auiLast7Days : age<=30*86400000 ? t.auiLast30Days : t.auiOlder;
  }

  const groups = useMemo<ProjectGroup[]>(() => {
    const grouped = new Map<string, ProjectGroup>();
    for (const thread of filteredThreads) {
      const projectKey = thread.cwd || thread.project;
      const normalizedProject = normalizeProjectPath(projectKey);
      const key = groupMode === 'project' ? normalizedProject : groupMode === 'month' ? thread.updatedAt.slice(0, 7) : 'all';
      const label = groupMode === 'project' ? thread.project : groupMode === 'month' ? formatMonth(thread.updatedAt, locale) : locale === 'tr' ? 'Tüm sohbetler' : 'All threads';
      const current = grouped.get(key) || { key, label, cwd: groupMode === 'project' ? thread.cwd : '', threads: [] };
      current.threads.push(thread);
      grouped.set(key, current);
    }
    // Recent threads already descend by actual user/reply activity. A group's
    // first occurrence is its most recent conversation; keep that order rather
    // than sorting it again by file metadata, which can change without messages.
    const result = Array.from(grouped.values());
    if (sortMode === 'recent') return result;
    return result.sort((left, right) => (right.threads[0]?.updatedAt || '').localeCompare(left.threads[0]?.updatedAt || ''));
  }, [filteredThreads, groupMode, locale, sortMode]);

  const selectedThread = initialThreads.find((thread) => thread.id === selectedId) || null;
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  /** Selection whose group we opened; if the user closes it, we do not reopen it. */
  const revealedRef = useRef<string | null>(null);
  /** Provider/grouping scope the open groups belong to. */
  const groupScopeRef = useRef(`${provider}:${groupMode}`);


  /**
   * This interval used to call `router.refresh()` unconditionally every 8 seconds.
   * That refetches the whole page from the server; every tick triggered a sync
   * and produced hundreds of MB of RSC payload. Because a refresh took longer
   * than 8 seconds, requests piled up and never stopped while the tab was open.
   *
   * Now a cheap sync runs first; a full page refresh happens only when the
   * counts actually changed. Zero refreshes when idle.
   */
  useEffect(() => {
    let active = true;
    let syncing = false;
    const controller = new AbortController();
    const applyStatus = (next: AgentArchiveStatus) => {
      if (!active) return;
      const previous = lastCountsRef.current;
      // Messages already arrive through SSE; they must not restart navigation.
      const signature = `${next.sessionCount}:${next.deletedCount}`;
      lastCountsRef.current = signature;
      setStatus(next);
      // The first measurement is the baseline; refresh only if a later tick differs.
      if (previous !== null && previous !== signature) router.refresh();
    };
    fetch('/api/agent/sync',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(next=>{if(next)applyStatus(next);}).catch(() => undefined);
    if (handoffThread) return () => { active = false; controller.abort(); };
    const interval = window.setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try {
        const response=await fetch('/api/agent/sync',{method:'POST',signal:controller.signal});
        if(response.ok)applyStatus((await response.json()).status);
      } catch {} finally { syncing=false; }
    }, 8000);
    return () => { active = false; controller.abort(); window.clearInterval(interval); };
  }, [handoffThread, router]);

  useEffect(() => {
    if (selectedThread && selectedThread.provider !== provider) setSelectedId(null);
  }, [provider, selectedThread]);

  /**
   * Resets open groups when the grouping scope changes.
   *
   * An unconditional `setExpandedGroups(null)` misleads under StrictMode:
   * effects run twice in development and the second run closed the group the
   * deep-link effect had opened. Reset only when the scope really changed.
   */
  useEffect(() => {
    const scope = `${provider}:${groupMode}`;
    if (groupScopeRef.current === scope) return;
    groupScopeRef.current = scope;
    setExpandedGroups(null);
    revealedRef.current = null;
    document.querySelector('.conversation-list-scroll')?.scrollTo({top:0});
  }, [provider, groupMode]);
  useEffect(()=>setSourceAccount('all'),[provider]);

  /**
   * Opens the group of a deep-linked session.
   *
   * The handoff document links to the panel with `?session=<id>` and the
   * transcript opened, but the row stayed hidden inside a collapsed project
   * group: the chat was open, yet not visible in the list.
   * The group is opened once and the row scrolled into view.
   *
   * The key is not just the session id: when grouping or provider changes,
   * the group key changes too and the row must be revealed again.
   */
  useEffect(() => {
    if (!selectedId) return;
    if (fromRecent.current) return;
    const key = `${selectedId}:${groupMode}:${provider}`;
    if (revealedRef.current === key) return;
    const group = groups.find((item) => item.threads.some((thread) => thread.id === selectedId));
    if (!group) return;
    revealedRef.current = key;
    setExpandedGroups((current) => {
      if (current?.has(group.key)) return current;
      const next = new Set(current ?? []);
      next.add(group.key);
      return next;
    });
    /* The row renders in this commit; wait two frames, then scroll it into view. */
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }));
    return () => cancelAnimationFrame(frame);
  }, [groupMode, groups, provider, selectedId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHandoffThread(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * Renders the DB state first, then attaches to the live stream.
   *
   * The stream takes the DB message count as `fromOrdinal`; the server reads
   * the source file and sends everything after that position. Messages not yet
   * written to the DB appear immediately, without waiting for the archive sync.
   */
  useEffect(() => {
    if (!selectedId) {
      setSelectedMessages(null);
      setLiveIds(new Set());
      setAnimatingIds(new Set());
      setStreamLive(false);
      return;
    }

    let active = true;
    let source: EventSource | null = null;
    setSelectedMessages(null);
    setLiveIds(new Set());
    setAnimatingIds(new Set());
    setStreamLive(false);
    setWindowSize(INITIAL_WINDOW);
    followingLatest.current = true;

    startTransition(async () => {
      const messages = await getCodexThreadMessages(selectedId);
      if (!active) return;
      setSelectedMessages(messages);

      source = new EventSource(`/api/agent/stream?id=${encodeURIComponent(selectedId)}&fromOrdinal=${messages.length}`);
      source.addEventListener('ready', () => { if (active) setStreamLive(true); });
      source.addEventListener('snapshot', event => {
        if (!active) return;
        try { const payload = JSON.parse((event as MessageEvent).data); if (Array.isArray(payload.messages)) setSelectedMessages(payload.messages); } catch {}
      });
      source.addEventListener('messages', (event) => {
        if (!active) return;
        let payload: { messages?: CodexMessage[] };
        try {
          payload = JSON.parse((event as MessageEvent).data);
        } catch {
          return;
        }
        const incoming = payload.messages || [];
        if (!incoming.length) return;
        setSelectedMessages((previous) => {
          const base = previous || [];
          const known = new Set(base.map((message) => message.id));
          /* Text check in addition to id: when the queued and processed records
             land in separate tail reads, the same message can arrive twice. */
          const added = incoming.filter(
            (message) => !known.has(message.id),
          );
          if (!added.length) return base;
          setLiveIds((ids) => {
            const next = new Set(ids);
            for (const message of added) next.add(message.id);
            return next;
          });
          setAnimatingIds((ids) => {
            const next = new Set(ids);
            for (const message of added) next.add(message.id);
            return next;
          });
          return [...base, ...added];
        });
      });
      source.addEventListener('error', () => { if (active) setStreamLive(false); });
    });

    return () => {
      active = false;
      source?.close();
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedMessages || !followingLatest.current) return;
    const frame = requestAnimationFrame(() => { const list = messageListRef.current; if (list && followingLatest.current) list.scrollTo({ top: list.scrollHeight }); });
    return () => cancelAnimationFrame(frame);
  }, [selectedMessages]);

  /* The user should not have to scroll down when a new message arrives.
     If they scrolled up to read history, leave the position alone. */
  const scrollToLatest = useCallback(() => {
    if (typeof window === 'undefined') return;
    const list = messageListRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom > 700) return;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, []);

  const visibleMessages = useMemo(() => {
    if (!selectedMessages) return null;
    /* Tool records are not a side of the conversation; the prompt/reply filter
       applies only to text messages, and tools toggle with their own switch. */
    /* Compaction is not a tool detail: it is where part of the history became
       a summary. It must stay visible even when "Work trace" is off. */
    // Antigravity may persist only reasoning and tool steps until a final reply exists.
    // Show that work instead of an apparently empty assistant history.
    const traceOnly = selectedMessages.some(message => message.provider === 'antigravity' && message.role === 'assistant')
      && !selectedMessages.some(message => message.role === 'assistant' && (message.kind ?? 'text') === 'text');
    const base = showTools || traceOnly
      ? selectedMessages
      : selectedMessages.filter((message) => {
          const kind = message.kind ?? 'text';
          return kind === 'text' || kind === 'attachment' || kind === 'compaction';
        });
    if (displayMode === 'prompts') return base.filter((message) => message.role === 'user' && (message.kind ?? 'text') === 'text');
    if (displayMode === 'responses') return base.filter((message) => message.role === 'assistant' || (message.kind ?? 'text') !== 'text');
    return base;
  }, [displayMode, selectedMessages, showTools]);

  const promptCount = selectedMessages?.filter((message) => message.role === 'user' && (message.kind ?? 'text') === 'text').length || 0;
  const responseCount = selectedMessages?.filter((message) => message.role === 'assistant' && (message.kind ?? 'text') === 'text').length || 0;

  const selectThread = (thread: CodexThreadSummary) => {
    setSelectedId(thread.id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'codex');
    params.set('provider', thread.provider);
    params.set('session', thread.id);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  };

  const openHandoff = async (thread: CodexThreadSummary) => {
    setHandoffThread(thread);
    setHandoffMessages([]);
    setHandoffText('');
    setHandoffCopied(false);
    setHandoffLoading(true);
    try {
      const [initialThread, initialMessages] = await Promise.all([
        getAgentThreadSnapshot(thread.id),
        getCodexThreadMessages(thread.id),
      ]);
      const initialSnapshot = initialThread || thread;
      /* Git state is the most valuable but most fragile part of the handoff: if it
         cannot be read, the handoff still opens and only that section says "unreadable". */
      const git = await getWorkspaceGitState(initialSnapshot.cwd).catch(
        (): WorkspaceGitState => ({ available: false, error: locale === 'tr' ? 'okunamadı' : 'unreadable' }),
      );
      setHandoffThread(initialSnapshot);
      setHandoffMessages(initialMessages);
      setHandoffText(buildHandoffMarkdown(initialSnapshot, initialMessages, git));
      setHandoffLoading(false);
      setHandoffSyncing(true);

      let syncFailed = false;
      try {
        await syncAgentArchive();
      } catch {
        syncFailed = true;
      }

      if (!syncFailed) {
        const [freshThread, messages] = await Promise.all([
          getAgentThreadSnapshot(thread.id),
          getCodexThreadMessages(thread.id),
        ]);
        const currentThread = freshThread || initialSnapshot;
        const freshGit =
          currentThread.cwd === initialSnapshot.cwd
            ? git
            : await getWorkspaceGitState(currentThread.cwd).catch(
                (): WorkspaceGitState => ({ available: false, error: locale === 'tr' ? 'okunamadı' : 'unreadable' }),
              );
        setHandoffThread(currentThread);
        setHandoffMessages(messages);
        setHandoffText(buildHandoffMarkdown(currentThread, messages, freshGit));
        const nextStatus = await getAgentArchiveHealth();
        setStatus(nextStatus);
      } else {
        setNotice(locale === 'tr' ? 'Canlı kaynak okunamadı; handoff DB snapshot’ından açıldı.' : 'Live source unreadable; handoff opened from the DB snapshot.');
      }
    } catch {
      setHandoffMessages([]);
      setHandoffText(buildHandoffMarkdown(thread, []));
      setNotice(locale === 'tr' ? 'Handoff hazırlanırken arşiv okunamadı. DB kaydı korunuyor.' : 'Archive unreadable while preparing the handoff. The DB record is kept.');
    }
    try {
      const response = await fetch('/api/handoff/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: thread.id }) });
      const snapshot = await response.json();
      if (!response.ok) throw new Error(snapshot.error || 'Snapshot failed');
      setHandoffText(snapshot.markdown);
    } catch (error) {
      setNotice(`${locale === 'tr' ? 'Yerel kanıt paketi oluşturulamadı; yalnız özet hazır' : 'Local evidence package could not be created; only the summary is ready'}: ${error instanceof Error ? error.message : String(error)}`);
    }
    setHandoffLoading(false);
    setHandoffSyncing(false);
  };

  const copyHandoff = async () => {
    try {
      await copyText(handoffText);
      setHandoffCopied(true);
      window.setTimeout(() => setHandoffCopied(false), 1600);
    } catch {
      setHandoffCopied(false);
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current || []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /**
   * Groups consecutive tool records into a single block.
   *
   * One card per tool call turned an agent turn into a wall of dozens of
   * cards and lost the conversation between them.
   */
  const renderBlocks = useMemo(() => {
    if (!visibleMessages) return null;
    const blocks: Array<
      | { key: string; type: 'message'; message: CodexMessage }
      | { key: string; type: 'compaction'; message: CodexMessage }
      | { key: string; type: 'image'; message: CodexMessage }
      | { key: string; type: 'tools'; items: CodexMessage[] }
    > = [];
    for (const message of visibleMessages) {
      const kind = message.kind ?? 'text';
      if (kind === 'text') {
        blocks.push({ key: message.id, type: 'message', message });
        continue;
      }
      if (kind === 'compaction') {
        blocks.push({ key: message.id, type: 'compaction', message });
        continue;
      }
      if (kind === 'attachment') {
        blocks.push({ key: message.id, type: 'image', message });
        continue;
      }
      const last = blocks.at(-1);
      if (last && last.type === 'tools') last.items.push(message);
      else blocks.push({ key: `tools-${message.id}`, type: 'tools', items: [message] });
    }
    return blocks;
  }, [visibleMessages]);

  const hiddenBlockCount = Math.max(0, (renderBlocks?.length ?? 0) - windowSize);
  const windowedBlocks = useMemo(
    () => (renderBlocks ? renderBlocks.slice(Math.max(0, renderBlocks.length - windowSize)) : null),
    [renderBlocks, windowSize],
  );

  /** If navigation jumps to a block outside the window, grow the window first. */
  const ensureRendered = useCallback((id: string) => {
    if (document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) return true;
    setWindowSize((size) => size + WINDOW_STEP);
    return false;
  }, []);

  const handleCopy = async (key: string, text: string) => {
    try {
      await copyText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1400);
    } catch {
      setCopied(null);
    }
  };

  const focusProvider = async (nextProvider: 'codex' | 'claude-code' | 'opencode' | 'antigravity') => {
    setProvider(nextProvider);
    try {
      const response = await fetch('/api/agent/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: nextProvider }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t.workspaceAppFailed);
      setNotice(t.workspaceAppRequested.replace('{agent}', providerDisplayName(nextProvider)));
      window.setTimeout(() => setNotice(null), 2500);
    } catch (error) { setNotice(`${t.workspaceAppFailed} ${error instanceof Error ? error.message : ''}`); }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAgentArchive();
      setStatus(result.status);
      setNotice(locale === 'tr' ? `${result.imported + result.updated} sohbet DB’ye yazıldı/güncellendi.` : `${result.imported + result.updated} conversations written/updated in the DB.`);
      router.refresh();
      window.setTimeout(() => setNotice(null), 3000);
    } finally { setSyncing(false); }
  };

  const deleteThread = async (thread: CodexThreadSummary) => {
    if (!window.confirm(locale === 'tr' ? 'Bu sohbet dashboard DB’sinden silinsin mi? Kaynak dosya silinmez; tekrar içe alınmaması için işaretlenir.' : 'Delete this conversation from the dashboard DB? The source file is not deleted; it is marked so it is not imported again.')) return;
    await removeAgentSession(thread.id);
    if (selectedId === thread.id) setSelectedId(null);
    setNotice(locale === 'tr' ? 'Sohbet DB’den silindi.' : 'Conversation deleted from the DB.');
    router.refresh();
  };

  const pruneOld = async () => {
    if (!window.confirm(locale === 'tr' ? '30 günden eski arşiv sohbetleri DB’den silinsin mi?' : 'Delete archived conversations older than 30 days from the DB?')) return;
    const deleted = await pruneAgentArchive(30);
    setNotice(locale === 'tr' ? `${deleted} eski sohbet DB’den silindi.` : `${deleted} old conversations deleted from the DB.`);
    const next = await getAgentArchiveHealth();
    setStatus(next);
    router.refresh();
  };

  return (
    <div className="conversation-workspace flex flex-col gap-4" data-mobile-detail={mobileDetail || undefined}>
      <div className="conversation-toolbar">
        <div className="provider-switch" role="group" aria-label="Agent">
          {(['codex', 'claude-code', 'opencode', 'antigravity'] as const).map(id => <button key={id} type="button" data-tour={`provider:${id}`} aria-pressed={provider === id} onClick={() => { setProvider(id); setMobileDetail(false); }}>
            <AgentIcon agent={id} size={18} />{id === 'codex' ? 'Codex' : id === 'claude-code' ? 'Claude Code' : id === 'opencode' ? 'OpenCode' : 'Antigravity'}
          </button>)}
        </div>
        <div className="conversation-actions">
          <button type="button" aria-expanded={batchOpen} onClick={() => setBatchOpen(value => !value)}><Copy size={14} /> {t.handoff.title}</button>
          <span className="text-sm text-zinc-400">{providerThreads.length} {locale === 'tr' ? 'sohbet' : 'conversations'}</span>
          <button type="button" disabled={syncing} onClick={runSync}><RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {t.workspaceSync}</button>
          <details className="archive-maintenance"><summary>{t.workspaceMaintenance}</summary><div>
            <p>{status?.sessionCount ?? '—'} {locale === 'tr' ? 'sohbet' : 'conversations'} · {status ? formatBytes(status.dbBytes) : '—'}</p>
            <button type="button" onClick={() => focusProvider(provider as 'codex' | 'claude-code' | 'opencode' | 'antigravity')}><ExternalLink size={14} /> {t.workspaceOpenApp}</button>
            <button type="button" onClick={pruneOld} className="text-red-300"><Trash2 size={14} /> {locale === 'tr' ? '30 günden eski kayıtları temizle' : 'Remove records older than 30 days'}</button>
          </div></details>
        </div>
      </div>
      {batchOpen && <DesktopHandoffDialog locale={locale} onClose={() => setBatchOpen(false)} />}
      {notice && <div role="status" className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 px-4 py-3 text-xs font-mono text-cyan-200">{notice}</div>}

      <div className="conversation-grid">
        <aside className="conversation-list">
          <div className="border-b border-zinc-800 p-3">
            <label className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 focus-within:border-cyan-800">
              <Search size={14} className="shrink-0 text-zinc-600" />
              <input
                data-tour="archive-search"
                aria-label={t.workspaceSearch}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={locale === 'tr' ? 'Proje, sohbet veya session ara…' : 'Search project, thread, or session…'}
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </label>
            <select aria-label={t.auiProjectPeriod} value={dateFilter} onChange={event=>setDateFilter(event.target.value as typeof dateFilter)} className="aui-project-period">
              <option value="all">{t.auiAllTime}</option><option value="today">{t.auiToday}</option><option value="8h">{t.auiLast8Hours}</option><option value="24h">{t.auiLast24Hours}</option><option value="7d">{t.auiLast7Days}</option>
            </select>
            <details className="conversation-filters">
            <summary><Filter size={14}/>{t.workspaceFilters}<span>{filteredThreads.length}</span></summary>
            <div className="aui-conversation-scope">
              {sourceAccounts.length>0 && <label>{locale==='tr'?'Kaynak hesap':'Source account'}<select aria-label={locale==='tr'?'Sohbet hesabı':'Conversation account'} value={sourceAccount} onChange={e=>setSourceAccount(e.target.value)}><option value="all">{locale==='tr'?'Tüm hesaplar':'All accounts'}</option>{sourceAccounts.map(account=><option key={account} value={account}>{accountLabels[account] || account}</option>)}</select></label>}
              <label>{locale==='tr'?'Kayıt durumu':'Record status'}<select aria-label={locale==='tr'?'Kayıt durumu':'Record status'} value={conversationScope} onChange={e=>setConversationScope(e.target.value as ConversationScope)}><option value="active">{locale==='tr'?'Arşivlenmemiş':'Not archived'}</option><option value="archived">{locale==='tr'?'Arşivlenmiş':'Archived'}</option><option value="all">{t.workspaceAll}</option></select></label>
              <label>{locale==='tr'?'Sohbet türü':'Conversation type'}<select aria-label={locale==='tr'?'Sohbet türü':'Conversation type'} value={conversationKind} onChange={e=>setConversationKind(e.target.value as ConversationKind)}><option value="all">{t.workspaceAll}</option><option value="normal">{t.handoff.normal}</option><option value="scheduled">{t.handoff.scheduled}</option></select></label>
              <label className="aui-check-label"><input type="checkbox" checked={allScheduledRuns} onChange={e=>setAllScheduledRuns(e.target.checked)}/>{locale==='tr'?'Tüm scheduled çalıştırmaları':'All scheduled runs'}</label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-mono text-zinc-500">
                <Layers3 size={12} className="shrink-0 text-zinc-600" />
                <span className="sr-only">{locale === 'tr' ? 'Gruplama' : 'Grouping'}</span>
                <select value={groupMode} onChange={(event) => setGroupMode(event.target.value as GroupMode)} aria-label={locale === 'tr' ? 'Gruplama' : 'Grouping'} className="min-w-0 flex-1 bg-transparent text-xs text-zinc-300 outline-none">
                  <option value="project">{locale === 'tr' ? 'Projeye göre' : 'By project'}</option>
                  <option value="month">{locale === 'tr' ? 'Aya göre' : 'By month'}</option>
                  <option value="none">{locale === 'tr' ? 'Gruplama yok' : 'No grouping'}</option>
                </select>
              </label>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-mono text-zinc-500">
                <ArrowDownUp size={12} className="shrink-0 text-zinc-600" />
                <span className="sr-only">{locale === 'tr' ? 'Sıralama' : 'Sort'}</span>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label={locale === 'tr' ? 'Sıralama' : 'Sort'} className="min-w-0 flex-1 bg-transparent text-xs text-zinc-300 outline-none">
                  <option value="recent">{locale === 'tr' ? 'En yeni' : 'Newest'}</option>
                  <option value="oldest">{locale === 'tr' ? 'En eski' : 'Oldest'}</option>
                  <option value="title">{locale === 'tr' ? 'Başlık A–Z' : 'Title A–Z'}</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="group" aria-label={locale === 'tr' ? 'Sohbet filtresi' : 'Conversation filter'}>
              <Filter size={12} className="ml-1 shrink-0 text-zinc-600" />
              {([
                ['all', locale === 'tr' ? 'Tümü' : 'All'],
                ['with-prompts', locale === 'tr' ? 'Promptlu' : 'With prompts'],
                ['with-replies', locale === 'tr' ? 'Cevaplı' : 'With replies'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={contentFilter === value} onClick={() => setContentFilter(value)} className={`min-h-8 flex-1 rounded-md px-2 text-xs font-mono transition-colors ${contentFilter === value ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            </details>
            {catalogRequired && !catalogReady && <p className="aui-list-hint" role="status">{catalogError ? (locale==='tr'?'Sohbet kimlikleri yüklenemedi; bağlantı yeniden deneniyor.':'Conversation identities unavailable; retrying connection.') : (locale==='tr'?'Sohbet kimlikleri eşleştiriliyor…':'Matching conversation identities…')}</p>}
            <p className="aui-list-hint">{allScheduledRuns ? (locale==='tr'?'Scheduled geçmişi açık':'Scheduled history visible') : (locale==='tr'?'Scheduled: görev başına son sohbet':'Scheduled: latest chat per task')}{conversationScope==='active' ? (locale==='tr'?' · Arşiv gizli':' · Archive hidden') : ''}</p>
          </div>

          <div className="conversation-list-scroll custom-scrollbar">
            <section className="aui-recents" aria-label={t.auiRecents}>
              <div className="aui-list-section-heading"><h4>{t.auiRecents}</h4><details><summary aria-label={t.auiRecentSearch}><Search size={13}/></summary><input aria-label={t.auiRecentSearch} placeholder={t.auiRecentSearch} value={recentQuery} onChange={event=>setRecentQuery(event.target.value)}/></details></div>
              {recents.slice(0,recentExpanded?30:8).map(thread=>{const at=activity[thread.id]?.activityAt || thread.updatedAt;const recent=recentActivity(at,activityNow);return <button type="button" key={thread.id} data-tour={`recent:${thread.id}`} className="aui-recent-row" aria-pressed={selectedId===thread.id} onClick={()=>{fromRecent.current=true;selectThread(thread);setMobileDetail(true);}} title={`${displayTitle(thread)} · ${formatDate(at,locale)}`}><span>{displayTitle(thread)}</span>{recent?<time dateTime={at}>{recent.minutes===0?t.activityJustNow:t.activityMinutesAgo(recent.minutes)}</time>:<AgentIcon agent={provider} size={13}/>}</button>})}
              {recents.length===0&&(!catalogRequired||catalogReady)&&<p className="aui-muted">{t.workspaceNoMatches}</p>}
              {recents.length>8&&<button type="button" className="aui-show-more" onClick={()=>setRecentExpanded(value=>!value)}>{recentExpanded?t.auiShowLess:t.auiShowMore}</button>}
            </section>
            <h4 className="aui-project-heading">{t.auiProjects}</h4>
            {groups.length === 0 && (
              <div className="px-3 py-10 text-center text-xs text-zinc-600">
                {locale === 'tr' ? `Eşleşen ${providerLabel} sohbeti yok.` : `No matching ${providerLabel} threads.`}
              </div>
            )}
            {groups.map((group,groupIndex) => (
              <div key={group.key} className="mb-2 last:mb-0">
                {groupMode==='project' && sortMode==='recent' && (groupIndex===0 || period(groups[groupIndex-1].threads[0])!==period(group.threads[0])) && <h5 className="aui-period-heading">{period(group.threads[0])}</h5>}
                {groupMode!=='none' && <button
                  type="button"
                  aria-expanded={query.trim().length > 0 || (expandedGroups?.has(group.key) ?? false)}
                  onClick={() => toggleGroup(group.key)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700"
                >
                  <ChevronRight size={13} className={`shrink-0 text-cyan-500 transition-transform ${expandedGroups?.has(group.key) ? 'rotate-90' : ''}`} />
                  <FolderOpen size={12} className="shrink-0 text-cyan-500" />
                  <span className="truncate text-xs font-medium text-zinc-300">{group.label}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-zinc-900 px-2 py-1 text-xs font-mono text-zinc-500">{group.threads.length}</span>
                </button>}
                {group.cwd && <p className="truncate px-7 pb-1 text-xs font-mono text-zinc-500" title={group.cwd}>{group.cwd}</p>}
                {(groupMode === 'none' || query.trim().length > 0 || expandedGroups?.has(group.key)) && <div className="flex flex-col gap-1 pl-2">
                  {group.threads.map((thread) => {
                    const active = thread.id === selectedId;
                    const item = activity[thread.id];
                    const recent = recentActivity(item?.activityAt, activityNow);
                    const latest = !item?.lastAssistant ? item?.lastUser : !item.lastUser ? item.lastAssistant : (item.lastUser.at ?? '') > (item.lastAssistant.at ?? '') ? item.lastUser : item.lastAssistant;
                    const latestIsUser = latest === item?.lastUser;
                    return (
                      <div
                        key={thread.id}
                        data-selected={active || undefined}
                        data-hot={recent?.hot || undefined}
                        className={`conversation-row group flex w-full rounded-xl border px-3 py-2.5 transition-all ${active ? 'border-cyan-800/80 bg-cyan-950/30' : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/80'}`}
                      >
                        <button
                          type="button"
                          data-session-button="true"
                          data-session-id={thread.id}
                          onClick={() => { fromRecent.current=false; selectThread(thread); setMobileDetail(true); }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-start gap-2">
                            <AgentIcon agent={provider} size={22} />
                            <span className={`line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 ${active ? 'text-cyan-100' : 'text-zinc-300'}`}>{displayTitle(thread)}</span>
                            <ChevronRight size={13} className={`mt-0.5 shrink-0 transition-transform ${active ? 'translate-x-0.5 text-cyan-400' : 'text-zinc-700 group-hover:text-zinc-400'}`} />
                          </div>
                          <div className="conversation-row-meta"><span title={thread.cwd}>{thread.project}</span><time dateTime={item?.activityAt || thread.updatedAt} title={formatDate(item?.activityAt || thread.updatedAt, locale)} className={recent ? 'conversation-recency' : undefined}>{recent ? recent.minutes === 0 ? t.activityJustNow : t.activityMinutesAgo(recent.minutes) : formatDate(item?.activityAt || thread.updatedAt, locale)}</time></div>
                          <div className="conversation-row-status">{item && item.chatType!=='unknown' && <span className="handoff-badge">{item.chatType === 'normal' ? t.handoff.normal : t.handoff.scheduled}</span>}{(list.counts[thread.id] || 0)>1 && <span className="handoff-badge">{list.counts[thread.id]} {locale==='tr'?'çalıştırma':'runs'}</span>}{latest && <p><span>{latestIsUser ? t.handoff.lastUser : t.handoff.lastReply}:</span> {latest.text}</p>}</div>
                        </button>
                        <button
                          type="button"
                          aria-label={locale === 'tr' ? 'Sohbeti DB’den sil' : 'Delete conversation from DB'}
                          onClick={() => void deleteThread(thread)}
                          className="ml-1 shrink-0 self-start rounded p-1 text-zinc-700 hover:bg-red-950/40 hover:text-red-300"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>}
              </div>
            ))}
          </div>
        </aside>

        <ArchiveRuntime messages={selectedMessages || []}><ThreadPrimitive.Root className="conversation-reader" data-selected={selectedThread ? '' : undefined}>
          <button type="button" className="conversation-back" onClick={() => setMobileDetail(false)}>{t.workspaceBack}</button>
          {!selectedThread && (
            <div className="flex min-h-[400px] flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 rounded-2xl border border-cyan-900/40 bg-cyan-950/20 p-4 text-cyan-400">
                <MessageSquareText size={26} />
              </div>
              <h3 className="text-lg font-semibold text-zinc-200">{locale === 'tr' ? `Bir ${providerLabel} sohbeti seçin` : `Select a ${providerLabel} thread`}</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">{locale === 'tr' ? 'Sol taraftan bir proje ve sohbet seçtiğinizde, oturumdaki gerçek kullanıcı promptları burada açılır.' : 'Choose a project and thread on the left to open the real user prompts from that session.'}</p>
            </div>
          )}

          {selectedThread && (
            <>
              <header className="conversation-reader-heading">
                <div className="conversation-reader-identity"><p><AgentIcon agent={provider} size={18} />{selectedThread.project}{streamLive && <span className="conversation-live">{t.workspaceLive}</span>}{activity[selectedThread.id] && <span className="handoff-badge">{activity[selectedThread.id].chatType === 'scheduled' ? t.handoff.scheduled : activity[selectedThread.id].chatType === 'normal' ? t.handoff.normal : t.handoff.unknown}</span>}</p><h3 title={selectedThread.title}>{activity[selectedThread.id]?.title || selectedThread.title}</h3></div>
                <details className="conversation-reader-menu"><summary>{t.workspaceActions}</summary><div>
                  <button type="button" onClick={() => void openHandoff(selectedThread)}><Clipboard size={14}/>{t.workspaceHandoff}</button>
                  <button type="button" onClick={() => setReadingOpen(true)} disabled={!selectedMessages?.length}><BookOpen size={14}/>{t.workspaceReading}</button>
                  <button type="button" onClick={() => visibleMessages && handleCopy('all', buildCombinedContent(visibleMessages))} disabled={!visibleMessages?.length}><Copy size={14}/>{copied === 'all' ? t.copiedSuccess : t.workspaceCopyView}</button>
                  <details><summary>{t.workspaceSessionDetails}</summary><p>{selectedThread.id}</p><p>{selectedThread.cwd}</p><p>{promptCount} prompt · {responseCount} {t.handoff.lastReply.toLocaleLowerCase()}</p></details>
                </div></details>
                {visibleMessages && visibleMessages.length > 6 && !handoffThread && !batchOpen && <TranscriptNav messages={visibleMessages} locale={locale} onEnsureRendered={ensureRendered} scrollContainer={messageListRef} />}
              </header>

              <div ref={messageListRef} onScroll={event => { const list = event.currentTarget; followingLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 160; }} className="conversation-scroll p-4 md:p-6">
                <div className="mb-5 flex flex-wrap gap-3 border-b border-zinc-800 pb-4 items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
                      {([
                        ['prompts', locale === 'tr' ? 'Promptlar' : 'Prompts'],
                        ['responses', locale === 'tr' ? 'Cevaplar' : 'Replies'],
                        ['both', locale === 'tr' ? 'Tümü' : 'Both'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={displayMode === mode}
                          onClick={() => setDisplayMode(mode)}
                          className={`rounded-lg px-2.5 py-2 text-xs font-mono font-semibold transition-colors ${displayMode === mode ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-pressed={showTools}
                      onClick={() => setShowTools((value) => !value)}
                      title={locale === 'tr' ? 'Araç çağrıları, çıktıları ve düşünme adımları' : 'Tool calls, outputs and reasoning steps'}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-xs font-mono font-semibold transition-colors ${showTools ? 'border-violet-800/70 bg-violet-500/10 text-violet-300' : 'border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300'}`}
                    >
                      <Wrench size={12} /> {locale === 'tr' ? 'Çalışma izi' : 'Work trace'}
                    </button>
                  </div>
                </div>
                {isPending && (
                  <div className="flex items-center gap-2 rounded-xl border border-cyan-900/40 bg-cyan-950/15 px-4 py-3 text-xs font-mono text-cyan-400"><LoaderCircle size={14} className="animate-spin" /> {locale === 'tr' ? 'Oturum okunuyor…' : 'Reading session…'}</div>
                )}
                {!isPending && selectedThread.provider === 'antigravity' && responseCount === 0 && selectedMessages?.some(message => message.role === 'assistant') && (
                  <p role="status" className="px-4 py-2 text-xs text-zinc-400">{locale === 'tr' ? 'Bu yerel kayıtta nihai yanıt yok. Kaydedilmiş düşünme ve araç adımları gösteriliyor.' : 'No final reply in this local record. Showing recorded reasoning and tool steps.'}</p>
                )}
                {!isPending && visibleMessages?.length === 0 && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-10 text-center text-xs text-zinc-600">{locale === 'tr' ? 'Bu görünümde gösterilecek içerik bulunamadı.' : 'No content found for this view.'}</div>
                )}
                {hiddenBlockCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setWindowSize((size) => size + WINDOW_STEP)}
                    className="mb-3.5 w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-3 text-xs font-mono text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    {locale === 'tr'
                      ? `↑ Daha eskisini göster — ${hiddenBlockCount} blok gizli`
                      : `↑ Show older — ${hiddenBlockCount} blocks hidden`}
                  </button>
                )}
                <div className="harness-transcript flex flex-col gap-3.5">
                  {(() => {
                    return windowedBlocks?.map((block) => {
                      if (block.type === 'tools') {
                        return <ToolTrace key={block.key} items={block.items} locale={locale} />;
                      }
                      if (block.type === 'image') {
                        return (
                          <div key={block.key} data-message-id={block.message.id} className="scroll-mt-24">
                            <TranscriptImage sessionId={selectedThread.id} assetIndex={block.message.assetIndex} locale={locale} />
                          </div>
                        );
                      }
                      if (block.type === 'compaction') return <HarnessCheckpoint key={block.key} id={block.message.id} text={block.message.text} locale={locale} />;
                      const message = block.message.role === 'user' ? { ...block.message, text: conversationText(block.message.text) } : block.message;
                      const isPrompt = message.role === 'user';
                      const isLive = liveIds.has(message.id);
                      const isAnimating = animatingIds.has(message.id);
                      return <AssistantMessage key={message.id} id={message.id} role={isPrompt ? 'user' : 'assistant'} text={message.text} label={isPrompt ? undefined : providerLabel} timestamp={message.timestamp} locale={locale} live={isLive} queued={message.queuedMidTurn}>
                        {/* A live message first reveals word by word, then
                            re-renders as markdown when the reveal ends. Rendering
                            markdown during the reveal would reparse half-finished
                            fences and tables on every frame. */}
                        {isAnimating ? (
                          <StreamingText
                            text={message.text}
                            animate
                            onAdvance={scrollToLatest}
                            onDone={() => setAnimatingIds((ids) => { const next = new Set(ids); next.delete(message.id); return next; })}
                            className="select-text whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-200"
                          />
                        ) : (
                          <MessageMarkdown text={message.text} messageId={message.id} />
                        )}
                      </AssistantMessage>;
                    });
                  })()}
                </div>
              </div>
              <JumpLatest container={messageListRef} locale={locale}/>
              <SessionComposer key={selectedThread.id} kind="archive" sessionId={selectedThread.id} providerLabel={providerLabel} locale={locale} knownMessages={selectedMessages || undefined} onComplete={async () => {
                await syncAgentArchive();
                const messages = await getCodexThreadMessages(selectedThread.id);
                if (selectedIdRef.current === selectedThread.id) setSelectedMessages(messages);
                router.refresh();
              }} />
            </>
          )}
        </ThreadPrimitive.Root></ArchiveRuntime>
      </div>


      {preview && !handoffThread && !readingOpen && !batchOpen && (
        <SessionPreview sessionId={preview.id} anchor={preview.rect} locale={locale} onClose={() => setPreview(null)} />
      )}

      {readingOpen && selectedThread && selectedMessages && (
        <ReadingMode
          thread={selectedThread}
          messages={selectedMessages}
          locale={locale}
          providerLabel={providerLabel}
          onClose={() => setReadingOpen(false)}
        />
      )}

      {handoffThread && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="handoff-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setHandoffThread(null); }}
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/50">
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-900/80 px-5 py-4 md:px-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-[0.2em] text-cyan-400"><FileCode2 size={13} /> Session handoff</p>
                <h2 id="handoff-title" className="mt-2 truncate text-lg font-semibold text-zinc-100 md:text-xl">{handoffThread.title}</h2>
                <p className="mt-1 truncate text-xs font-mono text-zinc-500">{providerDisplayName(handoffThread.provider)} · {handoffThread.project} · {handoffThread.id}</p>
                {handoffSyncing && <p className="mt-2 flex items-center gap-1.5 text-xs font-mono text-cyan-400"><RefreshCw size={11} className="animate-spin" /> {locale === 'tr' ? 'Canlı kaynak sync ediliyor; DB snapshot açık.' : 'Syncing live source; DB snapshot open.'}</p>}
              </div>
              <button type="button" aria-label={locale === 'tr' ? 'Handoff penceresini kapat' : 'Close handoff window'} onClick={() => setHandoffThread(null)} className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"><X size={17} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
              {handoffLoading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 rounded-xl border border-cyan-900/40 bg-cyan-950/10 text-xs font-mono text-cyan-300"><LoaderCircle size={15} className="animate-spin" /> {locale === 'tr' ? 'Sync alınıyor, DB snapshot’ı hazırlanıyor…' : 'Syncing, preparing DB snapshot…'}</div>
              ) : (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <section className="min-w-0 rounded-2xl border border-cyan-900/50 bg-cyan-950/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p data-handoff-heading="markdown" className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-[0.16em] text-cyan-300"><Clipboard size={13} /> Handoff Markdown</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{locale === 'tr' ? 'Yeni sohbete yapıştırılacak taslak. İstersen göndermeden önce düzenleyebilirsin.' : 'Draft to paste into a new chat. You can edit it before sending.'}</p>
                      </div>
                      <button type="button" onClick={() => void copyHandoff()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-800/70 bg-cyan-500/10 px-2.5 py-2 text-xs font-mono font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20">{handoffCopied ? <Check size={12} /> : <Copy size={12} />} {handoffCopied ? (locale === 'tr' ? 'Kopyalandı' : 'Copied') : (locale === 'tr' ? 'Kopyala' : 'Copy')}</button>
                    </div>
                    <textarea value={handoffText} onChange={(event) => setHandoffText(event.target.value)} rows={22} className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-black/30 px-3 py-3 font-mono text-xs leading-5 text-zinc-300 outline-none transition-colors focus:border-cyan-700" aria-label={locale === 'tr' ? 'Handoff Markdown metni' : 'Handoff Markdown text'} />
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-mono leading-5 ${handoffThread.sourceAvailable ? 'border-emerald-900/50 bg-emerald-950/15 text-emerald-300' : 'border-amber-900/50 bg-amber-950/15 text-amber-300'}`}>
                      {handoffThread.sourceAvailable
                        ? (locale === 'tr' ? 'Yerel kaynak erişilebilir; içerik sync sonrası güncel DB kaydından gösteriliyor.' : 'Local source available; content shown from the DB record updated after sync.')
                        : (locale === 'tr' ? 'Yerel kaynak bulunamadı; içerik korunmuş DB fallback kaydından gösteriliyor.' : 'Local source not found; content shown from the preserved DB fallback record.')}
                      <span className="mt-1 block break-all text-zinc-500">{handoffThread.sourcePath || (locale === 'tr' ? 'Kaynak yolu kayıtlı değil' : 'Source path not recorded')}</span>
                      <span className="mt-1 block break-all text-zinc-500">DB fallback: {handoffThread.archiveDbPath || '~/.switchyard/data.db'}</span>
                    </div>
                  </section>

                  <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p data-handoff-heading="transcript" className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-[0.16em] text-zinc-300"><FileText size={13} /> {locale === 'tr' ? 'Tam sohbet içeriği' : 'Full conversation'}</p>
                        <p className="mt-2 text-xs text-zinc-600">{handoffMessages.length} {locale === 'tr' ? 'mesaj · prompt ve agent cevapları eksiksiz' : 'messages · prompts and agent replies in full'}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3">
                      {handoffMessages.length === 0 && <p className="rounded-xl border border-zinc-800 px-4 py-8 text-center text-xs text-zinc-600">{locale === 'tr' ? 'Bu session için DB’de mesaj bulunamadı.' : 'No messages found in the DB for this session.'}</p>}
                      {handoffMessages.map((message, index) => {
                        const isPrompt = message.role === 'user';
                        return (
                          <article key={message.id} data-handoff-message-role={message.role} className={`overflow-hidden rounded-xl border ${isPrompt ? 'border-cyan-900/50 bg-cyan-950/10' : 'border-amber-900/40 bg-amber-950/10'}`}>
                            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-mono">
                              <span className={isPrompt ? 'text-cyan-300' : 'text-amber-300'}>{String(index + 1).padStart(2, '0')} · {isPrompt ? 'PROMPT' : providerReplyLabel(handoffThread.provider)}</span>
                              <span className="text-zinc-700">{formatDate(message.timestamp, locale)}</span>
                            </div>
                            <div className="select-text whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-5 text-zinc-300">{message.text}</div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
            </div>

            <footer className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-900/60 px-5 py-3 md:flex-row md:items-center md:justify-between md:px-6">
              <p className="text-xs font-mono text-zinc-600">{locale === 'tr' ? 'Handoff’u kopyalayıp token’ı biten agent’ın yeni sohbetine ilk mesaj olarak ver.' : 'Copy the handoff and give it as the first message of a new chat for the agent that ran out of tokens.'}</p>
              <button type="button" onClick={() => void copyHandoff()} disabled={handoffLoading || handoffSyncing || !handoffText} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-800/70 bg-cyan-500/10 px-3 py-2 text-xs font-mono font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-40">{handoffCopied ? <Check size={12} /> : <Copy size={12} />} {handoffCopied ? (locale === 'tr' ? 'Handoff kopyalandı' : 'Handoff copied') : (locale === 'tr' ? 'Handoff’u kopyala' : 'Copy handoff')}</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
