'use client';
import { useMemo, type ReactNode } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import { assistantMessage } from '../../_lib/assistantMessage';
type SourceMessage = { id?: string; role: string; text: string; timestamp?: string };
/** Native stores own persistence; this runtime supplies navigation/render state only. */
export default function ArchiveRuntime({ messages, children }: { messages: readonly SourceMessage[]; children: ReactNode }) {
  const converted = useMemo(() => messages.map((message, index) => assistantMessage({ ...message, id: message.id || `source-${index}` })), [messages]);
  const runtime = useExternalStoreRuntime({ messages: converted, isDisabled: true, onNew: async () => { throw new Error('Use the native session composer to send messages'); } });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
