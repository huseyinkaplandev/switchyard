 'use client';
import {useState} from 'react';
import {ToolGroup} from './assistant-ui/elements/tool-group';
import {ReasoningRoot,ReasoningTrigger,ReasoningContent} from './assistant-ui/elements/reasoning';
import AssistantMessage from './assistant-ui/AssistantMessage';
import MessageMarkdown from './MessageMarkdown';
import type {AgentArchiveMessage} from '../_lib/agentArchiveDb';
export default function ToolTrace({items,locale}:{items:AgentArchiveMessage[];locale:'tr'|'en'}) {
 const [open,setOpen]=useState(false);
 const thinking=items.filter(i=>i.kind==='thinking'), tools=items.filter(i=>i.kind!=='thinking');
 return <div className="aui-trace">
 {thinking.length>0&&<ReasoningRoot defaultOpen={false}><ReasoningTrigger>{locale==='tr'?'Düşünme kaydı':'Reasoning record'} · {thinking.length}</ReasoningTrigger><ReasoningContent>{thinking.map(i=><MessageMarkdown key={i.id} text={i.text}/>)}</ReasoningContent></ReasoningRoot>}
 {tools.length>0&&<><ToolGroup locale={locale} label={locale==='tr'?'Araç işlemleri':'Tool activity'} tools={tools.map(i=>({id:i.id,name:i.toolName||i.kind||'tool',target:i.text.slice(0,90),state:i.isError?'failed':i.kind==='tool_result'?'done':'recorded'}))} open={open} onOpenChange={setOpen}/>{open&&<div className="aui-trace-content">{tools.map(i=><AssistantMessage key={i.id} id={i.id} role="tool" text={i.text} label={i.toolName||'Tool'} timestamp={i.timestamp} locale={locale}/>)}</div>}</>}
 </div>;
}
