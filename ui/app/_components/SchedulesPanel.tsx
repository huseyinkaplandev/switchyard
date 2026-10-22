'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduledTask, ClaudeSyncStatus } from '../_lib/schedules';
import { DataTable } from './assistant-ui/elements/data-table';
import AgentIcon from './AgentIcon';
import { TRANSLATIONS, type Locale } from '../_lib/translations';

type ScheduleResponse = { tasks: ScheduledTask[]; activeClaudeAccount: string | null; demo?: boolean; platform?: 'windows' | 'macos'; claudeSync?: ClaudeSyncStatus | null; autoMigration?: {
  lastAccount: string; lastApply?: { at: string }; needsInstall?: boolean; error?: string;
} | null };

export default function SchedulesPanel({ locale }: { locale: Locale }) {
  const tr = locale === 'tr';
  const t = TRANSLATIONS[locale];
  const [inspected, setInspected] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [accountLabels, setAccountLabels] = useState<Record<string,string>>({});
  const [data, setData] = useState<ScheduleResponse>({ tasks: [], activeClaudeAccount: null });
  const [platform, setPlatform] = useState<'windows' | 'macos'>('windows');
  const [accountFilter, setAccountFilter] = useState('current');
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/schedules', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    setData(await response.json());
  }, []);
  const localPlatform = data.platform ?? 'windows';
  useEffect(() => { if (data.platform === 'macos') { setPlatform('macos'); setAccountFilter('current'); } }, [data.platform]);

  useEffect(() => { refresh().catch(error => setMessage(String(error))).finally(()=>setLoaded(true)); }, [refresh]);
  useEffect(() => {
    if (busy) return;
    const update = () => { if (document.visibilityState === 'visible') refresh().catch(() => {}); };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [busy, refresh]);
  const liveSync = data.claudeSync?.accounts.find(account => account.live);
  const needsInstall = liveSync
    ? liveSync.valid !== true || liveSync.missing.length > 0 || liveSync.notEnabled.length > 0
    : data.autoMigration?.needsInstall;
  useEffect(()=>{let active=true; fetch('/api/handoff/catalog').then(r=>r.ok?r.json():null).then(body=>{if(active&&body)setAccountLabels(body.accountLabels || {});}).catch(()=>{});return()=>{active=false;};},[]);
  function accountLabel(account: string) { return account==='local'?(tr?'Yerel':'Local'):accountLabels[account] || account; }
  const dateTime = (value: string) => new Date(value).toLocaleString(tr ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const visibleAccounts = useMemo(() => [...new Set(data.tasks.filter(t => t.platform === platform).map(t => t.account))], [data.tasks, platform]);


  async function install() {
    if (!confirmInstall) { setConfirmInstall(true); return; }
    setConfirmInstall(false);
    setBusy(true);
    setMessage(tr ? 'Claude kapatılıyor, görevler yazılıyor; açılış sonrası doğrulanıyor…' : 'Closing Claude, writing tasks, reopening Claude…');
    try {
      const response = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'install' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${response.status}`);
      if (!result.verified) throw new Error(tr ? 'Açılış sonrası görev doğrulaması tamamlanmadı.' : 'Post-startup verification incomplete.');
      setMessage(tr ? `Claude yeniden açıldı. ${result.verifiedAccounts} hesapta ${result.verifiedTasks} görevin kaydı ve etkinlik durumu doğrulandı.` : `Claude reopened. ${result.verifiedTasks} task records and enabled states verified across ${result.verifiedAccounts} accounts.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function copyToCodex(task?: ScheduledTask) {
    setBusy(true);
    setMessage(tr ? 'Görevler Codex’e kopyalanıyor…' : 'Copying tasks to Codex…');
    try {
      const response = await fetch('/api/schedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'copy-to-codex', ...(task ? { ids: [task.id] } : {}) }),
      });
      const result = await response.json();
      if (!response.ok || !result.verified) throw new Error(result.error || 'Copy verification failed');
      setMessage(tr ? `${result.copied} görev Codex’e kopyalandı; yerel kayıt, takvim ve etkinlik durumu doğrulandı. Claude kopyaları da etkin kalır.` : `${result.copied} tasks copied to Codex; local records, schedules and enabled states verified. The Claude copies stay enabled.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function saveSkills() {
    setBusy(true);
    setMessage(tr ? 'Skiller kaydediliyor: yerel kopyalar ve tüm Claude hesapları…' : 'Saving skills: local copies and every Claude account…');
    try {
      const response = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-skills' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${response.status}`);
      const accounts = Object.values(result.accounts as Record<string, { added?: string[]; updated?: string[]; error?: string }>);
      const registered = accounts.reduce((sum, account) => sum + (account.added?.length ?? 0) + (account.updated?.length ?? 0), 0);
      const failed = accounts.filter(account => account.error).length;
      setMessage(tr
        ? `${result.skills} skill kaydedildi · ${accounts.length} hesap (${registered} yeni/güncel kayıt${failed ? `, ${failed} hata` : ''}) · ~/.claude/skills: ${result.local.changed.length} güncellendi. Yeni oturumlarda kullanılabilir.`
        : `${result.skills} skills saved · ${accounts.length} accounts (${registered} new/updated${failed ? `, ${failed} failed` : ''}) · ~/.claude/skills: ${result.local.changed.length} updated. Available in new sessions.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function toggleTask(task: ScheduledTask) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/schedules', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: task.source, account: task.account, id: task.id, enabled: !task.enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${response.status}`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  if (!loaded) return <section className="space-y-4"><h2 className="text-lg font-semibold">{tr?'Zamanlanmış Görevler':'Scheduled Tasks'}</h2><p role="status" className="aui-muted">{tr?'Yerel görevler yükleniyor…':'Loading local tasks…'}</p></section>;
  return <section className="space-y-6 text-zinc-200">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{tr ? 'Zamanlanmış Görevler' : 'Scheduled Tasks'}</h2>
        <p className="text-xs text-zinc-500">{tr ? 'Codex, Claude Code ve Antigravity yerel kayıtları' : 'Local Codex, Claude Code, and Antigravity records'}</p>
      </div>
      <button onClick={() => refresh().catch(error => setMessage(String(error)))} className="px-3 py-2 rounded border border-zinc-700 text-xs hover:bg-zinc-800">
        {tr ? 'Yenile' : 'Refresh'}
      </button>
    </div>
    {data.demo && <p className="text-xs text-cyan-300">{tr ? 'Demo modu: görevler örnek verilerden okunur; Claude Desktop yeniden başlatılmaz.' : 'Demo mode: tasks come from bundled sample data; Claude Desktop is never restarted.'}</p>}

    <div className="flex flex-wrap gap-2">
      {(['windows', 'macos'] as const).map(os => <button key={os} aria-pressed={platform === os} onClick={() => { setPlatform(os); setAccountFilter(os===localPlatform?'current':'all'); }}
        className={`px-3 py-2 rounded text-xs border ${platform === os ? 'border-cyan-600 text-cyan-300 bg-cyan-950/30' : 'border-zinc-700 text-zinc-400'}`}>
        {os === 'windows' ? 'Windows' : 'macOS'} ({data.tasks.filter(task => task.platform === os).length})
      </button>)}
      <select aria-label={tr ? 'Hesap' : 'Account'} value={accountFilter} onChange={event => setAccountFilter(event.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs">
        {platform===localPlatform && <option value="current">{tr?'Aktif hesap + yerel':'Current account + local'}{data.activeClaudeAccount?` · ${accountLabel(data.activeClaudeAccount)}`:''}</option>}
        <option value="all">{tr ? 'Tüm hesaplar' : 'All accounts'}</option>
        {visibleAccounts.map(account => <option key={account} value={account}>{accountLabel(account)}</option>)}
      </select>
    </div>

    <div className="schedule-filters">
      <input aria-label={t.workspaceScheduledSearch} placeholder={t.workspaceScheduledSearch} value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label={t.workspaceStatus} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
        <option value="all">{t.workspaceAll}</option><option value="active">{t.workspaceActive}</option><option value="paused">{t.workspacePaused}</option>
      </select>
    </div>
    {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
    <section className="rounded-xl border border-zinc-800 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold text-sm">Claude → Codex</h3>
          <p className="text-xs text-zinc-400">{tr ? 'Aktif Claude hesabındaki etkin görevleri aynı takvim ve durumla Codex otomasyonlarına kopyalar. Tekrar kopyalama mevcut hedefleri günceller; iki taraf da çalışmaya devam eder.' : 'Copy enabled tasks from the active Claude account to Codex automations with the same schedule and state. Copying again updates the existing targets. Both sides keep running.'}</p>
        </div>
        <button type="button" disabled={busy || !data.activeClaudeAccount} onClick={() => copyToCodex()} className="px-4 py-2 rounded text-sm font-medium bg-cyan-800 hover:bg-cyan-700 disabled:opacity-40">{tr ? 'Aktif görevleri Codex’e kopyala' : 'Copy active tasks to Codex'}</button>
      </div>
    </section>
    <section className="rounded-xl border border-zinc-800 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold text-sm">{tr ? 'Skiller · tüm hesaplar' : 'Skills · every account'}</h3>
          <p className="text-xs text-zinc-400">{tr ? 'Her skillin en yeni yerel kopyası ~/.claude/skills, skill paketi klasörü ve bu bilgisayardaki tüm Claude hesaplarına yazılır. Paket klasörünü kendi senkron klasörüne koyarak başka bilgisayara taşıyabilirsin. Claude yeniden başlamaz.' : 'The newest local copy of every skill goes to ~/.claude/skills, the skill bundle folder and every Claude account on this machine. Put the bundle folder in a synced folder to carry skills to another computer. Claude is not restarted.'}</p>
        </div>
        <button type="button" disabled={busy} onClick={saveSkills} className="px-4 py-2 rounded text-sm font-medium bg-cyan-800 hover:bg-cyan-700 disabled:opacity-40">{tr ? 'Skilleri kaydet' : 'Save skills'}</button>
      </div>
    </section>
    <section className="rounded-xl border border-zinc-800 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">{tr ? 'Claude görevleri · hesap aktarımı' : 'Claude tasks · account transfer'}</h3>
          <p className="text-xs text-zinc-400">{tr ? 'Aktif hesaptaki yeni ve değişen rutinler dakikada bir karşılaştırılır; diğer hesaplar otomatik hazırlanır. Hesap geçişinde eski hedef kayıtlar kaynak listeyi ezmez. Açık hesaba yeniden kurulum gerekirse aşağıda gösterilir.' : 'New and changed routines are compared every minute; other accounts are prepared automatically. Stale destinations never overwrite source definitions. Any required live-account reinstall is shown below.'}</p>
        </div>
        <button type="button" disabled={busy || !data.claudeSync} onClick={install}
          className={`px-4 py-2 rounded text-sm font-medium disabled:opacity-40 ${confirmInstall ? 'bg-amber-700 hover:bg-amber-600' : 'bg-cyan-800 hover:bg-cyan-700'}`}>
          {confirmInstall ? (tr ? 'Onayla: Claude yeniden başlasın' : 'Confirm: restart Claude') : (tr ? 'Görevleri bu hesaba kur' : 'Install tasks on this account')}
        </button>
      </div>
      {confirmInstall && <p className="text-xs text-amber-300">{tr ? 'Claude Desktop kapanıp yeniden açılır; çalışan sohbetler ve görev koşuları kesilir. Devam etmek için butona tekrar bas.' : 'Claude Desktop will close and reopen; running chats and task runs stop. Click again to continue.'}</p>}
      {needsInstall && <p className="text-xs text-amber-400">{tr ? 'Aktif Claude hesabında görevler eksik veya kapalı: butona bas.' : 'The active Claude account is missing tasks: click the button.'}</p>}
      {data.autoMigration?.error && <p className="text-xs text-red-400">{tr ? 'Senkron hatası' : 'Sync error'}: {data.autoMigration.error}</p>}
      {data.claudeSync ? <div className="overflow-x-auto"><table className="text-xs w-full">
        <thead><tr className="text-zinc-500 text-left"><th className="py-1 pr-3">{tr ? 'Hesap' : 'Account'}</th><th className="pr-3">{tr ? 'Durum' : 'State'}</th><th className="pr-3">{tr ? 'Eksik' : 'Missing'}</th><th>{tr ? 'Kapalı' : 'Paused'}</th></tr></thead>
        <tbody>{data.claudeSync.accounts.map(account => <tr key={account.key} className="border-t border-zinc-800">
          <td className="py-1 pr-3">{accountLabel(account.key)}{account.live ? <span className="ml-2 text-cyan-300">{tr ? '● aktif' : '● live'}</span> : null}</td>
          <td title={account.problems.join('; ')} className={`pr-3 ${account.valid === true && !account.missing.length && !account.notEnabled.length ? 'text-emerald-400' : 'text-amber-400'}`}>{account.valid === true ? (account.missing.length || account.notEnabled.length ? (tr ? 'eksik' : 'incomplete') : (tr ? 'hazır' : 'ready')) : (tr ? 'kontrol gerekli' : 'needs review')}{account.problems.length > 0 && <ul className="mt-1 space-y-1 text-amber-300">{account.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}</td>
          <td className="pr-3">{account.missing.join(', ') || '—'}</td><td>{account.notEnabled.join(', ') || '—'}</td>
        </tr>)}</tbody></table>
        <p className="text-[11px] text-zinc-500 mt-2">{tr ? 'Son otomatik senkron' : 'Last automatic sync'}: {data.autoMigration?.lastApply ? dateTime(data.autoMigration.lastApply.at) : '—'} · Claude {data.claudeSync.claudeRunning ? (tr ? 'açık' : 'running') : (tr ? 'kapalı' : 'closed')}</p>
      </div> : <p className="text-xs text-zinc-500">{tr ? 'Claude Desktop hesabı bulunamadı; hesap aktarımı kullanılamıyor.' : 'No Claude Desktop account found; account transfer is unavailable.'}</p>}
    </section>

    {(['codex', 'claude', 'antigravity'] as const).map(sourceName => {
      const unique = [...new Map(data.tasks.map(task=>[`${task.platform}:${task.source}:${task.account}:${task.id}`,task])).values()];
      const items = unique.filter(task => task.source === sourceName && task.platform === platform && (accountFilter === 'all' || accountFilter === 'current' && (task.source!=='claude' || task.account===data.activeClaudeAccount) || task.account === accountFilter) && (statusFilter === 'all' || task.enabled === (statusFilter === 'active')) && [task.name, task.prompt].join(' ').toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
      return <div key={sourceName} className="space-y-2">
        <h3 className="aui-section-title"><AgentIcon agent={sourceName} />{sourceName} <span className="text-zinc-500">({items.length})</span></h3>
        {items.length === 0 && <p className="text-xs text-zinc-600">{query || statusFilter !== 'all' ? t.workspaceNoMatches : tr ? 'Yerel görev bulunmadı' : 'No local tasks found'}</p>}
        <DataTable caption={sourceName === 'claude' ? 'Claude Code' : sourceName} locale={locale} rowKey="key" emptyMessage={t.workspaceNoMatches}
          columns={[{key:'name',label:tr?'Görev':'Task',priority:'primary'},{key:'state',label:t.workspaceStatus,format:{kind:'badge',tones:{[t.workspaceActive]:'success',[t.workspacePaused]:'neutral'}}},{key:'schedule',label:tr?'Takvim':'Schedule'},{key:'lastRun',label:tr?'Son koşu':'Last run'},{key:'account',label:tr?'Hesap':'Account',priority:'secondary'},{key:'actions',label:tr?'İşlem':'Action',sortable:false}]}
          rows={items.map(task=>({key:`${task.source}:${task.account}:${task.id}`,name:task.name,state:task.enabled?t.workspaceActive:t.workspacePaused,schedule:task.schedule||'—',lastRun:task.lastRunAt?dateTime(task.lastRunAt):'—',account:accountLabel(task.account)}))}
          renderCell={(row,column)=>column.key==='actions'?<button type="button" aria-expanded={inspected===row.key} onClick={()=>setInspected(inspected===row.key?'':String(row.key))}>{t.auiDetails}</button>:undefined}/>
        {items.filter(task=>`${task.source}:${task.account}:${task.id}`===inspected).map(task => <details open key={`${task.source}:${task.account}:${task.id}`} className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <summary className="cursor-pointer text-sm flex items-center justify-between gap-2">
            <span>{task.name} <span className="text-zinc-600 text-[10px] ml-1">{task.account === 'local' ? '' : accountLabel(task.account)}</span></span>
            <span className={`text-xs ${task.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>{task.enabled ? (tr ? 'Aktif' : 'Active') : (tr ? 'Duraklatılmış' : 'Paused')}</span>
          </summary>
          <div className="mt-3 space-y-2 text-xs text-zinc-400 break-all">
            <p>{tr ? 'Sistem / Hesap' : 'System / Account'}: {task.platform} / {accountLabel(task.account)}</p>
            <p>{tr ? 'Takvim' : 'Schedule'}: <code>{task.schedule || '—'}</code></p>
            {task.workingDirectory && <p>{tr ? 'Klasör' : 'Folder'}: {task.workingDirectory}</p>}
            <pre className="whitespace-pre-wrap break-words rounded bg-zinc-950 p-3 max-h-64 overflow-auto">{task.prompt || (tr ? 'Prompt bulunamadı' : 'Prompt unavailable')}</pre>
            {task.runs && task.runs.length > 0 && <div className="space-y-1 break-normal">
              <h4 className="text-zinc-300 font-semibold">{tr ? 'Koşu geçmişi' : 'Run history'} ({task.runs.length})</h4>
              <ul className="space-y-1">{task.runs.map(run => <li key={run.desktopId} className="rounded border border-zinc-800 px-3 py-2">
                <a className="text-cyan-300 hover:underline" href={`/?tab=codex&provider=claude-code&session=${encodeURIComponent(run.nativeId)}`}>{dateTime(run.at)}</a>
                <span className="text-zinc-500"> · {accountLabel(run.account)}</span>
                <p className={run.outcome ? 'text-zinc-400 mt-1' : 'text-amber-400 mt-1'}>{run.outcome ? run.outcome : (tr ? 'Arşivde asistan cevabı yok: koşu bir şey yapmamış olabilir.' : 'No assistant reply in the archive: this run may have done nothing.')}</p>
              </li>)}</ul>
            </div>}
            {task.source === 'claude' && task.account === data.activeClaudeAccount && task.platform === localPlatform && <button type="button" disabled={busy || !task.schedule} onClick={() => copyToCodex(task)} className="px-3 py-2 rounded border border-cyan-800 hover:bg-cyan-950 disabled:opacity-40">{tr ? 'Codex’e kopyala' : 'Copy to Codex'}</button>}
            {task.platform === localPlatform && <button disabled={busy || (task.source === 'claude' && task.account !== data.activeClaudeAccount)} onClick={() => toggleTask(task)}
              className="px-3 py-2 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40">
              {task.enabled ? (tr ? 'Duraklat' : 'Pause') : (tr ? 'Etkinleştir' : 'Enable')}
            </button>}
          </div>
        </details>)}
      </div>;
    })}
  </section>;
}
