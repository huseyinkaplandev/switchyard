import { live, liveConversationId, startLiveReplay } from './store';

/**
 * Stand-in for `EventSource` inside the bundled components. `/api/agent/stream` is the only
 * stream the UI opens; for the live demo conversation it replays scripts/demo-live.mjs on a timer.
 */
export class PlaygroundEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = PlaygroundEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listener: (messages: unknown[]) => void;
  private readonly timer: number;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    const params = new URL(this.url, 'http://playground.invalid').searchParams;
    const id = params.get('id');
    this.listener = (messages) => this.emit('messages', { messages });
    this.timer = window.setTimeout(() => {
      if (this.readyState === PlaygroundEventSource.CLOSED) return;
      this.readyState = PlaygroundEventSource.OPEN;
      this.dispatchEvent(new Event('open'));
      this.onopen?.(new Event('open'));
      this.emit('ready', { id });
      if (id === liveConversationId) {
        live.listeners.add(this.listener);
        if (live.status === 'armed') startLiveReplay();
      }
    }, 150);
  }

  private emit(type: string, payload: unknown) {
    if (this.readyState === PlaygroundEventSource.CLOSED) return;
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    this.dispatchEvent(event);
    if (type === 'message') this.onmessage?.(event);
  }

  close() {
    this.readyState = PlaygroundEventSource.CLOSED;
    window.clearTimeout(this.timer);
    live.listeners.delete(this.listener);
  }
}
