import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { useRouter } from './next-navigation';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; prefetch?: boolean; replace?: boolean; scroll?: boolean };

/** next/link without navigation: the href only updates the in-memory router. */
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, prefetch: _prefetch, replace: _replace, scroll: _scroll, onClick, ...props }, ref) {
  const router = useRouter();
  return <a ref={ref} href={href} {...props} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    router.push(href);
  }} />;
});

export default Link;
