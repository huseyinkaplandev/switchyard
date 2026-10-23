'use client';

import { useRef, useState, useEffect, useTransition } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import {
  Bold, Italic, Heading2, Code, Braces, List, Link, Image,
  Minus, ClipboardCopy, Check, Circle, Save, Palette, Plus, Sparkles, Send, Wand2, PanelRightClose, PanelRightOpen
} from 'lucide-react';
import { createTask, updateTaskStatus, listTasks, getDraft as getDraftAction, createDraft, updateDraft, deleteDraft, listDrafts } from '../_actions';
import { AGENTS } from '../_lib/agents';
import { Locale, TRANSLATIONS } from '../_lib/translations';
import DraftSidebar, { DraftItem } from './DraftSidebar';
import AgentIcon from './AgentIcon';
import AILiveEnhancePanel from './AILiveEnhancePanel';
import type { EnhanceTaskResult } from '../api/ai/enhance-task/route';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

type Priority = 'low' | 'normal' | 'high';
type ToolAction = 'bold' | 'italic' | 'heading' | 'code' | 'codeblock' | 'list' | 'link' | 'image' | 'hr';

const TOOL_ACTIONS: { id: ToolAction }[] = [
  { id: 'bold' }, { id: 'italic' }, { id: 'heading' },
  { id: 'code' }, { id: 'codeblock' }, { id: 'list' },
  { id: 'link' }, { id: 'image' }, { id: 'hr' },
];

const TOOL_ICONS: Record<ToolAction, React.ReactNode> = {
  bold: <Bold size={14} />,
  italic: <Italic size={14} />,
  heading: <Heading2 size={14} />,
  code: <Code size={14} />,
  codeblock: <Braces size={14} />,
  list: <List size={14} />,
  link: <Link size={14} />,
  image: <Image size={14} />,
  hr: <Minus size={14} />,
};

type PreviewSettings = {
  fontFamily: string;
  fontSize: string;
  color: string;
};

const FONT_PRESETS = [
  { id: 'sans', label: 'Sans', value: "'Inter','SF Pro','Helvetica Neue',sans-serif" },
  { id: 'serif', label: 'Serif', value: "'Georgia','Times New Roman',serif" },
  { id: 'mono', label: 'Mono', value: "'JetBrains Mono','Fira Code',monospace" },
];

const SIZE_PRESETS = [
  { id: 'sm', label: 'SM', value: '14px' },
  { id: 'md', label: 'MD', value: '16px' },
  { id: 'lg', label: 'LG', value: '18px' },
  { id: 'xl', label: 'XL', value: '21px' },
];

const COLOR_PRESETS = [
  { id: 'zinc', value: '#e4e4e7', label: 'Zinc' },
  { id: 'slate', value: '#e2e8f0', label: 'Slate' },
  { id: 'stone', value: '#e7e5e4', label: 'Stone' },
  { id: 'amber', value: '#fbbf24', label: 'Amber' },
  { id: 'emerald', value: '#6ee7b7', label: 'Emerald' },
];

const DEFAULT_PREVIEW: PreviewSettings = {
  fontFamily: "'Inter','SF Pro','Helvetica Neue',sans-serif",
  fontSize: '16px',
  color: '#e4e4e7',
};

const LS_PREVIEW_KEY = 'prompt-preview-settings';
const LS_TEMPLATE_KEY = 'prompt-template';

const DEFAULT_TEMPLATE_TR = `Aşağıdaki AGENTS.md dosyasını oku ve anladığından emin ol:

~/.switchyard/AGENTS.md

Daha sonra aşağıdaki göreve başla:

---

## Görev

`;

const DEFAULT_TEMPLATE_EN = `Read the AGENTS.md file below and confirm you understand:

~/.switchyard/AGENTS.md

Then start the task below:

---

## Task

`;

function getTemplate(locale: Locale): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(`${LS_TEMPLATE_KEY}-${locale}`);
    if (saved) return saved;
  }
  return locale === 'tr' ? DEFAULT_TEMPLATE_TR : DEFAULT_TEMPLATE_EN;
}

interface PromptTabProps {
  locale: Locale;
  onRefresh: () => void;
}

export default function PromptTab({ locale, onRefresh }: PromptTabProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [priority, setPriority] = useState<Priority>('normal');
  const [assignee, setAssignee] = useState<string>('unassigned');
  const [saving, setSaving] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | undefined>(undefined);
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>(DEFAULT_PREVIEW);
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<EnhanceTaskResult | null>(null);
  const [hasContent, setHasContent] = useState(false);

  const currentDraftIdRef = useRef<string | undefined>(undefined);
  const lastSavedRef = useRef<string | null>(null);
  const lastSaveTimeRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const aiDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastAiBodyRef = useRef<string>('');
  const initializedRef = useRef(false);

  const t = TRANSLATIONS[locale];
  const template = getTemplate(locale);
  const p = locale === 'tr'
    ? { low: 'Düşük', normal: 'Normal', high: 'Yüksek' }
    : { low: 'Low', normal: 'Normal', high: 'High' };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_PREVIEW_KEY);
      if (saved) setPreviewSettings({ ...DEFAULT_PREVIEW, ...JSON.parse(saved) });
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_PREVIEW_KEY, JSON.stringify(previewSettings));
    } catch {}
  }, [previewSettings]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    };
  }, []);

  const priorityIcon = {
    low: <Circle size={10} fill="#a1a1aa" stroke="#a1a1aa" />,
    normal: <Circle size={10} fill="#f59e0b" stroke="#f59e0b" />,
    high: <Circle size={10} fill="#ef4444" stroke="#ef4444" />,
  }[priority];
  const selectedAgent = AGENTS.find(a => a.id === assignee);

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getCurrentMd(): string {
    if (!editorRef.current) return '';
    return turndown.turndown(editorRef.current.innerHTML);
  }

  function setEditorHtml(html: string) {
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      initializedRef.current = true;
    }
  }

  const extractTitle = (text: string): string => {
    const lines = text.split('\n');
    let afterMarker = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## Görev') || trimmed.startsWith('## Task')) {
        afterMarker = true;
        continue;
      }
      if (afterMarker && trimmed) {
        return trimmed.slice(0, 80);
      }
    }
    return locale === 'tr' ? 'Prompt' : 'Prompt';
  };

  const autoSaveDraft = async () => {
    const el = editorRef.current;
    if (!el) return;
    const body = getCurrentMd();
    if (body === lastSavedRef.current || !body) return;
    try {
      const title = extractTitle(body);
      const assigneeVal = assignee === 'unassigned' ? null : assignee;
      if (currentDraftIdRef.current) {
        await updateDraft(currentDraftIdRef.current, { title, body, priority, assignee: assigneeVal });
        setDrafts(prev => prev.map(d =>
          d.id === currentDraftIdRef.current
            ? { ...d, title, body, updated_at: new Date().toISOString() }
            : d
        ));
      } else {
        const created = await createDraft({ title, body, priority, assignee: assigneeVal });
        currentDraftIdRef.current = created.id;
        setSelectedDraftId(created.id);
        setDrafts(prev => [created as DraftItem, ...prev]);
      }
      lastSavedRef.current = body;
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  };

  const autoSaveDraftRef = useRef(autoSaveDraft);
  useEffect(() => { autoSaveDraftRef.current = autoSaveDraft; }, [autoSaveDraft]);

  const triggerAiEnhance = async () => {
    const body = getCurrentMd();
    if (!body || body === lastAiBodyRef.current) return;
    lastAiBodyRef.current = body;
    setAiSuggestLoading(true);
    try {
      const title = extractTitle(body);
      const res = await fetch('/api/ai/enhance-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setAiSuggestion({
        enhancedTitle: data.enhancedTitle || title,
        enhancedBody: data.enhancedBody || body,
        changes: data.changes || [],
        summary: data.summary || '',
      });
    } catch (err) {
      console.error('AI suggest failed:', err);
    } finally {
      setAiSuggestLoading(false);
    }
  };

  const handleInput = () => {
    const now = Date.now();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (now - lastSaveTimeRef.current >= 3000) {
      lastSaveTimeRef.current = now;
      autoSaveDraftRef.current();
    }
    debounceTimerRef.current = setTimeout(() => {
      autoSaveDraftRef.current();
    }, 1000);

    const body = getCurrentMd();
    const hasRealContent = body.length > 20 && !body.startsWith('Aşağıdaki AGENTS');
    setHasContent(hasRealContent);

    if (hasRealContent) {
      if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
      aiDebounceRef.current = setTimeout(() => {
        triggerAiEnhance();
      }, 10000);
    }
  };

  useEffect(() => {
    if (!mounted) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        autoSaveDraftRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [mounted]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listDrafts();
        setDrafts(all as DraftItem[]);
        if (all.length > 0) {
          const latest = all[0];
          currentDraftIdRef.current = latest.id;
          setSelectedDraftId(latest.id);
          setPriority(latest.priority as Priority);
          setAssignee(latest.assignee ?? 'unassigned');
          await renderBody(latest.body);
        } else {
          await renderBody(template);
        }
      } catch {
        await renderBody(template);
      }
      setMounted(true);
    })();
  }, []);

  async function renderBody(body: string) {
    const html = await marked.parse(body, { async: false });
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      initializedRef.current = true;
    }
  }

  const handleNew = () => {
    currentDraftIdRef.current = undefined;
    setSelectedDraftId(undefined);
    setPriority('normal');
    setAssignee('unassigned');
    lastSavedRef.current = null;
    setHasContent(false);
    setAiSuggestion(null);
    renderBody(template);
  };

  const handleSelectDraft = async (id: string) => {
    currentDraftIdRef.current = id;
    setSelectedDraftId(id);
    lastSavedRef.current = null;
    const draft = await getDraftAction(String(id));
    if (draft && editorRef.current) {
      setPriority(draft.priority as Priority);
      setAssignee(draft.assignee ?? 'unassigned');
      await renderBody(draft.body);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    try {
      await deleteDraft(String(id));
      setDrafts(prev => prev.filter(d => d.id !== id));
      if (selectedDraftId === id) {
        currentDraftIdRef.current = undefined;
        setSelectedDraftId(undefined);
        handleNew();
      }
    } catch (err) {
      console.error('Failed to delete draft:', err);
    }
  };

  const handleSnapshot = async () => {
    try {
      setSaving(true);
      const body = getCurrentMd();
      const title = extractTitle(body);
      const assigneeVal = assignee === 'unassigned' ? null : assignee;
      const created = await createDraft({ title, body, priority, assignee: assigneeVal });
      setSnapshotSaved(true);
      setTimeout(() => setSnapshotSaved(false), 2000);
      setDrafts(prev => [created as DraftItem, ...prev]);
    } catch (err) {
      console.error('Snapshot failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleApplySuggestion = async (title: string, body: string) => {
    const html = await marked.parse(body, { async: false });
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      initializedRef.current = true;
    }
    setAiSuggestion(null);
    lastAiBodyRef.current = body;
    lastSavedRef.current = null;
    autoSaveDraftRef.current();
  };

  const handleSaveTask = () => {
    startTransition(async () => {
      try {
        const body = getCurrentMd();
        const title = extractTitle(body);
        const assigneeVal = assignee === 'unassigned' ? null : assignee;
        await createTask({ title, priority, assignee: assigneeVal, body });
        const tasks = await listTasks();
        const created = tasks.find(t => t.body === body);
        if (created) {
          await updateTaskStatus(created.id, 'in_progress');
        }
        onRefresh();
      } catch (err) {
        console.error('Failed to save task:', err);
      }
    });
  };

  const applyTool = (action: ToolAction) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const selectedText = sel?.toString() || '';
    switch (action) {
      case 'bold': document.execCommand('bold'); break;
      case 'italic': document.execCommand('italic'); break;
      case 'heading': document.execCommand('formatBlock', false, '<h2>'); break;
      case 'code':
        if (selectedText) {
          document.execCommand('insertHTML', false, `<code>${escHtml(selectedText)}</code>`);
        } else {
          document.execCommand('insertHTML', false, '<code>kod</code>');
        }
        break;
      case 'codeblock':
        if (selectedText) {
          document.execCommand('insertHTML', false, `<pre><code>${escHtml(selectedText)}</code></pre>`);
        } else {
          document.execCommand('insertHTML', false, '<pre><code>kod</code></pre>');
        }
        break;
      case 'list': document.execCommand('insertUnorderedList'); break;
      case 'link': {
        const url = window.prompt(locale === 'tr' ? 'URL girin:' : 'Enter URL:');
        if (url) {
          if (selectedText) {
            document.execCommand('insertHTML', false, `<a href="${url}">${escHtml(selectedText)}</a>`);
          } else {
            document.execCommand('createLink', false, url);
          }
        }
        break;
      }
      case 'image': {
        const url = window.prompt(locale === 'tr' ? 'Görsel URL\'si girin:' : 'Enter image URL:');
        if (url) {
          if (selectedText) {
            document.execCommand('insertHTML', false, `<img src="${url}" alt="${escHtml(selectedText)}" />`);
          } else {
            document.execCommand('insertImage', false, url);
          }
        }
        break;
      }
      case 'hr': document.execCommand('insertHorizontalRule'); break;
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) return;
        setImgLoading(true);
        (async () => {
          try {
            const body = new FormData();
            body.set('image', file);
            const res = await fetch('/api/upload-image', { method: 'POST', body });
            const { url } = await res.json();
            document.execCommand('insertImage', false, url);
          } catch (err) {
            console.error('Image paste failed:', err);
          } finally {
            setImgLoading(false);
          }
        })();
        return;
      }
    }
    // Paste as clean plain text — strip ALL HTML/formatting/rich content
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    // HTML-escape so browser cannot interpret any markup, then insert
    const safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, safe);
  };

  const handleCopy = async () => {
    const md = getCurrentMd();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const editorStyle: React.CSSProperties = {
    fontFamily: previewSettings.fontFamily,
    fontSize: previewSettings.fontSize,
    color: previewSettings.color,
  };

  return (
    <section
      aria-label="Prompt Editor"
      className="flex border border-zinc-900 rounded-xl overflow-hidden bg-zinc-950/50"
      style={{ maxHeight: 'calc(100vh - 180px)', height: 'calc(100vh - 180px)' }}
    >
      <DraftSidebar
        drafts={drafts}
        locale={locale}
        selectedId={selectedDraftId}
        onSelect={handleSelectDraft}
        onDelete={handleDeleteDraft}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900 bg-zinc-950/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Sparkles size={13} className="text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 font-sans leading-tight">
                {locale === 'tr' ? 'Prompt Sohbet' : 'Prompt Chat'}
              </h2>
              <p className="text-xs text-zinc-600 font-mono">
                {selectedDraftId
                  ? <>#{String(selectedDraftId).slice(-6)} &middot; {locale === 'tr' ? 'taslak' : 'draft'}</>
                  : locale === 'tr' ? 'yeni prompt' : 'new prompt'
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer border border-zinc-800"
            >
              <Plus size={12} />
              {locale === 'tr' ? 'Yeni' : 'New'}
            </button>
          </div>
        </div>

        {/* Config bar - compact */}
        <div className="flex items-center gap-4 px-5 py-2 border-b border-zinc-900 bg-zinc-950/30 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs select-none">{priorityIcon}</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-600 cursor-pointer appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%2371717a%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M4 6l4 4 4-4%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: '22px' }}
            >
              <option value="low">{p.low}</option>
              <option value="normal">{p.normal}</option>
              <option value="high">{p.high}</option>
            </select>
          </div>
          <span className="text-zinc-800 select-none">|</span>
          <div className="flex items-center gap-2">
            {selectedAgent ? <AgentIcon agent={selectedAgent.id} size={16} /> : (
              <div
                className="w-4 h-4 rounded text-[7px] font-bold font-mono text-white flex items-center justify-center select-none shrink-0"
                style={{ backgroundColor: '#3f3f46' }}
              >
                --
              </div>
            )}
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-600 cursor-pointer appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%2371717a%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M4 6l4 4 4-4%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: '22px' }}
            >
              <option value="unassigned">{locale === 'tr' ? 'Atanmadı' : 'Unassigned'}</option>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-1.5 bg-zinc-900/40 border-b border-zinc-800 select-none shrink-0">
          {TOOL_ACTIONS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => applyTool(tool.id)}
              className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
              title={tool.id}
            >
              {TOOL_ICONS[tool.id]}
            </button>
          ))}
          <span className="w-px h-5 bg-zinc-800 mx-1.5" />
          <button
            onClick={handleSnapshot}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded text-xs font-bold transition-colors cursor-pointer ${
              snapshotSaved
                ? 'bg-emerald-900 text-emerald-400'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {snapshotSaved ? <Check size={13} /> : <Save size={13} />}
            {locale === 'tr' ? 'Anlık' : 'Snapshot'}
          </button>
          <button
            onClick={handleCopy}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded text-xs font-bold transition-colors cursor-pointer ${
              copied
                ? 'bg-emerald-900 text-emerald-400'
                : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
            {locale === 'tr' ? 'Kopyala' : 'Copy'}
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
              showSettings ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title={locale === 'tr' ? 'Önizleme ayarları' : 'Preview settings'}
          >
            <Palette size={13} />
          </button>
          <span className="w-px h-5 bg-zinc-800 mx-1" />
          <button
            onClick={() => {
              setShowAiPanel(s => !s);
              if (!showAiPanel) triggerAiEnhance();
            }}
            className={`h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
              showAiPanel ? 'bg-amber-900/30 text-amber-400' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title={locale === 'tr' ? 'AI öneri paneli' : 'AI suggestion panel'}
          >
            {showAiPanel ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
          </button>
        </div>

        {/* Preview settings panel */}
        {showSettings && (
          <div className="flex items-center gap-4 px-4 py-2 bg-zinc-900/40 border-b border-zinc-800 select-none flex-wrap shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-600 font-mono uppercase tracking-wider">Font</span>
              <div className="flex gap-0.5">
                {FONT_PRESETS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setPreviewSettings(s => ({ ...s, fontFamily: f.value }))}
                    className={`text-xs px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                      previewSettings.fontFamily === f.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >{f.label}</button>
                ))}
              </div>
            </div>
            <span className="text-zinc-800 select-none">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-600 font-mono uppercase tracking-wider">Size</span>
              <div className="flex gap-0.5">
                {SIZE_PRESETS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setPreviewSettings(p => ({ ...p, fontSize: s.value }))}
                    className={`text-xs px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                      previewSettings.fontSize === s.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >{s.label}</button>
                ))}
              </div>
            </div>
            <span className="text-zinc-800 select-none">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-600 font-mono uppercase tracking-wider">Color</span>
              <div className="flex gap-1">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setPreviewSettings(s => ({ ...s, color: c.value }))}
                    className={`w-4 h-4 rounded-full border transition-colors cursor-pointer ${
                      previewSettings.color === c.value ? 'border-white ring-1 ring-white' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Editor - fills remaining space */}
        <div ref={editorContainerRef} className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-900/15">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={handlePaste}
            onInput={handleInput}
            style={editorStyle}
            className="w-full min-h-full p-6 md:p-8 leading-relaxed focus:outline-none text-zinc-200 selection:bg-zinc-700/60
              [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-zinc-100 [&_h1]:mt-6 [&_h1]:mb-4
              [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-zinc-100 [&_h2]:mt-5 [&_h2]:mb-3
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_h3]:mt-4 [&_h3]:mb-2
              [&_p]:mb-4 [&_p]:last:mb-0 [&_p]:text-[15px] [&_p]:text-inherit
              [&_strong]:font-bold [&_strong]:text-zinc-100
              [&_em]:italic
              [&_code]:bg-zinc-800 [&_code]:text-amber-300 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:font-mono
              [&_pre]:bg-zinc-900/80 [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:rounded-lg [&_pre]:my-4 [&_pre]:p-5 [&_pre]:text-sm [&_pre]:font-mono [&_pre]:text-zinc-200 [&_pre]:leading-relaxed
              [&_ul]:list-disc [&_ul]:list-inside [&_ul]:mb-4 [&_ul]:space-y-1.5
              [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:mb-4 [&_ol]:space-y-1.5
              [&_li]:text-zinc-300 [&_li]:text-[15px]
              [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-5 [&_blockquote]:py-1.5 [&_blockquote]:mb-4 [&_blockquote]:text-zinc-400 [&_blockquote]:italic
              [&_hr]:border-zinc-800 [&_hr]:my-6
              [&_a]:!text-cyan-400 [&_a]:!underline [&_a]:decoration-cyan-800 [&_a]:underline-offset-2 [&_a]:hover:!text-cyan-300
              [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-zinc-800 [&_img]:my-4"
          />
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-900 bg-zinc-950/80 shrink-0">
          <div className="flex items-center gap-3">
            {imgLoading && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse" />
                {locale === 'tr' ? 'görsel yükleniyor...' : 'image loading...'}
              </span>
            )}
            {saving && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-600 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse" />
                {locale === 'tr' ? 'kaydediliyor...' : 'saving...'}
              </span>
            )}
            {mounted && !saving && !imgLoading && (
              <span className="text-xs text-zinc-700 font-mono flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-800" />
                {locale === 'tr' ? 'otomatik kayit' : 'auto-save'}
              </span>
            )}
          </div>
          <button
            onClick={handleSaveTask}
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none font-mono disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 active:scale-[0.97] text-white shadow-lg shadow-amber-600/20"
          >
            <Send size={13} />
            {isPending
              ? (locale === 'tr' ? 'Kaydediliyor...' : 'Saving...')
              : (locale === 'tr' ? 'Görev Oluştur' : 'Create Task')}
          </button>
        </div>
      </div>
      {showAiPanel && (
        <AILiveEnhancePanel
          loading={aiSuggestLoading}
          suggestion={aiSuggestion}
          hasContent={hasContent}
          locale={locale}
          onApply={handleApplySuggestion}
          onDismiss={() => setAiSuggestion(null)}
        />
      )}
    </section>
  );
}
