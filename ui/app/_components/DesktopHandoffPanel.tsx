'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Search, X } from 'lucide-react';
import { DataTable } from './assistant-ui/elements/data-table';
import { OptionList } from './assistant-ui/elements/option-list';
import { ApprovalCard } from './assistant-ui/elements/approval-card';
import { TRANSLATIONS, type Locale } from '../_lib/translations';
import { resolveTimeWindow, withinWindow } from '../_lib/desktopHandoff/activity';
import { latestScheduledCandidates } from '../_lib/conversationList';
import type { DesktopRuntime, HandoffCandidate, HandoffPackage, ItemProgress, TimePreset } from '../_lib/desktopHandoff/types';

type Catalog = { candidates: HandoffCandidate[]; warnings: string[]; accountLabels?: Record<string,string> };
type Detail = { package: HandoffPackage; bootstrapText: string; progress: ItemProgress[]; runtime?: DesktopRuntime; directSupported?: boolean };
export default function DesktopHandoffPanel({ locale, onClose, initialPackageId }: { locale: Locale; onClose: () => void; initialPackageId?: string }) {
  const t = TRANSLATIONS[locale].handoff;
  const [catalog,setCatalog] = useState<Catalog>({ candidates: [], warnings: [] });
  const [allRuns,setAllRuns] = useState(false);
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState(''), [copied,setCopied] = useState(false);
  const [time,setTime] = useState<TimePreset>('today'), [from,setFrom] = useState(''), [to,setTo] = useState('');
  const [platform,setPlatform] = useState('windows'), [provider,setProvider] = useState('claude-code'), [account,setAccount] = useState(''), [kind,setKind] = useState('all'), [query,setQuery] = useState(''), [archived,setArchived] = useState(false);
  const [target,setTarget] = useState<'claude-code'|'codex'>('claude-code');
  const [selected,setSelected] = useState<Map<string,HandoffCandidate>>(new Map());
  const [detail,setDetail] = useState<Detail|null>(null), [packages,setPackages] = useState<HandoffPackage[]>([]);
  const [stage,setStage] = useState<'select'|'deliver'>('select');
  const [inspected,setInspected] = useState<string|null>(null);
  const customTime=(value:string)=>{const parsed=Date.parse(`${value}+03:00`);return Number.isFinite(parsed)?new Date(parsed).toISOString():'';};
  const custom = { from: customTime(from), to: customTime(to) };
  useEffect(() => {
    let active=true;
    const refresh=async()=>{try {
      const response=await fetch('/api/handoff/catalog');const body=await response.json();if(!response.ok)throw new Error(body.error);
      if(active){setCatalog(body);setLoading(false);}
    }catch(e){if(active){setError(String(e));setLoading(false);}}};
    void refresh();const timer=setInterval(refresh,30000);
    void fetch('/api/handoff/packages').then(r=>r.json()).then(b=>{if(active)setPackages(b.packages??[]);}).catch(()=>{});
    return ()=>{active=false;clearInterval(timer);};
  },[]);
  const packageId=detail?.package.id;
  useEffect(()=>{
    if(!packageId)return;let active=true;
    const refresh=async()=>{try{const r=await fetch(`/api/handoff/packages/${packageId}`);if(r.ok && active)setDetail(await r.json());}catch{/* Last known evidence remains visible. */}};
    void refresh();const timer=setInterval(refresh,3000);return()=>{active=false;clearInterval(timer);};
  },[packageId]);
  const accounts=[...new Set(catalog.candidates.filter(c=>c.platform===platform && c.provider===provider).map(c=>c.sourceAccount??'unknown'))];
  const accountLabel=(value:string|null)=>!value||value==='unknown'?t.unknown:catalog.accountLabels?.[value]??value;
  let timeWindow=null;try{timeWindow=resolveTimeWindow(time,new Date().toISOString(),Intl.DateTimeFormat().resolvedOptions().timeZone,custom);}catch{/* Invalid custom range produces zero results. */}
  const filtered=latestScheduledCandidates(catalog.candidates.filter(c=>c.platform===platform && c.provider===provider && (!account || (c.sourceAccount??'unknown')===account) && (kind==='all'||c.chatType===kind) && (archived||!c.archived) && timeWindow && withinWindow(c.activityAt,timeWindow) && [c.title,c.cwd,c.sourceId].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())),allRuns);
  const selection=useMemo(()=>[...selected.values()],[selected]);
  const toggle=(c:HandoffCandidate)=>setSelected(previous=>{const next=new Map(previous);next.has(c.key)?next.delete(c.key):next.set(c.key,c);return next;});
  const date=(at:string|null)=>at?new Intl.DateTimeFormat(locale==='tr'?'tr-TR':'en-US',{dateStyle:'short',timeStyle:'short'}).format(new Date(at)):t.unknown;
  const typeLabel=(value:string)=>value==='all'?t.all:value==='normal'?t.normal:value==='scheduled'?t.scheduled:t.unknown;
  const create=async()=>{
    setBusy(true);setError('');setCopied(false);
    try{const response=await fetch('/api/handoff/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:selection.map(c=>c.key),targetProvider:target,time,custom})});const body=await response.json();if(!response.ok)throw new Error(body.error);setDetail({...body,progress:[]});setPackages(previous=>[body.package,...previous]);setStage('deliver');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(detail!.bootstrapText);setCopied(true);}catch{setError(t.copyFailed);}};
  const act=async(action:'start'|'open'|'stop',itemId?:string)=>{
    if(!detail)return;setBusy(true);setError('');
    try {
      const r=await fetch(`/api/handoff/packages/${detail.package.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(itemId?{itemId}:{})})});
      const body=await r.json();if(!r.ok)throw new Error(body.error);
      const refreshed=await fetch(`/api/handoff/packages/${detail.package.id}`);if(refreshed.ok)setDetail(await refreshed.json());
    }catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const direct=detail?.directSupported && detail.package.targetProvider==='claude-code';
  const running=detail?.runtime?.running??false;
  const current=filtered.find(c=>c.key===inspected);
  const projectName=(cwd:string)=>cwd.split(/[\\/]/).filter(Boolean).pop()||cwd;
  const openPackage=async(id:string)=>{
    if(!id)return;setBusy(true);setError('');setCopied(false);
    try{const r=await fetch(`/api/handoff/packages/${id}`);if(!r.ok)throw new Error(t.sourceMissing);setDetail(await r.json());setStage('deliver');}
    catch(error){setError(String(error));}finally{setBusy(false);}
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- opens a saved package once on mount.
  useEffect(()=>{if(initialPackageId)void openPackage(initialPackageId);},[initialPackageId]);
  const completed=detail?.progress.filter(p=>p.state==='reply-observed'&&p.titleVerified).length??0;
  return <section className="desktop-handoff-panel" aria-label={t.title}>
    <header className="handoff-heading">
      <div><h2 id="desktop-handoff-title">{t.title}</h2><p>{t.description}</p></div>
      <button type="button" autoFocus onClick={onClose} aria-label={t.close}><X size={18} /></button>
    </header>
    <nav className="handoff-steps" aria-label={t.steps}>
      <button type="button" aria-current={stage==='select'?'step':undefined} onClick={()=>{setStage('select');setError('');}}><span>1</span>{t.selectStep}</button>
      <ChevronRight size={16} />
      <button type="button" disabled={!detail} aria-current={stage==='deliver'?'step':undefined} onClick={()=>{setStage('deliver');setError('');}}><span>2</span>{t.deliverStep}</button>
      {packages.length>0 && <label className="handoff-saved"><span>{t.saved}</span><select aria-label={t.saved} value={stage==='deliver'?packageId??'':''} disabled={busy} onChange={e=>void openPackage(e.target.value)}><option value="">{t.choose}</option>{packages.map(p=><option key={p.id} value={p.id}>{date(p.createdAt)} · {p.items.length} {t.chats}</option>)}</select></label>}
    </nav>
    {error && <p role="alert" className="handoff-error handoff-alert">{error}</p>}
    {stage==='select' && <>
      <div className="handoff-source-bar">
        <label>{t.source}<select value={provider} onChange={e=>{setProvider(e.target.value);setAccount('');}}><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select></label>
        <label>{t.account}<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">{t.all}</option>{accounts.map(a=><option key={a} value={a}>{accountLabel(a)}</option>)}</select></label>
        <label>{t.period}<select value={time} onChange={e=>setTime(e.target.value as TimePreset)}>{(['today','8h','24h','7d','all','custom'] as const).map((p,i)=><option key={p} value={p}>{[t.today,t.hours8,t.hours24,t.days7,t.all,t.custom][i]}</option>)}</select></label>
        <details className="handoff-more-filters"><summary>{t.filters}</summary><div className="handoff-filters">
          <label>{t.os}<select value={platform} onChange={e=>{setPlatform(e.target.value);setAccount('');}}><option value="windows">Windows</option><option value="macos">macOS</option></select></label>
          <label>{t.type}<select value={kind} onChange={e=>setKind(e.target.value)}><option value="normal">{t.normal}</option><option value="scheduled">{t.scheduled}</option><option value="unknown">{t.unknown}</option><option value="all">{t.all}</option></select></label>
          <label className="handoff-checkbox"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)} />{t.archived}</label>
          <label className="handoff-checkbox"><input type="checkbox" checked={allRuns} onChange={e=>setAllRuns(e.target.checked)} />{locale==='tr'?'Tüm scheduled çalıştırmaları':'All scheduled runs'}</label>
        </div></details>
      </div>
      {time==='custom' && <div className="handoff-filters"><label>{t.from}<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>{t.to}<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)} /></label></div>}
      <div className="handoff-selection-layout">
        <div className="handoff-select-list">
          <div className="handoff-list-toolbar"><label className="handoff-search"><Search size={16}/><input aria-label={t.search} placeholder={t.search} type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label><button type="button" disabled={!filtered.length} onClick={()=>setSelected(previous=>new Map([...previous,...filtered.filter(c=>c.title&&c.sourceAvailable).map(c=>[c.key,c] as const)]))}>{t.selectVisible}</button></div>
          <div className="handoff-list-count"><span>{filtered.length} {t.chats} · {platform==='windows'?'Windows':'macOS'} · {typeLabel(kind)}</span><small>{t.activityRule}</small></div>
          <div className="handoff-candidates">{loading?<p role="status" className="handoff-empty">{t.loading}</p>:<DataTable locale={locale} rowKey="key" emptyMessage={t.empty}
            columns={[{key:'selected',label:t.selectChat,sortable:false},{key:'title',label:t.chats,priority:'primary'},{key:'project',label:t.project},{key:'type',label:t.type,format:{kind:'badge'}},{key:'at',label:t.lastReply,format:{kind:'date',style:'datetime'}}]}
            rows={filtered.map(c=>({key:c.key,title:c.title||t.unknown,project:projectName(c.cwd),type:typeLabel(c.chatType),at:c.activityAt}))}
            renderCell={(row,column)=>{const c=filtered.find(c=>c.key===row.key);if(!c)return undefined;return column.key==='selected'?<input type="checkbox" aria-label={`${t.selectChat}: ${c.title||t.unknown}`} checked={selected.has(c.key)} disabled={!c.title||!c.sourceAvailable} onChange={()=>toggle(c)}/>:column.key==='title'?<button type="button" className="aui-title-cell" aria-pressed={inspected===c.key} onClick={()=>setInspected(inspected===c.key?null:c.key)}>{c.title||t.unknown}</button>:undefined;}}/>}</div>
        </div>
        <aside className="handoff-inspector">
          {current?<><h3>{current.title}</h3><span className="handoff-badge">{typeLabel(current.chatType)}</span><p>{accountLabel(current.sourceAccount)}</p><code>{current.cwd}</code>
            <div className="handoff-activity"><h4>{t.lastUser}<small>{date(current.lastUser?.at??null)}</small></h4><p>{current.lastUser?.text||'—'}</p></div>
            <div className="handoff-activity"><h4>{t.lastReply}<small>{date(current.lastAssistant?.at??null)}</small></h4><p>{current.lastAssistant?.text||'—'}</p></div>
            {!current.sourceAvailable&&<p className="handoff-error">{t.sourceMissing}</p>}
          </>:<div className="handoff-empty"><h3>{t.inspectTitle}</h3><p>{t.inspectHint}</p></div>}
          {catalog.warnings.length>0&&<details><summary>{t.warnings} ({catalog.warnings.length})</summary>{catalog.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
        </aside>
      </div>
      <footer className="handoff-selection-footer"><div><strong>{selection.length} {t.selected}</strong>{selection.length>0&&<details className="handoff-selection-review"><summary>{t.review}</summary><div>{selection.map(c=><div key={c.key}><span>{c.title}</span><button type="button" aria-label={`${t.remove}: ${c.title}`} onClick={()=>toggle(c)}><X size={14}/></button></div>)}</div></details>}<button type="button" disabled={!selection.length} onClick={()=>setSelected(new Map())}>{t.clear}</button></div>
        <div><details className="aui-target-picker"><summary>{t.destination}: {target==='claude-code'?'Claude Code':'Codex'}</summary><OptionList key={target} defaultValue={[target]} options={[{id:'claude-code',label:'Claude Code Desktop'},{id:'codex',label:'Codex Desktop'}]} onConfirm={ids=>setTarget(ids[0] as typeof target)}/></details><button type="button" className="handoff-primary" disabled={busy||!selection.length||!timeWindow} onClick={()=>void create()}>{busy?t.loading:t.prepare}<ChevronRight size={16}/></button></div>
      </footer>
    </>}
    {stage==='deliver'&&detail&&<div className="handoff-delivery">
      <div className="handoff-delivery-heading"><div><h3>{t.ready}</h3><p>{date(detail.package.createdAt)} · {detail.package.items.length} {t.chats} · {detail.package.targetProvider==='claude-code'?'Claude Code Desktop':'Codex Desktop'}</p></div><button type="button" onClick={()=>setStage('select')}><ArrowLeft size={14}/>{t.newSelection}</button></div>
      <div className="aui-handoff-approval"><ApprovalCard title={t.switchAccount} subtitle={`${detail.package.items.length} ${t.selectStep}`} description={direct?t.directHint:t.directUnsupported} state={running?'running':completed===detail.package.items.length?'done':'request'} statusLabel={running?t.runtimeLabels.running:completed===detail.package.items.length?t.verified:undefined} allowOnceLabel={t.startAll} onAllowOnce={direct&&!busy&&!running?()=>void act('start'):undefined}/>{running&&<button type="button" disabled={busy} onClick={()=>void act('stop')}>{t.stop}</button>}</div>
      <div className="handoff-progress-line"><span role="status">{t.runtimeLabels[(detail.runtime?.status??'idle') as keyof typeof t.runtimeLabels]??detail.runtime?.status}</span><span><Check size={14}/>{completed} / {detail.package.items.length} {t.verified}</span></div>
      {detail.runtime?.error&&<p role="alert" className="handoff-error handoff-alert">{detail.runtime.error}</p>}
      <ul className="handoff-delivery-items">{detail.package.items.map(item=>{const p=detail.progress.find(p=>p.itemId===item.id);const state=p?.state??'prepared';return <li key={item.id} data-state={state}>
        <div className="handoff-item-summary"><div className="handoff-row-title"><strong>{item.source.title}</strong><span className="handoff-badge">{typeLabel(item.source.chatType)}</span></div><p title={item.source.cwd}>{projectName(item.source.cwd)} · {accountLabel(item.source.sourceAccount)}</p><span className="handoff-item-state">{t.states[state]}{p?.titleVerified?` · ${t.titleVerified}`:''}</span>{p?.blockedBy&&<small>{t.waitingProject}: {detail.package.items.find(i=>i.id===p.blockedBy)?.source.title}</small>}
          {p?.error&&<p role="status" className="handoff-error">{p.error}</p>}
          <details><summary>{t.details}</summary><code>{item.source.cwd}</code>{p?.destinationId&&<small>{p.destinationId}</small>}</details>
        </div><div className="handoff-item-actions"><button type="button" disabled={!direct||busy||running||(state==='reply-observed'&&p?.titleVerified)} onClick={()=>void act('start',item.id)}>{p?.destinationId||state==='failed'||state==='queued'||state==='uncertain'?t.continueOne:t.startOne}</button><button type="button" disabled={!direct||busy||running||!p?.destinationId} onClick={()=>void act('open',item.id)}>{t.openDestination}</button></div>
      </li>;})}</ul>
      <p className="handoff-note">{t.scheduledNote} {t.taskSeparate}</p>
      <details className="handoff-bootstrap"><summary>{t.bootstrap}</summary><p>{t.pasteStep}</p><textarea aria-label={t.bootstrap} readOnly value={detail.bootstrapText} rows={5}/><button type="button" onClick={()=>void copy()}>{copied?t.copied:t.copy}</button></details>
    </div>}
  </section>;
}
