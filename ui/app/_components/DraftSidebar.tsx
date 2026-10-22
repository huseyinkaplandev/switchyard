'use client';

import { Trash2, FileText } from 'lucide-react';
import { Locale, TRANSLATIONS } from '../_lib/translations';

export type DraftItem = {
  id: string;
  title: string;
  body: string;
  priority: string;
  assignee: string | null;
  created_at: string;
  updated_at: string;
};

interface DraftSidebarProps {
  drafts: DraftItem[];
  locale: Locale;
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function DraftSidebar({ drafts, locale, selectedId, onSelect, onDelete }: DraftSidebarProps) {
  const t = TRANSLATIONS[locale];

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-900 bg-zinc-950/30 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
      <div className="p-3 border-b border-zinc-900 shrink-0">
        <h2 className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider select-none flex items-center gap-1.5">
          <FileText size={11} className="text-zinc-600" />
          {locale === 'tr' ? 'Kayitli Taslaklar' : 'Saved Drafts'}
        </h2>
        <p className="text-[10px] text-zinc-700 mt-1 select-none">
          {drafts.length} {locale === 'tr' ? 'taslak' : 'drafts'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {drafts.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-[11px] text-zinc-600 font-mono select-none">
              {locale === 'tr' ? 'Henuz taslak yok' : 'No drafts yet'}
            </p>
            <p className="text-[10px] text-zinc-700 mt-2 select-none">
              {locale === 'tr'
                ? 'LLM Prompt u acidl Taslagi Kaydet ile ekleyin'
                : 'Open LLM Prompt and click Save Draft'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className={`group border-b border-zinc-900/50 transition-colors ${
                  selectedId === draft.id ? 'bg-zinc-900/60' : 'hover:bg-zinc-900/30'
                }`}
              >
                <button
                  onClick={() => onSelect(draft.id)}
                  className="w-full text-left px-3 py-2.5 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-200 truncate select-none">
                        {draft.title || (locale === 'tr' ? 'Isimsiz Taslak' : 'Untitled Draft')}
                      </p>
                      <p className="text-[10px] text-zinc-600 font-mono mt-1 select-none">
                        {formatRelativeDate(draft.updated_at, locale)}
                      </p>
                      <p className="text-[10px] text-zinc-700 font-mono mt-0.5 select-none line-clamp-1">
                        {draft.body.slice(0, 80)}{draft.body.length > 80 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                </button>
                <div className="px-3 pb-2 -mt-1 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onDelete(draft.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-mono"
                  >
                    <Trash2 size={10} />
                    {locale === 'tr' ? 'Sil' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function formatRelativeDate(iso: string, locale: Locale): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return locale === 'tr' ? 'az once' : 'just now';
    if (diffMin < 60) return locale === 'tr' ? `${diffMin}dk once` : `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return locale === 'tr' ? `${diffHours}sa once` : `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return locale === 'tr' ? `${diffDays}g once` : `${diffDays}d ago`;

    return d.toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
