import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Locale } from '@ui/_lib/translations';
import { liveConversationId } from './mock/store';
import { resetSearchParams } from './shims/next-navigation';
import { Shell, VIEWS, type PlaygroundView } from './app/Shell';
import { createTour, type TourResult } from './tour/tour';
import './styles/playground.css';

export type { PlaygroundView, TourResult };
export type MountOptions = {
  /** Tab shown first. Default: `archive`. */
  view?: PlaygroundView;
  /** Interface language. Default: `en`. */
  locale?: Locale;
  /** Start the guided tour right after mounting. Default: `false`. */
  autoplay?: boolean;
};
export type PlaygroundHandle = {
  unmount: () => void;
  /**
   * Resets the interface and plays the guided tour (about 40 seconds). Resolves with `completed`,
   * or `stopped` when `stop()` was called or the visitor pressed, scrolled or typed inside the
   * playground. Either way the interface stays usable where the tour left it.
   */
  play: () => Promise<TourResult>;
  stop: () => void;
};

const mounted = new WeakMap<HTMLElement, PlaygroundHandle>();

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
  let generation = 0;
  const render = (initialView: PlaygroundView) => root.render(<Shell key={generation} initialView={initialView} initialLocale={locale} />);
  render(view);
  const tour = createTour({
    host: element,
    locale,
    reset: () => {
      generation += 1;
      resetSearchParams('/?tab=codex');
      flushSync(() => render('archive'));
      const shell = element.querySelector<HTMLElement>('.sy-playground');
      if (!shell) throw new Error('Playground shell did not render');
      return shell;
    },
  });
  const handle: PlaygroundHandle = {
    play: tour.play,
    stop: tour.stop,
    unmount: () => {
      tour.stop();
      if (mounted.get(element) === handle) mounted.delete(element);
      root.unmount();
    },
  };
  mounted.set(element, handle);
  if (options.autoplay) void tour.play();
  return handle;
}

declare global {
  interface Window {
    SwitchyardPlayground?: { mount: typeof mount };
  }
}

if (typeof window !== 'undefined') window.SwitchyardPlayground = { mount };
