import { createRoot, type Root } from 'react-dom/client';
import type { Locale } from '@ui/_lib/translations';
import { liveConversationId } from './mock/store';
import { resetSearchParams } from './shims/next-navigation';
import { Shell, VIEWS, type PlaygroundView } from './app/Shell';
import './styles/playground.css';

export type { PlaygroundView };
export type MountOptions = {
  /** Tab shown first. Default: `archive`. */
  view?: PlaygroundView;
  /** Interface language. Default: `en`. */
  locale?: Locale;
};
export type PlaygroundHandle = { unmount: () => void };

const mounted = new WeakMap<HTMLElement, Root>();

/**
 * Renders the Switchyard playground into `element`. All styles live under `.sy-playground`;
 * give `element` a height (for example 680px), the playground fills it and scrolls inside.
 */
export function mount(element: HTMLElement, options: MountOptions = {}): PlaygroundHandle {
  if (!(element instanceof HTMLElement)) throw new TypeError('SwitchyardPlayground.mount needs an HTMLElement');
  mounted.get(element)?.unmount();
  const view = options.view && VIEWS.includes(options.view) ? options.view : 'archive';
  const locale: Locale = options.locale === 'tr' ? 'tr' : 'en';
  // Open the conversation that streams new messages, as `npm run demo:live` would.
  resetSearchParams(`/?tab=codex&provider=codex&session=${liveConversationId}`);
  const root = createRoot(element);
  mounted.set(element, root);
  root.render(<Shell initialView={view} initialLocale={locale} />);
  return {
    unmount: () => {
      if (mounted.get(element) === root) mounted.delete(element);
      root.unmount();
    },
  };
}

declare global {
  interface Window {
    SwitchyardPlayground?: { mount: typeof mount };
  }
}

if (typeof window !== 'undefined') window.SwitchyardPlayground = { mount };
