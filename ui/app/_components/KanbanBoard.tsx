'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Square, CheckSquare, Trash2, ArrowRight, X, Sparkles, RotateCw } from 'lucide-react';
import { Task, TaskStatus } from '../_lib/parseTask';
import { AGENTS } from '../_lib/agents';
import { Locale, TRANSLATIONS } from '../_lib/translations';
import { updateTaskStatus, bulkUpdateTaskStatus, bulkDeleteTasks } from '../_actions';
import TaskCard from './TaskCard';
import {DataTable} from './assistant-ui/elements/data-table';
import AgentIcon from './AgentIcon';
import ConfirmDialog from './ConfirmDialog';
import Toast, { useToast } from './Toast';

interface KanbanBoardProps {
  tasks: Task[];
  onRefresh: () => void;
  locale: Locale;
}


const COLUMNS: { labelKey: 'inbox' | 'inProgress' | 'review' | 'done'; status: TaskStatus; borderClass: string }[] = [
  { labelKey: 'inbox', status: 'inbox', borderClass: 'border-t-zinc-700' },
  { labelKey: 'inProgress', status: 'in_progress', borderClass: 'border-t-amber-600' },
  { labelKey: 'review', status: 'review', borderClass: 'border-t-purple-600' },
  { labelKey: 'done', status: 'done', borderClass: 'border-t-emerald-600' },
];

export default function KanbanBoard({ tasks, onRefresh, locale }: KanbanBoardProps) {
  const [view,setView]=useState<'table'|'board'>('table');
  const [inspected,setInspected]=useState<string|null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const { toast, show: showToast, clear: clearToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [aiSearchResults, setAiSearchResults] = useState<Set<string> | null>(null);
  const [aiSearching, setAiSearching] = useState(false);
  const t = TRANSLATIONS[locale];

  const columns = COLUMNS.map((c) => ({
    ...c,
    label: (t as any)[c.labelKey] || c.labelKey,
  }));

  const dragOverClasses: Record<TaskStatus, string> = {
    inbox: 'border-zinc-650 bg-zinc-900/10 scale-[1.005] ring-1 ring-zinc-700/20 shadow-[0_0_15px_rgba(255,255,255,0.02)]',
    in_progress: 'border-amber-500/60 bg-amber-950/10 scale-[1.005] ring-1 ring-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.02)]',
    review: 'border-purple-500/60 bg-purple-950/10 scale-[1.005] ring-1 ring-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.02)]',
    done: 'border-emerald-500/60 bg-emerald-950/10 scale-[1.005] ring-1 ring-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.02)]',
  };

  const searchVersion = useRef(0);
  useEffect(() => { searchVersion.current += 1; setAiSearchResults(null); setAiSearching(false); }, [searchQuery]);
  const runAiSearch = async () => {
    const version = ++searchVersion.current;
    setAiSearching(true);
    try {
      const res = await fetch('/api/ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: searchQuery }) });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (version === searchVersion.current) setAiSearchResults(new Set((data.results || []).map((r: { taskId: string }) => r.taskId)));
    } catch { if (version === searchVersion.current) setAiSearchResults(null); }
    finally { if (version === searchVersion.current) setAiSearching(false); }
  };
  const filteredTasks = aiSearchResults
    ? tasks.filter(task => aiSearchResults.has(task.id))
    : tasks.filter(task => [task.id, task.title, task.body, task.assignee || ''].join(' ').toLocaleLowerCase(locale).includes(searchQuery.trim().toLocaleLowerCase(locale)));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((status: TaskStatus) => {
    setSelectedIds((prev) => {
      const colTaskIds = filteredTasks.filter((t) => t.status === status).map((t) => t.id);
      const allSelected = colTaskIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        colTaskIds.forEach((id) => next.delete(id));
      } else {
        colTaskIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [filteredTasks]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const confirmBulkDelete = async () => {
    setShowBulkDeleteConfirm(false);
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkDeleteTasks(ids);
      showToast({ message: locale === 'tr' ? `${ids.length} görev silindi` : `${ids.length} task(s) deleted`, type: 'success' });
      clearSelection();
      onRefresh();
    } catch (err) {
      showToast({ message: locale === 'tr' ? 'Silme başarısız' : 'Delete failed', type: 'error' });
    }
  };

  const confirmBulkStatus = async (status: TaskStatus) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await bulkUpdateTaskStatus(ids, status);
      const col = columns.find((c) => c.status === status);
      showToast({ message: locale === 'tr' ? `${ids.length} görev taşındı` : `${ids.length} task(s) moved`, type: 'success' });
      clearSelection();
      onRefresh();
    } catch (err) {
      showToast({ message: locale === 'tr' ? 'Taşıma başarısız' : 'Move failed', type: 'error' });
    }
  };

  // Auto progress
  const [autoProgressLoading, setAutoProgressLoading] = useState(false);
  const [autoProgressSuggestions, setAutoProgressSuggestions] = useState<Array<{
    taskId: string;
    suggestedStatus: string;
    confidence: number;
    reason: string;
  }> | null>(null);

  const handleAutoProgress = async () => {
    setAutoProgressLoading(true);
    setAutoProgressSuggestions(null);
    try {
      const res = await fetch('/api/ai/analyze-logs', { method: 'POST' });
      const data = await res.json();
      if (data.updates && data.updates.length > 0) {
        setAutoProgressSuggestions(data.updates);
        showToast({
          message: locale === 'tr'
            ? `${data.updates.length} statü değişikliği önerildi`
            : `${data.updates.length} status changes suggested`,
          type: 'success',
        });
      } else {
        showToast({
          message: locale === 'tr' ? 'Değişiklik bulunamadı' : 'No changes found',
          type: 'success',
        });
      }
    } catch {
      showToast({
        message: locale === 'tr' ? 'AI analiz hatası' : 'AI analysis error',
        type: 'error',
      });
    } finally {
      setAutoProgressLoading(false);
    }
  };

  const selCount = selectedIds.size;
  const statuses: TaskStatus[] = ['inbox', 'in_progress', 'review', 'done'];
  const hasAiFilter = aiSearchResults !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk Action Toolbar */}
      {selCount > 0 && (
        <div className="sticky top-0 z-20 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-3 select-none">
          <span className="text-xs font-mono text-zinc-300 font-semibold mr-2">
            {t.selected(selCount)}
          </span>
          <div className="flex items-center gap-1.5">
            {statuses.map((s) => {
              const col = columns.find((c) => c.status === s)!;
              return (
                <button
                  key={s}
                  onClick={() => confirmBulkStatus(s)}
                  className="text-xs font-mono font-semibold px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
                >
                  <ArrowRight size={10} className="inline mr-1" />
                  {col.label}
                </button>
              );
            })}
          </div>
          <span className="text-zinc-700 select-none mx-1">|</span>
          <button
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="text-xs font-mono font-semibold px-2 py-1 rounded bg-red-950/40 border border-red-900/50 text-red-400 hover:bg-red-900/40 transition-colors cursor-pointer flex items-center gap-1"
          >
            <Trash2 size={10} />
            {t.deleteSelected}
          </button>
          <button
            onClick={clearSelection}
            className="ml-auto text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1"
          >
            <X size={12} />
            {locale === 'tr' ? 'İptal' : 'Cancel'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        title={t.deleteSelected}
        message={locale === 'tr' ? `${selCount} görevi silmek istediğinize emin misiniz?` : `Delete ${selCount} task(s)?`}
        confirmLabel={locale === 'tr' ? 'Sil' : 'Delete'}
        cancelLabel={t.cancel}
        destructive
        onConfirm={confirmBulkDelete}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />

      <Toast toast={toast} onClear={clearToast} />

      {/* AI Search + Auto Progress Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t.searchTasks} placeholder={t.searchTasks}
            className="w-full bg-zinc-950 border border-zinc-900 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 transition-colors"
          />
          {aiSearching && (
            <Sparkles size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 animate-pulse" />
          )}
          {hasAiFilter && !aiSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-cyan-500">AI</span>
          )}
        </div>
        <button type="button" onClick={runAiSearch} disabled={aiSearching || !searchQuery.trim()} className="px-3 py-2 rounded-lg border border-zinc-700 text-xs disabled:opacity-40">{t.workspaceAiSearch}</button>
        <button
          onClick={handleAutoProgress}
          disabled={autoProgressLoading}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg bg-cyan-950/40 border border-cyan-900/50 text-cyan-400 hover:bg-cyan-900/40 transition-all cursor-pointer disabled:opacity-50 shrink-0"
          title={t.autoProgressTitle}
        >
          <RotateCw size={11} className={autoProgressLoading ? 'animate-spin' : ''} />
          {autoProgressLoading
            ? (locale === 'tr' ? 'Analiz' : 'Checking')
            : (locale === 'tr' ? 'Status Kontrol' : 'Check Status')}
        </button>
      </div>

      {/* Auto Progress Suggestions */}
      {autoProgressSuggestions && autoProgressSuggestions.length > 0 && (
        <div className="bg-cyan-950/20 border border-cyan-900/40 rounded-lg px-3 py-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-cyan-400 font-semibold">
              {locale === 'tr' ? 'Önerilen Değişiklikler' : 'Suggested Changes'}
            </span>
            <button
              onClick={() => setAutoProgressSuggestions(null)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
          {autoProgressSuggestions.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono">
              <span className="text-zinc-500">{s.taskId}</span>
              <ArrowRight size={9} className="text-zinc-600" />
              <span className={`font-semibold ${
                s.suggestedStatus === 'done' ? 'text-emerald-400' :
                s.suggestedStatus === 'review' ? 'text-purple-400' :
                s.suggestedStatus === 'in_progress' ? 'text-amber-400' : 'text-zinc-400'
              }`}>{s.suggestedStatus}</span>
              <span className="text-zinc-600 truncate">{s.reason}</span>
              <span className="text-zinc-700 ml-auto">
                {Math.round(s.confidence * 100)}%
              </span>
            </div>
          ))}
          <button
            onClick={async () => {
              for (const s of autoProgressSuggestions.filter(x => x.confidence >= 0.7)) {
                try {
                  await updateTaskStatus(s.taskId, s.suggestedStatus as TaskStatus);
                } catch {}
              }
              setAutoProgressSuggestions(null);
              onRefresh();
            }}
            className="self-start text-xs font-mono px-2 py-1 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-700/40 hover:bg-cyan-600/30 transition-all cursor-pointer mt-1"
          >
            {locale === 'tr' ? 'Yüksek Güvenilirleri Uygula' : 'Apply High Confidence'}
          </button>
        </div>
      )}

      {/* Kanban Grid */}
      <div className="aui-view-switch"><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')}>{t.auiTable}</button><button type="button" aria-pressed={view==='board'} onClick={()=>setView('board')}>{t.auiBoard}</button></div>
      {view==='table'&&<><DataTable locale={locale} rowKey="id" emptyMessage={t.workspaceNoMatches} columns={[{key:'selected',label:t.selectAll,sortable:false},{key:'title',label:locale==='tr'?'Görev':'Task',priority:'primary'},{key:'status',label:t.workspaceStatus},{key:'agent',label:'Agent'},{key:'priority',label:locale==='tr'?'Öncelik':'Priority'},{key:'created',label:locale==='tr'?'Oluşturuldu':'Created',format:{kind:'date'}},{key:'actions',label:t.auiDetails,sortable:false}]}
       rows={filteredTasks.map(task=>({id:task.id,title:task.title,status:columns.find(c=>c.status===task.status)?.label||task.status,agent:task.assignee||'—',priority:task.priority,created:task.created}))}
       renderCell={(row,column)=>column.key==='selected'?<input type="checkbox" aria-label={`${t.selectAll}: ${row.title}`} checked={selectedIds.has(String(row.id))} onChange={()=>toggleSelect(String(row.id))}/>:column.key==='agent'?<span className="aui-inline"><AgentIcon agent={String(row.agent)}/>{row.agent}</span>:column.key==='actions'?<button type="button" onClick={()=>setInspected(inspected===row.id?null:String(row.id))}>{t.auiDetails}</button>:undefined}/>
       {inspected&&filteredTasks.filter(task=>task.id===inspected).map(task=><TaskCard key={task.id} task={task} onRefresh={onRefresh} locale={locale} selected={selectedIds.has(task.id)} onToggleSelect={()=>toggleSelect(task.id)}/>)}</>}
      {view==='board'&&<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {columns.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);
          const allSelected = colTasks.length > 0 && colTasks.every((t) => selectedIds.has(t.id));

          // Unique agents in this column
          const agentIds = [...new Set(colTasks.map((t) => t.assignee).filter(Boolean))] as string[];
          const colAgents = AGENTS.filter((a) => agentIds.includes(a.id));

          return (
            <div
              key={col.status}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => handleDragEnter(e, col.status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.status)}
              className={`bg-zinc-950/40 border border-zinc-900 rounded-xl p-4 flex flex-col gap-4 border-t-4 transition-all duration-200 ${col.borderClass} ${
                dragOverCol === col.status ? dragOverClasses[col.status] : ''
              }`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 border-b border-zinc-900/50 select-none">
                <div className="flex items-center gap-2 min-w-0">
                  {colTasks.length > 0 && (
                    <button
                      onClick={() => toggleSelectAll(col.status)}
                      className="shrink-0 cursor-pointer text-zinc-600 hover:text-zinc-300 transition-colors"
                      title={allSelected ? t.deselectAll : t.selectAll}
                    >
                      {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                    </button>
                  )}
                  <h3 className="font-semibold text-xs text-zinc-300 font-sans truncate">
                    {col.label}
                  </h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Agent avatars for this column */}
                  {colAgents.length > 0 && (
                    <div className="flex items-center -space-x-1">
                      {colAgents.slice(0, 4).map((a) => (
                        <span key={a.id} title={a.name} className="flex rounded ring-1 ring-zinc-950">
                          <AgentIcon agent={a.id} size={16} />
                        </span>
                      ))}
                      {colAgents.length > 4 && (
                        <span className="text-xs font-mono text-zinc-500 ml-1">
                          +{colAgents.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-semibold ${
                    col.status === 'inbox' ? 'bg-zinc-900 text-zinc-400 border border-zinc-850' :
                    col.status === 'in_progress' ? 'bg-amber-950/40 text-amber-400 border border-amber-900/50' :
                    col.status === 'review' ? 'bg-purple-950/40 text-purple-400 border border-purple-900/50' :
                    'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
                  }`}>
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Tasks Container */}
              <div className="flex flex-col gap-3 min-h-[300px] overflow-y-auto max-h-[70vh] custom-scrollbar pr-0.5">
                {colTasks.length === 0 ? (
                  <div className="text-xs text-zinc-650 italic py-12 text-center font-mono select-none">
                    {locale === 'tr' ? 'Görev bulunmuyor' : 'No tasks here'}
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onRefresh={onRefresh}
                      locale={locale}
                      selected={selectedIds.has(task.id)}
                      onToggleSelect={() => toggleSelect(task.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );

  function handleDragEnter(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOverCol(status);
  }

  function handleDragLeave() {
    setDragOverCol(null);
  }

  async function handleDrop(e: React.DragEvent, targetStatus: TaskStatus) {
    e.preventDefault();
    setDragOverCol(null);

    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    try {
      await updateTaskStatus(taskId, targetStatus);
      onRefresh();
    } catch (err) {
      console.error(`Failed to drag & drop update status to ${targetStatus}:`, err);
    }
  }
}
