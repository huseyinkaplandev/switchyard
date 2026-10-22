'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Locale, TRANSLATIONS } from '../_lib/translations';

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

interface AgentsMdEditorProps {
  locale: Locale;
}

export default function AgentsMdEditor({ locale }: AgentsMdEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);

  const t = TRANSLATIONS[locale];
  const defaultTemplate = locale === 'tr' ? DEFAULT_TEMPLATE_TR : DEFAULT_TEMPLATE_EN;
  const isDirty = content !== getSavedTemplate();

  function getSavedTemplate(): string {
    if (typeof window === 'undefined') return defaultTemplate;
    return localStorage.getItem(`${LS_TEMPLATE_KEY}-${locale}`) || defaultTemplate;
  }

  function persistTemplate(val: string) {
    localStorage.setItem(`${LS_TEMPLATE_KEY}-${locale}`, val);
  }

  function resetTemplate() {
    setContent(defaultTemplate);
    persistTemplate(defaultTemplate);
  }

  const handleOpen = () => {
    setContent(getSavedTemplate());
    dialogRef.current?.showModal();
  };

  const handleClose = (force = false) => {
    if (!force && isDirty) {
      if (!confirm(t.confirmUnsaved)) return;
    }
    dialogRef.current?.close();
  };

  const handleSave = (copyToClipboard = false) => {
    if (!content.trim()) return;
    persistTemplate(content);
    if (copyToClipboard) {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
    handleClose(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current;
    if (!el) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;
      setContent(value.substring(0, start) + '  ' + value.substring(end));
      setTimeout(() => { el.selectionStart = el.selectionEnd = start + 2; }, 0);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 text-xs font-semibold cursor-pointer transition-all select-none"
      >
        {t.editAgentsMd}
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (dialogRef.current && e.target === dialogRef.current) handleClose();
        }}
        onCancel={(e) => { e.preventDefault(); handleClose(); }}
        className="fixed inset-0 m-auto h-fit bg-zinc-950 border border-zinc-900 rounded-xl p-6 text-zinc-100 max-w-2xl w-full shadow-2xl focus:outline-none backdrop:bg-black/30 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-4 select-none">
          <h3 className="font-semibold text-sm font-sans text-zinc-200">{t.editAgentsMd}</h3>
          {isDirty && (
            <span className="text-xs text-amber-500 font-mono animate-pulse">{t.unsavedChanges}</span>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full h-[50vh] max-h-[60vh] bg-zinc-950 border border-zinc-850 rounded-lg p-4 font-mono text-xs text-zinc-200 focus:outline-none focus:border-zinc-750 resize-none leading-relaxed custom-scrollbar"
          placeholder={t.textareaPlaceholder}
        />

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-900 select-none">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleClose()}
              className="px-3.5 py-2 rounded-lg border border-zinc-900 hover:border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer select-none font-mono"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={resetTemplate}
              className="px-3 py-2 rounded-lg border border-zinc-900 hover:border-zinc-800 text-zinc-500 hover:text-zinc-300 text-xs transition-colors cursor-pointer select-none font-mono flex items-center gap-1"
            >
              <RotateCcw size={11} />
              {locale === 'tr' ? 'Sıfırla' : 'Reset'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={!isDirty}
              className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer select-none font-mono ${
                copied
                  ? 'bg-zinc-900 border-emerald-850 text-emerald-400'
                  : 'bg-zinc-900 border-zinc-850 text-zinc-300 hover:border-zinc-800 hover:text-zinc-100'
              }`}
            >
              {copied ? <><Check size={12} className="inline" /> {t.copiedSuccess}</> : t.saveAndCopy}
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={!isDirty}
              className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-zinc-950 font-bold text-xs transition-colors cursor-pointer select-none font-mono"
            >
              {t.save}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
