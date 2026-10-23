'use client';

import { useState, useTransition, useRef } from 'react';
import { Check, Copy, Trash2, Square, CheckSquare, Sparkles, ArrowRight, X, RotateCw } from 'lucide-react';
import { Task, TaskStatus } from '../_lib/parseTask';
import { AGENTS } from '../_lib/agents';
import { updateTaskAssignee, updateTaskStatus, buildPrompt, deleteTask } from '../_actions';
import { Locale, TRANSLATIONS } from '../_lib/translations';
import InitialPromptModal from './InitialPromptModal';
import AgentIcon from './AgentIcon';
import ConfirmDialog from './ConfirmDialog';

interface TaskCardProps {
  task: Task;
  onRefresh: () => void;
  locale: Locale;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export default function TaskCard({ task, onRefresh, locale, selected = false, onToggleSelect }: TaskCardProps) {
  const [isCopyPending, startCopyTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const t = TRANSLATIONS[locale];

  const assigneeMeta = AGENTS.find((a) => a.id === task.assignee);

  const priorityColor = {
    high: 'bg-red-500 shadow-[0_0_8px_#ef4444]',
    normal: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]',
    low: 'bg-zinc-600',
  }[task.priority];

  const priorityLabel = {
    high: t.priorityHigh,
    normal: t.priorityNormal,
    low: t.priorityLow,
  }[task.priority];

  // Drag started callback
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Delete handler
  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteTask(task.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  // Inline assignee handler
  const handleAssigneeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextAssignee = e.target.value === 'unassigned' ? null : e.target.value;
    try {
      await updateTaskAssignee(task.id, nextAssignee);
      onRefresh();
    } catch (err) {
      console.error('Failed to change assignee:', err);
    }
  };

  // AI classification state
  const [aiClassifying, setAiClassifying] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{
    priority?: string;
    suggestedStatus?: string;
    reason: string;
  } | null>(null);

  const handleAiSuggest = async () => {
    setAiClassifying(true);
    setAiSuggestion(null);
    try {
      const res = await fetch('/api/ai/classify-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: task.title, body: task.body, taskId: task.id }),
      });
      const data = await res.json();
      if (data.doneCheck && data.doneCheck.isDone && data.doneCheck.confidence > 0.7) {
        setAiSuggestion({
          suggestedStatus: 'done',
          reason: data.doneCheck.reason,
        });
      } else if (data.classification) {
        setAiSuggestion({
          priority: data.classification.priority,
          reason: data.classification.reason,
        });
      }
    } catch {
      setAiSuggestion({ reason: 'AI connection error' });
    } finally {
      setAiClassifying(false);
    }
  };

  const handleApplySuggestion = async () => {
    if (!aiSuggestion?.suggestedStatus) return;
    try {
      await updateTaskStatus(task.id, aiSuggestion.suggestedStatus as TaskStatus);
      onRefresh();
      setAiSuggestion(null);
    } catch {}
  };

  // Copy prompt handler + optimistic progression to in_progress
  const handleCopyPrompt = () => {
    startCopyTransition(async () => {
      try {
        const prompt = await buildPrompt(task.id);
        await navigator.clipboard.writeText(prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);

        // Optimistically set to in_progress if currently inbox
        if (task.status === 'inbox') {
          await updateTaskStatus(task.id, 'in_progress');
          onRefresh();
        }
      } catch (err) {
        console.error('Failed to copy prompt:', err);
      }
    });
  };

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => {
        const btn = cardRef.current?.querySelector<HTMLButtonElement>('[data-edit-btn]');
        if (btn && !(e.target as HTMLElement).closest('select, button, [data-edit-btn]')) {
          btn.click();
        }
      }}
      className={`group relative bg-zinc-950/80 border rounded-lg p-3 flex flex-col gap-3 transition-all duration-200 cursor-pointer active:scale-[0.99] select-none ${
        selected
          ? 'border-zinc-700 bg-zinc-900/60 shadow-[0_0_15px_rgba(255,255,255,0.03)]'
          : 'border-zinc-900 shadow-sm hover:border-zinc-700 hover:shadow-[0_0_12px_rgba(255,255,255,0.02)]'
      }`}
    >
      {/* Top Meta info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {onToggleSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className="cursor-pointer text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              {selected ? <CheckSquare size={13} /> : <Square size={13} />}
            </button>
          )}
          {assigneeMeta ? <AgentIcon agent={assigneeMeta.id} size={20} /> : (
            <div
              style={{ backgroundColor: '#3f3f46' }}
              className="w-5 h-5 rounded text-xs font-bold font-mono text-white flex items-center justify-center select-none"
            >
              --
            </div>
          )}
          <span className="font-mono text-xs font-semibold text-zinc-500 select-none">
            {task.id}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-600 font-semibold uppercase tracking-wider select-none font-mono">
            {priorityLabel}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${priorityColor}`} />
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title={t.deleteTask}
            className="ml-1 opacity-0 group-hover:opacity-100 cursor-pointer text-zinc-600 hover:text-red-400 transition-all"
          >
            <Trash2 size={12} />
          </button>
          <ConfirmDialog
            open={showDeleteConfirm}
            title={t.deleteTask}
            message={t.deleteConfirm}
            confirmLabel={locale === 'tr' ? 'Sil' : 'Delete'}
            cancelLabel={t.cancel}
            destructive
            onConfirm={confirmDelete}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        </div>
      </div>

      {/* Main Body */}
      <div className="min-w-0">
        <h4 className="text-xs font-semibold text-zinc-200 leading-relaxed select-text font-sans">
          {task.title}
        </h4>
        {task.role && (
          <p className="text-xs text-zinc-600 font-mono mt-0.5 select-none">
            <span className="text-zinc-500">{t.role}:</span>{' '}
            <span className="text-zinc-400">{task.role}</span>
          </p>
        )}
      </div>

      {/* AI Suggestion Banner */}
      {aiSuggestion && (
        <div className="bg-cyan-950/30 border border-cyan-900/40 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles size={10} className="text-cyan-400 shrink-0" />
            <span className="text-xs font-mono text-cyan-300/80 leading-relaxed truncate">
              {aiSuggestion.reason}
            </span>
          </div>
          {aiSuggestion.suggestedStatus && (
            <button
              onClick={handleApplySuggestion}
              className="shrink-0 flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-700/40 hover:bg-cyan-600/30 transition-all cursor-pointer"
            >
              <ArrowRight size={8} />
              {aiSuggestion.suggestedStatus === 'done' ? (locale === 'tr' ? 'Done Yap' : 'Set Done') : (locale === 'tr' ? 'Uygula' : 'Apply')}
            </button>
          )}
          <button
            onClick={() => setAiSuggestion(null)}
            className="shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Footer operations */}
      <div className="border-t border-zinc-900/50 pt-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-600 font-mono select-none">{t.assignee}:</span>
          <select
            value={task.assignee || 'unassigned'}
            onChange={handleAssigneeChange}
            className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded px-1.5 py-0.5 cursor-pointer max-w-[120px] focus:outline-none focus:border-zinc-600 transition-colors"
          >
            <option value="unassigned">{locale === 'tr' ? 'Atanmadı' : 'Unassigned'}</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          <InitialPromptModal editingTask={task} onRefresh={onRefresh} locale={locale} />

          <button
            onClick={handleAiSuggest}
            disabled={aiClassifying}
            className="flex-1 text-xs font-semibold py-1 px-1.5 rounded border transition-all cursor-pointer font-mono select-none bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-cyan-700 hover:text-cyan-400"
          >
            {aiClassifying ? <><RotateCw size={11} className="inline mr-0.5 animate-spin" /> AI</> : <><Sparkles size={11} className="inline mr-0.5" /> AI</>}
          </button>

          <button
            onClick={handleCopyPrompt}
            disabled={isCopyPending}
            className={`flex-1 text-xs font-semibold py-1 px-1.5 rounded border transition-all cursor-pointer font-mono select-none ${
              copied
                ? 'bg-zinc-900 border-emerald-800 text-emerald-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            {copied ? <><Check size={11} className="inline mr-0.5" /> {t.copiedSuccess}</> : <><Copy size={11} className="inline mr-0.5" /> Prompt</>}
          </button>
        </div>
      </div>
    </div>
  );
}
