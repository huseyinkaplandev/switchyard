'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { MessagePrimitive, MessageProvider, ActionBarPrimitive } from '@assistant-ui/react';
import { Check, Copy, Download, Circle } from 'lucide-react';
import MessageMarkdown from '../MessageMarkdown';
import TooltipButton from './TooltipButton';
import { assistantMessage } from '../../_lib/assistantMessage';
import { TRANSLATIONS, type Locale } from '../../_lib/translations';
import { conversationText } from '../../_lib/desktopHandoff/activity';

export default function AssistantMessage({ id, role, text, label, timestamp, locale, live, queued, children }: {
  id?: string; role: 'user' | 'assistant' | 'system' | 'tool'; text: string; label?: string;
  timestamp?: string; locale: Locale; live?: boolean; queued?: boolean; children?: ReactNode;
}) {
  const fallbackId = useId();
  text = role === 'user' ? conversationText(text) : text;
  const t = TRANSLATIONS[locale];
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  const message = useMemo(() => assistantMessage({ id: id || fallbackId, role, text, timestamp, live }), [id, fallbackId, role, text, timestamp, live]);
  const date = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  if (role === 'user' && !text.trim()) return null;
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true); setError(''); } catch { setError(t.workspaceCopyFailed); } }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `message-${(id || 'export').replace(/[^\w-]/g, '').slice(0, 60)}.md`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <MessageProvider message={message} index={0}><MessagePrimitive.Root className={`aui-message aui-message-${role}`} data-message-id={id} data-message-role={role}>
    <div className="aui-message-content">{children ?? (role === 'tool' ? <pre className="aui-tool-output">{text}</pre> : <MessageMarkdown text={text} messageId={id} live={live} />)}</div>
    <ActionBarPrimitive.Root className="aui-message-actions" autohide="never">
      <span className="aui-message-author">{label || (role === 'user' ? t.workspaceYou : t.workspaceAssistant)}</span>
      {date && <time dateTime={timestamp}>{date}</time>}
      {live && <span className="aui-live-label"><Circle size={6} fill="currentColor" />{t.workspaceLive}</span>}
      {queued && <span className="aui-status-badge">{t.workspaceQueued}</span>}
      <TooltipButton label={copied ? t.copiedSuccess : t.workspaceCopyMessage} className="aui-icon-button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</TooltipButton>
      <TooltipButton label={t.auiExportMessage} className="aui-icon-button" onClick={download}><Download size={14} /></TooltipButton>
      {error && <span role="status">{error}</span>}
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root></MessageProvider>;
}
