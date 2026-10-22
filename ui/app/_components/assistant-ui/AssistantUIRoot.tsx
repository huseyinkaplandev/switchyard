'use client';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage }  from '@assistant-ui/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
const emptyMessages: ThreadMessage[] = [];
/** Read-only context for native transcript messages. Send composers own a scoped runtime. */
export default function AssistantUIRoot({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime({ messages: emptyMessages, isDisabled: true, onNew: async () => { throw new Error('Native history is read-only'); } });
  return <AssistantRuntimeProvider runtime={runtime}><Tooltip.Provider delayDuration={300}>{children}</Tooltip.Provider></AssistantRuntimeProvider>;
}
