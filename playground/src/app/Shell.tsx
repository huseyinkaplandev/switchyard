import { useEffect, useRef, useState } from 'react';
import { Activity, CalendarClock, MessageSquareText, Send } from 'lucide-react';
import AssistantUIRoot from '@ui/_components/assistant-ui/AssistantUIRoot';
import { TRANSLATIONS, type Locale } from '@ui/_lib/translations';
import { PortalContainerContext } from '../shims/radix-tooltip';
import { ArchiveView, HandoffView, LiveView, SchedulesView } from './views';

export type PlaygroundView = 'archive' | 'schedules' | 'live' | 'handoff';
export const VIEWS: readonly PlaygroundView[] = ['archive', 'schedules', 'live', 'handoff'];

type GateToken = { token: string; test: (width: number) => boolean };

/** Reads the width gates the stylesheet was compiled with (see scripts/scope-css.mjs). */
function readGates(element: HTMLElement): GateToken[] {
  const list = getComputedStyle(element).getPropertyValue('--sy-breakpoints').replace(/["']/g, '').trim();
  return list.split(/\s+/).filter(Boolean).flatMap((token) => {
    const match = /^(ge|gt|le|lt)(\d+(?:\.\d+)?)$/.exec(token);
    if (!match) return [];
    const limit = Number(match[2]);
    const test = { ge: (w: number) => w >= limit, gt: (w: number) => w > limit, le: (w: number) => w <= limit, lt: (w: number) => w < limit }[match[1] as 'ge'];
    return [{ token, test }];
  });
}

/** Keeps `data-sy-w` and `--sy-vh/--sy-vw` in sync with the frame size. */
function useFrameSize(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let gates = readGates(element);
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!gates.length) gates = readGates(element);
      element.dataset.syW = gates.filter(gate => gate.test(width)).map(gate => gate.token).join(' ');
      element.style.setProperty('--sy-vh', `${height / 100}px`);
      element.style.setProperty('--sy-vw', `${width / 100}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

export function Shell({ initialView, initialLocale }: { initialView: PlaygroundView; initialLocale: Locale }) {
  const [view, setView] = useState<PlaygroundView>(initialView);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useFrameSize(root);
  const t = TRANSLATIONS[locale];
  const items = [
    { id: 'archive' as const, label: t.workspaceChats, icon: MessageSquareText },
    { id: 'schedules' as const, label: t.workspaceSchedules, icon: CalendarClock },
    { id: 'live' as const, label: t.workspaceActivity, icon: Activity },
    { id: 'handoff' as const, label: t.handoff.title, icon: Send },
  ];
  const title = items.find(item => item.id === view)?.label;

  return (
    <div ref={root} className="sy-playground" data-assistant-ui="" data-view={view}>
      <PortalContainerContext.Provider value={portal}>
        <AssistantUIRoot>
          <div className="sy-frame">
            <div className="workspace-shell">
              <aside className="workspace-sidebar">
                <span className="workspace-brand">Switchyard<span>{locale === 'tr' ? 'Demo verisi · tarayıcıda' : 'Demo data · in your browser'}</span></span>
                <nav aria-label={t.workspaceNavigation} className="workspace-navigation">
                  <div role="tablist" aria-orientation="vertical">
                    {items.map(({ id, label, icon: Icon }) => (
                      <button key={id} type="button" role="tab" data-tour={`nav:${id}`} aria-selected={view === id} aria-current={view === id ? 'page' : undefined}
                        aria-label={label} title={label} className="workspace-nav-item" onClick={() => setView(id)}>
                        <Icon size={18} aria-hidden="true" /><span>{label}</span>
                      </button>
                    ))}
                  </div>
                </nav>
                <div className="workspace-footer"><span className="size-1.5 rounded-full bg-emerald-400" /> {locale === 'tr' ? 'Sunucu yok' : 'No server'}</div>
              </aside>
              <div className="workspace-center">
                <header className="workspace-header">
                  <div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-100 font-sans select-none">{title}</h1>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5 font-mono select-none">
                      {locale === 'tr' ? 'Sentetik demo verisi, gerçek arayüz' : 'Synthetic demo data, the real interface'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-850 p-0.5 rounded-lg select-none">
                    {(['en', 'tr'] as const).map(code => (
                      <button key={code} type="button" aria-pressed={locale === code} onClick={() => setLocale(code)}
                        className={`px-2 py-1 rounded text-xs font-medium cursor-pointer transition-all ${locale === code ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-550 hover:text-zinc-350'}`}>
                        {code.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </header>
                <main className="workspace-main" role="tabpanel" aria-label={title}>
                  {view === 'archive' && <ArchiveView locale={locale} />}
                  {view === 'schedules' && <SchedulesView locale={locale} />}
                  {view === 'live' && <LiveView locale={locale} />}
                  {view === 'handoff' && <HandoffView locale={locale} onClose={() => setView('archive')} />}
                </main>
              </div>
            </div>
          </div>
        </AssistantUIRoot>
      </PortalContainerContext.Provider>
      <div ref={setPortal} className="sy-portal" />
    </div>
  );
}
