// Radix Tooltip with its portal rendered inside the playground root, so the scoped styles apply.
import { createContext, useContext, type ComponentProps } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

export * from '@radix-ui/react-tooltip';

export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function Portal(props: ComponentProps<typeof Tooltip.Portal>) {
  const container = useContext(PortalContainerContext);
  return <Tooltip.Portal container={container ?? undefined} {...props} />;
}

export const TooltipPortal = Portal;
