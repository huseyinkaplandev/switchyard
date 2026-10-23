// In-memory stand-in for next/navigation. The playground must never touch the host page's URL,
// so search params, router.replace and history.replaceState all write to this store instead.
import { useSyncExternalStore } from 'react';

let search = new URLSearchParams();
const listeners = new Set<() => void>();
const refreshListeners = new Set<() => void>();

function setSearch(href: string) {
  const url = new URL(href, 'http://playground.invalid/');
  search = new URLSearchParams(url.search);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Called when a component asks for `router.refresh()`; views re-read their server data. */
export function onRouterRefresh(listener: () => void) {
  refreshListeners.add(listener);
  return () => { refreshListeners.delete(listener); };
}

export function resetSearchParams(href = '/') {
  setSearch(href);
}

const router = {
  push: (href: string) => setSearch(href),
  replace: (href: string) => setSearch(href),
  refresh: () => { for (const listener of refreshListeners) listener(); },
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
};

export const playgroundHistory = {
  get length() { return 1; },
  get state() { return null; },
  scrollRestoration: 'auto' as ScrollRestoration,
  pushState: (_state: unknown, _unused: string, href?: string | URL | null) => { if (href) setSearch(String(href)); },
  replaceState: (_state: unknown, _unused: string, href?: string | URL | null) => { if (href) setSearch(String(href)); },
  back: () => undefined,
  forward: () => undefined,
  go: () => undefined,
};

export function useRouter() {
  return router;
}

export function usePathname() {
  return '/';
}

export function useSearchParams() {
  return useSyncExternalStore(subscribe, () => search, () => search);
}

export function redirect(href: string): never {
  setSearch(href);
  throw new Error(`redirect(${href}) is not supported in the playground`);
}

export function notFound(): never {
  throw new Error('notFound() is not supported in the playground');
}
