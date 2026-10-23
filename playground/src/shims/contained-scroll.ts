// Scrolling that stays inside the playground. A native scrollIntoView also scrolls the host page,
// so the Vite config rewrites `el.scrollIntoView(...)` in ui/app modules to `el[scrollIntoViewKey](...)`.

const ROOT = '.sy-playground';

/** `reveal` centers the element only when it is not already fully in view. */
type Align = 'nearest' | 'center' | 'start' | 'end' | 'reveal';
export type ContainedScrollOptions = { block?: Align; inline?: Align; behavior?: ScrollBehavior };
export type ContainedScrollResult = 'outside' | 'moved' | 'still';

function canScroll(element: HTMLElement, axis: 'x' | 'y') {
  const style = getComputedStyle(element);
  if (!/(auto|scroll|overlay)/.test(axis === 'y' ? style.overflowY : style.overflowX)) return false;
  return axis === 'y' ? element.scrollHeight > element.clientHeight + 1 : element.scrollWidth > element.clientWidth + 1;
}

/** Distance to scroll so that [start, start + size] sits in the view as `align` asks. */
function delta(start: number, size: number, viewStart: number, viewSize: number, align: Align) {
  const end = start + size;
  const viewEnd = viewStart + viewSize;
  if (align === 'start') return start - viewStart;
  if (align === 'end') return end - viewEnd;
  if (start >= viewStart && end <= viewEnd && align !== 'center') return 0;
  if (align === 'center' || align === 'reveal') return start + size / 2 - (viewStart + viewSize / 2);
  return start < viewStart || size > viewSize ? start - viewStart : end - viewEnd;
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));

/**
 * Scrolls every scroll container between `element` and its playground root, innermost first.
 * The root and the host page never move.
 */
export function scrollWithin(element: Element, { block = 'nearest', inline = 'nearest', behavior = 'auto' }: ContainedScrollOptions = {}): ContainedScrollResult {
  const root = element.closest(ROOT);
  if (!root) return 'outside';
  let moved = false;
  let shiftX = 0;
  let shiftY = 0;
  for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
    const vertical = canScroll(node, 'y');
    const horizontal = canScroll(node, 'x');
    if (!vertical && !horizontal) continue;
    const box = node.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const scale = node.offsetWidth ? box.width / node.offsetWidth : 1;
    let top = node.scrollTop;
    let left = node.scrollLeft;
    if (vertical) {
      const wanted = delta(target.top + shiftY, target.height, box.top + node.clientTop * scale, node.clientHeight * scale, block) / scale;
      top = clamp(node.scrollTop + wanted, node.scrollHeight - node.clientHeight);
      shiftY -= (top - node.scrollTop) * scale;
    }
    if (horizontal) {
      const wanted = delta(target.left + shiftX, target.width, box.left + node.clientLeft * scale, node.clientWidth * scale, inline) / scale;
      left = clamp(node.scrollLeft + wanted, node.scrollWidth - node.clientWidth);
      shiftX -= (left - node.scrollLeft) * scale;
    }
    if (Math.abs(top - node.scrollTop) < 1 && Math.abs(left - node.scrollLeft) < 1) continue;
    node.scrollTo({ top, left, behavior });
    moved = true;
  }
  return moved ? 'moved' : 'still';
}

export const scrollIntoViewKey = Symbol('switchyard-playground-scroll-into-view');

if (typeof Element !== 'undefined') {
  Object.defineProperty(Element.prototype, scrollIntoViewKey, {
    configurable: true,
    value(this: Element, argument?: boolean | ScrollIntoViewOptions) {
      const options: ScrollIntoViewOptions = typeof argument === 'boolean' ? { block: argument ? 'start' : 'end' } : argument ?? { block: 'start' };
      if (scrollWithin(this, options) === 'outside') this.scrollIntoView(argument);
    },
  });
}
