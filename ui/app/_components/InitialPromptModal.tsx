'use client';

import { useRef, useState, useEffect, useTransition } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { Bold, Italic, Heading2, Code, Braces, List, Link, Image, Minus, ClipboardCopy, Check, Circle, Save, Palette, Wand2 } from 'lucide-react';
import { createTask, updateTaskStatus, listTasks, updateTask, getDraft as getDraftAction, createDraft, deleteDraft, listDrafts } from '../_actions';
import { AGENTS } from '../_lib/agents';
import { Locale } from '../_lib/translations';
import type { Task } from '../_lib/parseTask';
import DraftSidebar, { DraftItem } from './DraftSidebar';
import AgentIcon from './AgentIcon';
import AIEnhanceModal from './AIEnhanceModal';
import type { EnhanceTaskResult } from '../api/ai/enhance-task/route';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

type Priority = 'low' | 'normal' | 'high';

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
  { id: 'xs', label: 'XS', value: '12px' },
  { id: 'sm', label: 'SM', value: '14px' },
  { id: 'md', label: 'MD', value: '16px' },
  { id: 'lg', label: 'LG', value: '18px' },
];

const COLOR_PRESETS = [
  { id: 'zinc', value: '#e4e4e7' },
  { id: 'slate', value: '#e2e8f0' },
  { id: 'stone', value: '#e7e5e4' },
  { id: 'amber', value: '#fbbf24' },
  { id: 'emerald', value: '#6ee7b7' },
];

const DEFAULT_PREVIEW: PreviewSettings = {
  fontFamily: "'Inter','SF Pro','Helvetica Neue',sans-serif",
  fontSize: '14px',
  color: '#e4e4e7',
};

const LS_PREVIEW_KEY = 'prompt-preview-settings';
const LS_WORKING_KEY = 'prompt-working';

interface WorkingState {
  body: string;
  priority: Priority;
  assignee: string;
}

interface InitialPromptModalProps {
  onRefresh: () => void;
  locale: Locale;
  editingTask?: Task;
}

export default function InitialPromptModal({ onRefresh, locale, editingTask }: InitialPromptModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [priority, setPriority] = useState<Priority>('normal');
  const [assignee, setAssignee] = useState<string>('unassigned');
  const [saving, setSaving] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | undefined>(undefined);
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>(DEFAULT_PREVIEW);
  const [enhanceModalOpen, setEnhanceModalOpen] = useState(false);
  const [enhanceLoading, setEnhanceLoading] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhanceResult, setEnhanceResult] = useState<EnhanceTaskResult | null>(null);
  const [pendingTask, setPendingTask] = useState<{
    title: string;
    body: string;
    priority: Priority;
    assignee: string | null;
  } | null>(null);

  const lastSaveTimeRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initializedRef = useRef(false);
  const initialMdRef = useRef<string>('');

  const template = getTemplate(locale);

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

  const p = locale === 'tr'
    ? { low: 'Düşük', normal: 'Normal', high: 'Yüksek' }
    : { low: 'Low', normal: 'Normal', high: 'High' };
  const t = locale === 'tr'
    ? { headerCreate: 'LLM Başlangıç Promptu', headerEdit: 'Görevi Düzenle',
        saveStart: 'Kaydet & Başlat', createStart: 'Oluştur & Başlat', save: 'Kaydet',
        copyMd: 'Markdown Kopyala', saveDraft: 'Taslağı Kaydet',
        imgPrompt: 'Görsel URL\'si girin:' }
    : { headerCreate: 'LLM Initial Prompt', headerEdit: 'Edit Task',
        saveStart: 'Save & Start', createStart: 'Create & Start', save: 'Save',
        copyMd: 'Copy Markdown', saveDraft: 'Save Draft',
        imgPrompt: 'Enter image URL:' };

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
    if (!editorRef.current) return initialMdRef.current;
    return turndown.turndown(editorRef.current.innerHTML);
  }

  function setEditorHtml(html: string) {
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      initializedRef.current = true;
    }
  }

  function saveToLocalStorage() {
    try {
      const body = getCurrentMd();
      const state: WorkingState = { body, priority, assignee };
      localStorage.setItem(LS_WORKING_KEY, JSON.stringify(state));
    } catch {}
  }

  const extractTitle = (text: string): string => {
    if (editingTask) return editingTask.title;
    const lines = text.split('\n');
    let afterMarker = false;
    for (const line of lines) {
      if (line.trim().startsWith('## Görev') || line.trim().startsWith('## Task')) {
        afterMarker = true;
        continue;
      }
      if (afterMarker && line.trim()) {
        return line.trim().slice(0, 80);
      }
    }
    return locale === 'tr' ? 'LLM Prompt Görevi' : 'LLM Prompt Task';
  };

  const loadDrafts = async () => {
    try {
      const all = await listDrafts();
      setDrafts(all as DraftItem[]);
    } catch (err) {
      console.error('Failed to load drafts:', err);
    }
  };

  const handleOpen = async () => {
    let initialMd: string;
    let initialPriority: Priority = 'normal';
    let initialAssignee = 'unassigned';

    if (editingTask) {
      initialMd = editingTask.body;
      initialPriority = editingTask.priority;
      initialAssignee = editingTask.assignee ?? 'unassigned';
    } else if (selectedDraftId) {
      const draft = await getDraftAction(String(selectedDraftId));
      if (draft) {
        initialMd = draft.body;
        initialPriority = draft.priority as Priority;
        initialAssignee = draft.assignee ?? 'unassigned';
      } else {
        initialMd = template;
      }
    } else {
      const saved = localStorage.getItem(LS_WORKING_KEY);
      if (saved) {
        try {
          const state: WorkingState = JSON.parse(saved);
          initialMd = state.body || template;
          initialPriority = state.priority || 'normal';
          initialAssignee = state.assignee || 'unassigned';
        } catch {
          initialMd = template;
        }
      } else {
        initialMd = template;
      }
    }

    initialMdRef.current = initialMd;
    setPriority(initialPriority);
    setAssignee(initialAssignee);
    setCopied(false);
    setDraftSaved(false);
    lastSaveTimeRef.current = 0;
    initializedRef.current = false;
    dialogRef.current?.showModal();
    await loadDrafts();
    requestAnimationFrame(async () => {
      const html = await marked.parse(initialMd, { async: false });
      setEditorHtml(html);
    });
  };

  const handleClose = () => {
    if (!selectedDraftId) saveToLocalStorage();
    dialogRef.current?.close();
  };

  const handleSaveDraft = async () => {
    try {
      setSaving(true);
      const body = getCurrentMd();
      const title = extractTitle(body);
      const assigneeVal = assignee === 'unassigned' ? null : assignee;
      const created = await createDraft({ title, body, priority, assignee: assigneeVal });
      setDraftSaved(true);
      setSelectedDraftId(created.id);
      setTimeout(() => setDraftSaved(false), 2000);
      await loadDrafts();
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDraft = async (id: string) => {
    setSelectedDraftId(id);
    const draft = await getDraftAction(String(id));
    if (draft && editorRef.current && dialogRef.current?.open) {
      initialMdRef.current = draft.body;
      setPriority(draft.priority as Priority);
      setAssignee(draft.assignee ?? 'unassigned');
      const html = await marked.parse(draft.body, { async: false });
      setEditorHtml(html);
    }
  };

  const handleDeleteDraft = async (id: string) => {
    try {
      await deleteDraft(String(id));
      setDrafts(prev => prev.filter(d => d.id !== id));
      if (selectedDraftId === id) setSelectedDraftId(undefined);
    } catch (err) {
      console.error('Failed to delete draft:', err);
    }
  };

  const handleInput = () => {
    const now = Date.now();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (now - lastSaveTimeRef.current >= 3000) {
      lastSaveTimeRef.current = now;
      saveToLocalStorage();
    }

    debounceTimerRef.current = setTimeout(() => {
      saveToLocalStorage();
    }, 1000);
  };

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && dialogRef.current?.open) {
        if (!selectedDraftId) saveToLocalStorage();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [selectedDraftId]);

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
        const url = window.prompt(t.imgPrompt);
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
        const url = window.prompt(t.imgPrompt);
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

  const doSaveTask = async (body: string, title: string, assigneeVal: string | null) => {
    if (editingTask) {
      await updateTask(editingTask.id, { title, priority, assignee: assigneeVal, body });
    } else {
      await createTask({ title, priority, assignee: assigneeVal, body });
      const tasks = await listTasks();
      const created = tasks.find(t => t.body === body);
      if (created) {
        await updateTaskStatus(created.id, 'in_progress');
      }
    }
    localStorage.removeItem(LS_WORKING_KEY);
    dialogRef.current?.close();
    onRefresh();
  };

  const handleEnhanceApprove = async (editedTitle: string) => {
    if (!pendingTask || !enhanceResult) return;
    setEnhanceModalOpen(false);
    startTransition(async () => {
      try {
        await doSaveTask(enhanceResult.enhancedBody, editedTitle, pendingTask.assignee);
      } catch (err) {
        console.error('Failed to save enhanced task:', err);
      }
    });
  };

  const handleEnhanceReject = async () => {
    if (!pendingTask) return;
    setEnhanceModalOpen(false);
    startTransition(async () => {
      try {
        await doSaveTask(pendingTask.body, pendingTask.title, pendingTask.assignee);
      } catch (err) {
        console.error('Failed to save original task:', err);
      }
    });
  };

  const handleSave = () => {
    const body = getCurrentMd();
    const title = editingTask?.title ?? extractTitle(body);
    const assigneeVal = assignee === 'unassigned' ? null : assignee;
    const taskData = { title, body, priority, assignee: assigneeVal };

    // For editing existing tasks, skip AI enhancement
    if (editingTask) {
      startTransition(async () => {
        try {
          await doSaveTask(body, title, assigneeVal);
        } catch (err) {
          console.error('Failed to save:', err);
        }
      });
      return;
    }

    // New task: show AI enhancement modal
    setPendingTask(taskData);
    setEnhanceLoading(true);
    setEnhanceError(null);
    setEnhanceResult(null);
    setEnhanceModalOpen(true);

    (async () => {
      try {
        const res = await fetch('/api/ai/enhance-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body }),
        });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        setEnhanceResult({
          enhancedTitle: data.enhancedTitle || title,
          enhancedBody: data.enhancedBody || body,
          changes: data.changes || [],
          summary: data.summary || '',
        });
      } catch (err: any) {
        setEnhanceError(err.message || 'AI enhancement failed');
        console.error('Enhancement failed:', err);
      } finally {
        setEnhanceLoading(false);
      }
    })();
  };

  const editorStyle: React.CSSProperties = {
    fontFamily: previewSettings.fontFamily,
    fontSize: previewSettings.fontSize,
    color: previewSettings.color,
  };

  return (
    <>
      <button
        data-edit-btn
        onClick={handleOpen}
        className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-xs transition-colors cursor-pointer select-none"
      >
        {editingTask ? (locale === 'tr' ? 'Düzenle' : 'Edit') : (locale === 'tr' ? 'LLM Prompt' : 'LLM Prompt')}
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (dialogContentRef.current && !dialogContentRef.current.contains(e.target as Node)) {
            handleClose();
          }
        }}
        className="fixed inset-0 m-auto h-fit bg-zinc-950 border border-zinc-900 rounded-xl shadow-2xl focus:outline-none backdrop:bg-black/30 backdrop:backdrop-blur-sm max-w-[90vw] w-[1400px]"
      >
        <div ref={dialogContentRef} className="flex max-h-[90vh]">
          {/* Draft sidebar inside modal */}
          <DraftSidebar
            drafts={drafts}
            locale={locale}
            selectedId={selectedDraftId}
            onSelect={handleSelectDraft}
            onDelete={handleDeleteDraft}
          />

          {/* Main editor area */}
          <div className="flex-1 p-5 overflow-y-auto custom-scrollbar min-w-0">
            <div className="pb-4 border-b border-zinc-900 select-none">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm font-sans text-zinc-200">
                  {editingTask ? `${t.headerEdit} — ${editingTask.id}` : t.headerCreate}
                  {selectedDraftId && !editingTask && <span className="text-zinc-600 font-mono text-[10px] ml-2">#{String(selectedDraftId).slice(-6)}</span>}
                </h3>
                <div className="flex items-center gap-3">
                  {imgLoading && (
                    <span className="text-[10px] text-zinc-500 font-mono select-none">
                      {locale === 'tr' ? 'görsel yükleniyor...' : 'image loading...'}
                    </span>
                  )}
                  {saving && (
                    <span className="text-[10px] text-zinc-600 font-mono select-none">
                      {locale === 'tr' ? 'kaydediliyor...' : 'saving...'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Config bar: Priority + Assignee */}
            <div className="flex items-center gap-4 py-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <span className="text-xs select-none">{priorityIcon}</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="bg-zinc-900 border border-zinc-850 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 cursor-pointer appearance-none"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%2371717a%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M4 6l4 4 4-4%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: '24px' }}
                >
                  <option value="low">{p.low}</option>
                  <option value="normal">{p.normal}</option>
                  <option value="high">{p.high}</option>
                </select>
              </div>
              <span className="text-zinc-800 select-none">|</span>
              <div className="flex items-center gap-2">
                {selectedAgent ? <AgentIcon agent={selectedAgent.id} size={20} /> : (
                  <div
                    className="w-5 h-5 rounded text-[8px] font-bold font-mono text-white flex items-center justify-center select-none shrink-0"
                    style={{ backgroundColor: '#3f3f46' }}
                  >
                    --
                  </div>
                )}
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="bg-zinc-900 border border-zinc-850 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 cursor-pointer appearance-none"
                  style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%2371717a%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M4 6l4 4 4-4%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: '24px' }}
                >
                  <option value="unassigned">{locale === 'tr' ? 'Atanmadı' : 'Unassigned'}</option>
                  {AGENTS.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded-t-lg mt-3 select-none">
                {TOOL_ACTIONS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => applyTool(tool.id)}
                  className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  {TOOL_ICONS[tool.id]}
                </button>
              ))}
              <span className="w-px h-5 bg-zinc-800 mx-1" />
              <button
                onClick={handleSaveDraft}
                title={t.saveDraft}
                className={`h-7 flex items-center gap-1.5 px-2.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                  draftSaved
                    ? 'bg-emerald-900 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                }`}
              >
                {draftSaved ? <Check size={13} /> : <Save size={13} />}
                {t.saveDraft}
              </button>
              <button
                onClick={handleCopy}
                title={t.copyMd}
                className={`h-7 flex items-center gap-1.5 px-2.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                  copied
                    ? 'bg-emerald-900 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                }`}
              >
                {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                {t.copyMd}
              </button>
              <button
                onClick={() => setShowSettings(s => !s)}
                title={locale === 'tr' ? 'Önizleme ayarları' : 'Preview settings'}
                className={`h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
                  showSettings ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                <Palette size={13} />
              </button>
            </div>

            {/* Preview settings panel */}
            {showSettings && (
              <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900 border-x border-zinc-800 select-none flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500 font-mono mr-1">Font</span>
                  {FONT_PRESETS.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setPreviewSettings(s => ({ ...s, fontFamily: f.value }))}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                        previewSettings.fontFamily === f.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>
                <span className="text-zinc-800 select-none hidden sm:inline">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500 font-mono mr-1">Size</span>
                  {SIZE_PRESETS.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setPreviewSettings(p => ({ ...p, fontSize: s.value }))}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                        previewSettings.fontSize === s.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >{s.label}</button>
                  ))}
                </div>
                <span className="text-zinc-800 select-none hidden sm:inline">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-500 font-mono mr-1">Color</span>
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setPreviewSettings(s => ({ ...s, color: c.value }))}
                      className={`w-4 h-4 rounded-full border transition-colors cursor-pointer ${
                        previewSettings.color === c.value ? 'border-white ring-1 ring-white' : 'border-zinc-700'
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* WYSIWYG Editor (contentEditable) */}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onPaste={handlePaste}
              onInput={handleInput}
              style={editorStyle}
              className="w-full bg-zinc-900 border border-zinc-800 p-5 min-h-[400px] max-h-[55vh] overflow-y-auto custom-scrollbar leading-relaxed text-sm focus:outline-none text-zinc-200 selection:bg-zinc-700/60 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-zinc-100 [&_h1]:mt-5 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-zinc-100 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-zinc-100 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_p]:mb-3 [&_p]:last:mb-0 [&_p]:text-inherit [&_strong]:font-bold [&_strong]:text-zinc-100 [&_em]:italic [&_code]:bg-zinc-800 [&_code]:text-amber-300 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:font-mono [&_pre]:bg-zinc-900/80 [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:rounded-lg [&_pre]:my-3 [&_pre]:p-4 [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-zinc-200 [&_pre]:leading-relaxed [&_ul]:list-disc [&_ul]:list-inside [&_ul]:mb-3 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:mb-3 [&_ol]:space-y-1 [&_li]:text-zinc-300 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-4 [&_blockquote]:py-1 [&_blockquote]:mb-3 [&_blockquote]:text-zinc-400 [&_blockquote]:italic [&_hr]:border-zinc-800 [&_hr]:my-4 [&_a]:!text-cyan-400 [&_a]:!underline [&_a]:decoration-cyan-800 [&_a]:underline-offset-2 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-zinc-800 [&_img]:my-3"
            />

            <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-zinc-900">
              <button
                onClick={handleSave}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer select-none font-mono disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white"
              >
                {isPending
                  ? (locale === 'tr' ? 'Kaydediliyor...' : 'Saving...')
                  : editingTask
                    ? t.save
                    : t.createStart}
              </button>
            </div>
          </div>
        </div>
      </dialog>

      <AIEnhanceModal
        open={enhanceModalOpen}
        loading={enhanceLoading}
        error={enhanceError}
        originalTitle={pendingTask?.title || ''}
        originalBody={pendingTask?.body || ''}
        enhancement={enhanceResult}
        locale={locale}
        onApprove={handleEnhanceApprove}
        onReject={handleEnhanceReject}
        onClose={() => {
          if (!enhanceLoading) {
            setEnhanceModalOpen(false);
            handleEnhanceReject();
          }
        }}
      />
    </>
  );
}
