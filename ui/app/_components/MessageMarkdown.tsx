 'use client';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type CodeHeaderProps } from '@assistant-ui/react-markdown';
import { defaultUrlTransform } from 'react-markdown';
import { transcriptImageUrl } from '../_lib/transcriptImageUrls';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
function CodeHeader({ language, code }: CodeHeaderProps) {
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
 return <div className="aui-code-header"><span>{language || 'text'}</span><button type="button" aria-label="Copy code" onClick={async()=>{try{await navigator.clipboard.writeText(code);setCopied(true);setFailed(false);}catch{setFailed(true);}}}>{copied?<Check size={13}/>:<Copy size={13}/ >}{failed&&<span role="status">Copy failed</span>}</button></div>;
}
const components = { CodeHeader, a: ({href,children}:{href?:string;children?:React.ReactNode})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a> };
export default function MessageMarkdown({text,live=false,messageId}:{text:string;live?:boolean;messageId?:string}) {
 return <TextMessagePartProvider text={text} isRunning={live}><MarkdownTextPrimitive className="aui-markdown" remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={components} urlTransform={(url,key)=>key==='src' ? transcriptImageUrl(url,text,messageId) || defaultUrlTransform(url) : defaultUrlTransform(url)} smooth={live} defer/></TextMessagePartProvider>;
}
