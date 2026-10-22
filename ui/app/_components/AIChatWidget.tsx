 'use client';
import {useState,useRef} from 'react';
import {AssistantRuntimeProvider,useExternalStoreRuntime,ThreadPrimitive,ComposerPrimitive,type ThreadMessageLike} from '@assistant-ui/react';
import {MessageCircle,X,ArrowUp,Square,ArrowDown} from 'lucide-react';
import AssistantMessage from './assistant-ui/AssistantMessage';
import {Locale,TRANSLATIONS} from '../_lib/translations';
type ChatMessage={id:string;role:'user'|'assistant';text:string};
const convertMessage=(m:ChatMessage):ThreadMessageLike=>({id:m.id,role:m.role,content:[{type:'text',text:m.text}]});
export default function AIChatWidget({locale}:{locale:Locale}) {
 const t=TRANSLATIONS[locale], [open,setOpen]=useState(false),[messages,setMessages]=useState<ChatMessage[]>([]),[streaming,setStreaming]=useState(false),[error,setError]=useState('');
 const abort=useRef<AbortController|null>(null);
 const send=async(text:string)=>{
  if(!text.trim()||streaming)return;
  const id=crypto.randomUUID();setMessages(old=>[...old,{id:crypto.randomUUID(),role:'user',text},{id,role:'assistant',text:''}]);setStreaming(true);setError('');
  const controller=new AbortController();abort.current=controller;
  try{const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text}),signal:controller.signal});if(!response.ok||!response.body)throw new Error();const reader=response.body.getReader(),decoder=new TextDecoder();let full='';
   while(true){const chunk=await reader.read();if(chunk.done)break;full+=decoder.decode(chunk.value,{stream:true});setMessages(old=>old.map(m=>m.id===id?{...m,text:full}:m));}
  }catch(e){if(!controller.signal.aborted)setError(t.aiInsightsError);}finally{abort.current=null;setStreaming(false);}
 };
 const runtime=useExternalStoreRuntime({messages,convertMessage,isRunning:streaming,onNew:async m=>send(m.content.filter(p=>p.type==='text').map(p=>p.type==='text'?p.text:'').join('\n')),onCancel:async()=>abort.current?.abort()});
 if(!open)return <button type="button" onClick={()=>setOpen(true)} className="workspace-ai-launch" aria-label={t.aiChat}><MessageCircle size={16}/><span>{t.aiChat}</span></button>;
 return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="aui-assistant-panel">
  <header><span><MessageCircle size={18}/>{t.aiChat}</span><button type="button" aria-label={t.handoff.close} onClick={()=>{abort.current?.abort();setOpen(false);}}><X size={18}/></button></header>
  <ThreadPrimitive.Viewport className="aui-assistant-viewport">
   {messages.length===0&&<div className="aui-assistant-welcome"><MessageCircle size={24}/><h3>{t.aiChat}</h3><p>{t.auiAssistantHint}</p><ThreadPrimitive.Suggestion prompt={t.auiSuggestedPrompt} method="replace" autoSend={false}>{t.auiSuggestedPrompt}</ThreadPrimitive.Suggestion></div>}
   {messages.map((m,index)=><AssistantMessage key={m.id} id={m.id} role={m.role} text={m.text} locale={locale} live={streaming&&index===messages.length-1}/>)}
   {error&&<p role="alert" className="aui-error">{error}</p>}
  </ThreadPrimitive.Viewport>
  <ThreadPrimitive.ScrollToBottom className="aui-jump-latest" aria-label={t.auiJumpLatest}><ArrowDown size={16}/></ThreadPrimitive.ScrollToBottom>
  <ComposerPrimitive.Root className="aui-ai-composer"><ComposerPrimitive.Input aria-label={t.aiChatPlaceholder} placeholder={t.aiChatPlaceholder} minRows={2} maxRows={6}/>{streaming?<ComposerPrimitive.Cancel aria-label={t.composerStop}><Square size={16}/></ComposerPrimitive.Cancel>:<ComposerPrimitive.Send aria-label={t.composerSend}><ArrowUp size={18}/></ComposerPrimitive.Send>}</ComposerPrimitive.Root>
 </ThreadPrimitive.Root></AssistantRuntimeProvider>;
}
