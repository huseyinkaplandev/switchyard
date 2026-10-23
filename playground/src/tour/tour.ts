// A scripted walk through the real interface. It clicks and types through the same buttons and
// inputs a visitor uses (found by their data-tour attributes), so every state it shows is one the
// app reaches on its own. Any pointer, wheel or key input from the visitor ends it on the spot.
import type { Locale } from '@ui/_lib/translations';
import { archive } from '../mock/store';
import { scrollWithin } from '../shims/contained-scroll';

export type TourResult = 'completed' | 'stopped';
type Text = Record<Locale, string>;
type Target = string | (() => Element | null | undefined);

const STEPS = 6;
const CURSOR = '<svg viewBox="0 0 20 24" width="20" height="24" aria-hidden="true"><path d="M2 1.5v18.2l4.6-4.3 3 6.9 3.2-1.4-3-6.8h6.4z" fill="#fff" stroke="#0b0b0c" stroke-width="1.5" stroke-linejoin="round"/></svg>';

const captions = {
  archive: { en: 'Every Claude Code, Codex, OpenCode and Antigravity chat, in one local archive.', tr: 'Claude Code, Codex, OpenCode ve Antigravity sohbetlerinin hepsi tek bir yerel arşivde.' },
  limit: { en: 'This Claude Code session stopped mid-task: usage limit reached.', tr: 'Bu Claude Code oturumu işin ortasında durdu: kullanım limiti doldu.' },
  handoff: { en: 'Batch Desktop handoff moves stuck chats to another account.', tr: 'Toplu Desktop handoff, takılan sohbetleri başka bir hesaba taşır.' },
  pick: { en: 'Pick the chats and prepare one transfer package.', tr: 'Sohbetleri seç, tek bir aktarım paketi hazırla.' },
  start: { en: 'Start: each chat opens in the new account and Switchyard waits for the reply.', tr: 'Başlat: her sohbet yeni hesapta açılır, Switchyard cevabı bekler.' },
  verified: { en: 'Reply observed, title verified. Both chats moved.', tr: 'Cevap geldi, ad doğrulandı. İki sohbet de taşındı.' },
  codex: { en: 'Codex picks up where the Claude Code session stopped. Nothing is redone.', tr: 'Codex, Claude Code oturumunun kaldığı yerden devam eder. Hiçbir şey baştan yapılmaz.' },
  live: { en: 'Live activity shows every agent’s log, the handoff included.', tr: 'Canlı etkinlik her agent’ın logunu gösterir, handoff dahil.' },
  schedules: { en: 'Scheduled runs that left no reply are flagged: this one may have done nothing.', tr: 'Cevap bırakmayan zamanlanmış koşular işaretlenir: bu koşu bir şey yapmamış olabilir.' },
  search: { en: 'One search box across all four tools.', tr: 'Dört aracın hepsinde tek arama kutusu.' },
  done: { en: 'That’s the tour. The interface is yours now.', tr: 'Tur bitti. Arayüz artık sende.' },
} satisfies Record<string, Text>;

class Interrupted extends Error {}

function threadId(provider: string, title: string) {
  return archive.threads.find(thread => thread.provider === provider && thread.title === title)?.id;
}

function visible(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** One run of the tour: the overlay it draws and the input it simulates. */
class Run {
  private readonly layer: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private point = { x: 0, y: 0 };

  constructor(readonly root: HTMLElement, private readonly signal: AbortSignal, private readonly locale: Locale) {
    this.layer = document.createElement('div');
    this.layer.className = 'sy-tour';
    if (this.still) this.layer.dataset.still = '';
    this.layer.innerHTML = '<div class="sy-tour-ring" aria-hidden="true"></div><div class="sy-tour-cursor" aria-hidden="true"></div><div class="sy-tour-caption" role="status" aria-live="polite"><span class="sy-tour-count"></span><span class="sy-tour-text"></span></div>';
    this.ring = this.layer.children[0] as HTMLDivElement;
    this.cursor = this.layer.children[1] as HTMLDivElement;
    this.caption = this.layer.children[2] as HTMLDivElement;
    this.cursor.innerHTML = CURSOR;
    root.append(this.layer);
    this.point = { x: root.offsetWidth * 0.62, y: root.offsetHeight * 0.72 };
    this.place(0);
  }

  dispose() {
    this.layer.remove();
  }

  private check() {
    if (this.signal.aborted) throw new Interrupted();
  }

  pause(ms: number) {
    this.check();
    return new Promise<void>((resolve, reject) => {
      const abort = () => { window.clearTimeout(timer); reject(new Interrupted()); };
      const timer = window.setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve(); }, ms);
      this.signal.addEventListener('abort', abort, { once: true });
    });
  }

  /** The first match that is rendered with a size; tables keep a hidden copy for narrow frames. */
  private resolve(target: Target) {
    const element = typeof target === 'string' ? [...this.root.querySelectorAll(target)].find(visible) : target();
    return visible(element) ? element : null;
  }

  /** Resolves with the target once it exists and has a size. */
  async find(target: Target, timeout = 8000): Promise<HTMLElement> {
    const started = performance.now();
    for (;;) {
      this.check();
      const element = this.resolve(target);
      if (element) return element;
      if (performance.now() - started > timeout) throw new Error(`Tour target not found: ${typeof target === 'string' ? target : 'element'}`);
      await this.pause(60);
    }
  }

  async until(condition: () => boolean, timeout = 15000) {
    const started = performance.now();
    while (!condition()) {
      if (performance.now() - started > timeout) throw new Error('Tour condition timed out');
      await this.pause(100);
    }
  }

  say(text: Text, step?: number) {
    this.check();
    (this.caption.firstElementChild as HTMLElement).textContent = step ? `${step} / ${STEPS}` : '';
    (this.caption.lastElementChild as HTMLElement).textContent = text[this.locale];
    this.caption.dataset.shown = '';
  }

  private frame() {
    const box = this.root.getBoundingClientRect();
    return { box, scale: this.root.offsetWidth ? box.width / this.root.offsetWidth : 1 };
  }

  private place(duration: number) {
    this.cursor.style.transitionDuration = `${duration}ms`;
    this.cursor.style.transform = `translate(${this.point.x}px, ${this.point.y}px)`;
  }

  /** Scrolls the target into view inside the playground (never the host page). */
  async reveal(element: HTMLElement) {
    const result = scrollWithin(element, { block: 'reveal', inline: 'reveal', behavior: this.still ? 'auto' : 'smooth' });
    if (result === 'moved') await this.pause(this.still ? 60 : 520);
  }

  private async moveTo(element: HTMLElement) {
    const { box, scale } = this.frame();
    const target = element.getBoundingClientRect();
    const x = (target.left - box.left + (target.width > 220 ? Math.min(target.width * 0.3, 120) : target.width / 2)) / scale;
    const y = (target.top - box.top + target.height / 2) / scale;
    const distance = Math.hypot(x - this.point.x, y - this.point.y);
    this.point = { x, y };
    this.cursor.dataset.shown = '';
    if (this.still) { this.place(0); return; }
    const duration = Math.round(Math.min(Math.max(distance * 0.7, 280), 600));
    this.place(duration);
    await this.pause(duration + 60);
  }

  private ripple() {
    if (this.still) return;
    const ripple = document.createElement('div');
    ripple.className = 'sy-tour-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.transform = `translate(${this.point.x}px, ${this.point.y}px)`;
    this.layer.append(ripple);
    this.cursor.dataset.pressed = '';
    window.setTimeout(() => { delete this.cursor.dataset.pressed; }, 160);
    window.setTimeout(() => ripple.remove(), 700);
  }

  /** Moves the cursor to the target and clicks it through the element's own handlers. */
  async click(target: Target, after = 450) {
    const element = await this.find(target);
    await this.reveal(element);
    await this.moveTo(element);
    this.ripple();
    await this.pause(this.still ? 0 : 140);
    (this.resolve(target) ?? element).click();
    await this.pause(after);
  }

  /** Types into a React-controlled input one character at a time. */
  async type(target: Target, text: string) {
    const input = await this.find(target);
    if (!(input instanceof HTMLInputElement)) throw new Error('Tour target is not an input');
    await this.click(target, 200);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const write = (value: string) => { setValue?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
    if (this.still) { write(text); return; }
    for (let index = 1; index <= text.length; index++) {
      write(text.slice(0, index));
      await this.pause(80 + Math.round(Math.random() * 50));
    }
  }

  /** Draws a ring around the target for `hold` milliseconds. */
  async highlight(element: HTMLElement, hold: number) {
    await this.reveal(element);
    const { box, scale } = this.frame();
    const target = element.getBoundingClientRect();
    Object.assign(this.ring.style, {
      left: `${(target.left - box.left) / scale - 5}px`,
      top: `${(target.top - box.top) / scale - 5}px`,
      width: `${target.width / scale + 10}px`,
      height: `${target.height / scale + 10}px`,
    });
    this.ring.dataset.shown = '';
    try { await this.pause(hold); } finally { delete this.ring.dataset.shown; }
  }

  /** On a narrow frame an open chat hides the list; go back to it first. */
  async showList() {
    const back = this.root.querySelector('.conversation-back');
    if (visible(back)) await this.click('.conversation-back', 300);
  }

  textIn(selector: string, text: string) {
    return () => [...this.root.querySelectorAll(selector)].find(element => element.textContent?.includes(text));
  }
}

async function script(run: Run) {
  const claudeChat = threadId('claude-code', 'Checkout redesign: split CartSummary');
  const codexChat = threadId('codex', 'Continue checkout redesign after usage limit');
  if (!claudeChat || !codexChat) throw new Error('Tour conversations missing from the demo data');

  // 1. The archive: a Claude Code chat that hit its usage limit.
  run.say(captions.archive, 1);
  await run.pause(600);
  await run.click('[data-tour="provider:claude-code"]', 350);
  await run.click(`[data-tour="recent:${claudeChat}"]`, 500);
  run.say(captions.limit, 1);
  await run.highlight(await run.find(run.textIn('[data-message-id]', 'usage limit reached')), 1800);

  // 2. Batch Desktop handoff: select both chats, start, watch the replies get verified.
  run.say(captions.handoff, 2);
  await run.click('[data-tour="nav:handoff"]', 700);
  await run.click('[data-tour="handoff-step-select"]', 400);
  run.say(captions.pick, 2);
  const picks = () => [...run.root.querySelectorAll<HTMLInputElement>('[data-tour^="handoff-pick:"]')].filter(box => !box.disabled && visible(box));
  await run.find(() => picks()[0]);
  for (const key of picks().slice(0, 2).map(box => box.dataset.tour)) {
    const box = () => picks().find(item => item.dataset.tour === key);
    if (!box()?.checked) await run.click(box, 200);
  }
  await run.click('[data-tour="handoff-prepare"]', 600);
  run.say(captions.start, 2);
  await run.click('[data-slot="approval-card-allow-once"]', 300);
  const delivered = () => {
    const match = run.root.querySelector('[data-tour="handoff-progress"]')?.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
    return Boolean(match && match[1] === match[2] && Number(match[2]) > 0);
  };
  await run.until(delivered);
  run.say(captions.verified, 2);
  await run.highlight(await run.find('[data-tour="handoff-progress"]'), 900);
  await run.highlight(await run.find('.handoff-delivery-items'), 1000);

  // 3. The Codex chat that continued the work.
  await run.click('[data-tour="nav:archive"]', 450);
  await run.click('[data-tour="provider:codex"]', 300);
  await run.showList();
  await run.click(`[data-tour="recent:${codexChat}"]`, 500);
  run.say(captions.codex, 3);
  await run.highlight(await run.find(run.textIn('[data-message-id]', 'Picked up where the Claude Code session stopped')), 2000);

  // 4. Live activity, where the handoff shows up in the shared log.
  await run.click('[data-tour="nav:live"]', 500);
  run.say(captions.live, 4);
  await run.highlight(await run.find(run.textIn('[data-tour="log-entry"]', 'handing off to @codex')), 1800);

  // 5. Scheduled tasks: a run that left no reply.
  await run.click('[data-tour="nav:schedules"]', 500);
  await run.click('[data-tour^="schedule-details:claude:"][data-tour$=":nightly-dependency-audit"]', 400);
  run.say(captions.schedules, 5);
  await run.highlight(await run.find('[data-tour="schedule-run-empty"]'), 2000);

  // 6. One search, then the same query on another tool.
  await run.click('[data-tour="nav:archive"]', 450);
  await run.showList();
  run.say(captions.search, 6);
  await run.type('[data-tour="archive-search"]', 'checkout');
  await run.highlight(await run.find(`[data-session-id="${codexChat}"]`), 1000);
  await run.click('[data-tour="provider:claude-code"]', 300);
  await run.highlight(await run.find(`[data-session-id="${claudeChat}"]`), 1200);

  run.say(captions.done);
  await run.pause(2200);
}

type TourOptions = {
  /** The element the playground is mounted in; visitor input inside it stops the tour. */
  host: HTMLElement;
  locale: Locale;
  /** Remounts the interface in its starting state and returns the new `.sy-playground` root. */
  reset: () => HTMLElement;
};

export function createTour({ host, locale, reset }: TourOptions) {
  let active: AbortController | null = null;

  const stop = () => active?.abort();

  const play = async (): Promise<TourResult> => {
    stop();
    const controller = new AbortController();
    active = controller;
    const interrupt = (event: Event) => { if (event.isTrusted) controller.abort(); };
    const inputs = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    for (const type of inputs) host.addEventListener(type, interrupt, { capture: true, passive: true });
    const run = new Run(reset(), controller.signal, locale);
    try {
      await script(run);
      return 'completed';
    } catch (error) {
      if (!(error instanceof Interrupted)) console.warn('[switchyard-playground] tour ended early:', error);
      return 'stopped';
    } finally {
      for (const type of inputs) host.removeEventListener(type, interrupt, { capture: true });
      run.dispose();
      if (active === controller) active = null;
    }
  };

  return { play, stop };
}
