// PostCSS plugin that confines the compiled Switchyard stylesheet to one root element.
//
// - Every selector is prefixed with the root class; html, body, :root and :host map to the root itself,
//   so Tailwind's preflight and theme variables never reach the host page.
// - Cascade layers are flattened in their declared order. Layered rules lose to any unlayered host
//   rule, which would let a host page restyle the playground.
// - Width media queries become attribute gates on the root (`data-sy-w`), set from the root's own
//   width, so the layout responds to the frame it is embedded in rather than the browser window.
// - Layout heights written in viewport units follow the frame height through `--sy-vh`.
// - Keyframes are renamed with a prefix; KaTeX's web fonts are dropped (no external fetch).

const LAYER_FALLBACK = 'unlayered';

function px(value) {
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  return match[2] === 'px' ? number : number * 16;
}

/** Turns `(max-width: 767px)` or `(width >= 40rem)` into a gate token such as `le767` / `ge640`. */
function widthToken(feature) {
  const inner = feature.trim().replace(/^\(|\)$/g, '').trim();
  let match = /^(min|max)-width\s*:\s*(.+)$/.exec(inner);
  if (match) {
    const value = px(match[2]);
    return value === null ? null : `${match[1] === 'min' ? 'ge' : 'le'}${value}`;
  }
  match = /^width\s*(>=|<=|>|<)\s*(.+)$/.exec(inner);
  if (match) {
    const value = px(match[2]);
    const op = { '>=': 'ge', '<=': 'le', '>': 'gt', '<': 'lt' }[match[1]];
    return value === null ? null : `${op}${value}`;
  }
  return null;
}

/** Splits media params into width gates and whatever else must stay a media query. */
function splitMedia(params) {
  if (params.includes(',')) return null;
  const parts = params.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
  const tokens = [], rest = [];
  for (const part of parts) {
    const token = /^\(.*\)$/.test(part) ? widthToken(part) : null;
    if (token) tokens.push(token); else if (!/^(only\s+)?(screen|all)$/i.test(part)) rest.push(part);
  }
  return tokens.length ? { tokens, rest: rest.join(' and ') } : null;
}

function scopeSelector(selector, rootSelector, gate) {
  const root = `${rootSelector}${gate}`;
  const trimmed = selector.trim();
  if (trimmed === '*') return [root, `${root} *`];
  if (trimmed.startsWith(rootSelector) && !/^[\w-]/.test(trimmed.slice(rootSelector.length))) return [`${root}${trimmed.slice(rootSelector.length)}`];
  // html and body keep their type-selector weight (the root is a div), so they still beat bare utilities.
  const replaced = trimmed.replace(/^(:root|:host|html|body)(?![\w-])/, (match) => match.startsWith(':') ? root : `div${root}`);
  if (replaced.startsWith(root) || replaced.startsWith(`div${root}`)) return [replaced.replace(/\s+(?:body|html)(?![\w-])/g, '')];
  return [`${root} ${trimmed}`];
}

export function scopeCss({ rootClass = 'sy-playground', viewportSelectors = [], dropFontFamilies = [/^KaTeX/] } = {}) {
  const rootSelector = `.${rootClass}`;
  return {
    postcssPlugin: 'switchyard-scope',
    OnceExit(css, { Rule }) {
      // 1. Flatten cascade layers in declared order; unlayered rules stay last, as they win today.
      const order = [];
      const buckets = new Map();
      const bucket = (name) => { if (!buckets.has(name)) { buckets.set(name, []); if (name !== LAYER_FALLBACK && !order.includes(name)) order.push(name); } return buckets.get(name); };
      for (const node of [...css.nodes]) {
        if (node.type === 'atrule' && node.name === 'layer') {
          if (!node.nodes) { for (const name of node.params.split(',').map(item => item.trim())) bucket(name); node.remove(); continue; }
          const name = node.params.trim() || `anonymous-${order.length}`;
          bucket(name).push(...node.nodes.map(child => child.clone()));
          node.remove();
          continue;
        }
        if (node.type === 'atrule' && node.name === 'charset') continue;
        bucket(LAYER_FALLBACK).push(node.clone());
        node.remove();
      }
      for (const name of [...order, LAYER_FALLBACK]) css.append(...(buckets.get(name) ?? []));
      css.walkAtRules('layer', (node) => { if (node.nodes) node.replaceWith(node.nodes); else node.remove(); });

      // 2. Fonts and keyframes.
      css.walkAtRules('font-face', (node) => {
        let family = '';
        node.walkDecls('font-family', (decl) => { family = decl.value.replace(/['"]/g, ''); });
        if (dropFontFamilies.some(pattern => pattern.test(family))) node.remove();
      });
      const keyframes = new Set();
      css.walkAtRules(/^(-webkit-)?keyframes$/, (node) => { keyframes.add(node.params.trim()); node.params = `sy-${node.params.trim()}`; });
      if (keyframes.size) {
        const pattern = new RegExp(`(^|[\\s,])(${[...keyframes].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[\\s,;])`, 'g');
        css.walkDecls((decl) => {
          if (/animation/.test(decl.prop) || decl.prop.startsWith('--animate')) decl.value = decl.value.replace(pattern, '$1sy-$2');
        });
      }

      // 3. Width media queries become root attribute gates.
      const gates = new Set();
      css.walkAtRules('media', (media) => {
        const split = splitMedia(media.params);
        if (!split) return;
        split.tokens.forEach(token => gates.add(token));
        // :where() keeps the gate out of specificity, like the media query it replaces.
        const gate = `:where(${split.tokens.map(token => `[data-sy-w~="${token}"]`).join('')})`;
        media.walkRules((rule) => { rule.syGate = `${rule.syGate ?? ''}${gate}`; });
        if (split.rest) media.params = split.rest;
        else media.replaceWith(media.nodes);
      });

      // 4. Prefix selectors and follow the frame height for layout rules.
      const viewportUnit = /(-?\d*\.?\d+)(d|s|l)?(vh|vw)\b/g;
      css.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        const original = rule.selector;
        rule.selectors = rule.selectors.flatMap(selector => scopeSelector(selector, rootSelector, rule.syGate ?? ''));
        if (viewportSelectors.some(pattern => pattern.test(original))) {
          rule.walkDecls((decl) => {
            decl.value = decl.value.replace(viewportUnit, (_match, amount, _prefix, unit) => `calc(var(--sy-${unit}, 1${unit}) * ${amount})`);
          });
        }
      });

      css.prepend(new Rule({ selector: rootSelector, nodes: [] }).append({ prop: '--sy-breakpoints', value: `"${[...gates].sort().join(' ')}"` }));
    },
  };
}
scopeCss.postcss = true;
