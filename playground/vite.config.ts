import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { scopeCss } from './scripts/scope-css.mjs';
import { conversations } from '../fixtures/demo/content.mjs';
import snapshot from './src/mock/demo-snapshot.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.resolve(here, '..', 'ui');
const uiApp = path.join(ui, 'app');
const mock = path.join(here, 'src', 'mock');
const shims = path.join(here, 'src', 'shims');
const slash = (file: string) => file.replace(/\\/g, '/');
const insideUi = (file: string) => slash(file).startsWith(`${slash(uiApp)}/`);

/**
 * The browser/server boundary of the real components, replaced for the playground only.
 *
 * - `ui/app/_actions` (Next server actions) resolves to an in-memory module with the same exports.
 * - `fetch` and `EventSource` inside ui/app modules are bound to in-memory versions by a per-module
 *   import, and `window.history` writes go to the in-memory router. Nothing global is patched, so
 *   the host page keeps its own fetch, EventSource and URL.
 */
function serverBoundary(): Plugin {
  const actionsModule = slash(path.join(uiApp, '_actions'));
  const tooltipShim = slash(path.join(shims, 'radix-tooltip.tsx'));
  return {
    name: 'switchyard-playground-boundary',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer) return null;
      const importerPath = slash(importer.split('?')[0]);
      if (source === '@radix-ui/react-tooltip' && importerPath !== tooltipShim) return tooltipShim;
      if (source.startsWith('.') && insideUi(importerPath)) {
        const target = slash(path.resolve(path.dirname(importerPath), source));
        if (target === actionsModule || target === `${actionsModule}/index` || target === `${actionsModule}/index.ts`) return path.join(mock, 'actions.ts');
      }
      if (source === 'server-only') this.error(`server-only module imported by ${importerPath}; it cannot run in the playground`);
      return null;
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!insideUi(file) || !/\.(tsx?|jsx?|mjs)$/.test(file)) return null;
      const imports: string[] = [];
      let output = code;
      if (/\bfetch\s*\(/.test(code)) imports.push(`import { playgroundFetch as fetch } from ${JSON.stringify(slash(path.join(mock, 'fetch.ts')))};`);
      if (/\bnew EventSource\b/.test(code)) imports.push(`import { PlaygroundEventSource as EventSource } from ${JSON.stringify(slash(path.join(mock, 'event-source.ts')))};`);
      if (/\bwindow\.history\./.test(code)) {
        imports.push(`import { playgroundHistory as __playgroundHistory } from ${JSON.stringify(slash(path.join(shims, 'next-navigation.ts')))};`);
        output = output.replace(/\bwindow\.history\./g, '__playgroundHistory.');
      }
      if (!imports.length) return null;
      const directive = /^(['"])use (client|server)\1;?\s*/.exec(output);
      const head = directive ? directive[0] : '';
      return { code: `${head}${imports.join('\n')}\n${output.slice(head.length)}`, map: null };
    },
  };
}

/** Fails the build when fixtures/demo changed but the recorded snapshot was not regenerated. */
function snapshotMatchesFixtures(): Plugin {
  return {
    name: 'switchyard-snapshot-check',
    buildStart() {
      const recorded = new Set(snapshot.threads.map((thread: { id: string }) => thread.id));
      const missing = conversations.filter((conversation: { id: string }) => !recorded.has(conversation.id));
      if (missing.length || recorded.size !== conversations.length) {
        this.error('src/mock/demo-snapshot.json is out of date with fixtures/demo. Run "npm run playground:snapshot".');
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [serverBoundary(), snapshotMatchesFixtures(), react()],
  resolve: {
    alias: [
      { find: /^next\/navigation$/, replacement: path.join(shims, 'next-navigation.ts') },
      { find: /^next\/link$/, replacement: path.join(shims, 'next-link.tsx') },
      { find: /^@ui\//, replacement: `${slash(uiApp)}/` },
      { find: /^@\//, replacement: `${slash(ui)}/` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ base: ui, optimize: true }),
        scopeCss({ viewportSelectors: [/\.sy-/, /\.workspace-/, /\.conversation-/, /\.native-history/] }),
      ],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    fs: { allow: [path.resolve(here, '..')] },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000,
    // Library mode keeps whitespace in ES output; this file is consumed as-is, so minify it fully.
    rolldownOptions: { output: { minify: true } },
    lib: {
      entry: path.join(here, 'src', 'index.tsx'),
      formats: ['es'],
      fileName: () => 'switchyard-playground.js',
      cssFileName: 'switchyard-playground',
    },
  },
}));
