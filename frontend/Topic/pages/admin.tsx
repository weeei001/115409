import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Activity, Loader2, Pause, Play, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import apiClient, { ApiRequestError } from '@/lib/api/client';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { adminMe, adminScheduleState, canRetryAdminRun, canStartAdminJob } from '@/lib/api/admin';
import type { AdminAudit, AdminJob, AdminList, AdminOverview, AdminRun, Administrator } from '@/lib/api/admin';
import { AUTH_CHANGE_EVENT, getToken } from '@/lib/auth/storage';
import { cn } from '@/lib/cn';
import { AdminRunDiagnostics } from '@/features/admin/RunDiagnostics';

const PAGE_SIZE = 20;
const LOGIN = { pathname: '/login', query: { returnUrl: '/admin' } };
const JOB_LABELS: Record<string, string> = {
  market: '行情更新', cnyes: '鉅亨新聞', ltn: '自由財經新聞', rag: '新聞索引', impact: '新聞影響分析', 'text-brief': '個股摘要',
};
const SERVICE_LABELS: Record<string, string> = { api: 'API', database: '資料庫', qdrant: 'Qdrant', scheduler: '排程器' };
const STATUS_LABELS: Record<string, string> = {
  healthy: '正常', running: '執行中', queued: '等待執行', success: '成功', succeeded: '成功', failed: '失敗',
  unavailable: '無法連線', unhealthy: '異常', unconfigured: '未設定', not_configured: '未設定', disabled: '未啟用', standby: '待命', interrupted: '已中斷',
  paused: '已暫停', active: '運作中', enabled: '已啟用', error: '異常', stopped: '已停止', rejected: '已拒絕',
  starting: '啟動中', stopping: '停止中',
};
const ACTION_LABELS: Record<string, string> = {
  'job.run': '執行工作', 'job.retry': '重跑工作', 'job.pause': '暫停排程', 'job.resume': '恢復排程',
  'admin.grant': '授予管理員', 'admin.revoke': '撤銷管理員', 'administrator.grant': '授予管理員', 'administrator.revoke': '撤銷管理員',
  'administrator.bootstrap': '設定初始管理員', 'access.denied': '後台存取遭拒',
};
const TRIGGER_LABELS: Record<string, string> = { scheduled: '排程', schedule: '排程', manual: '手動', retry: '重跑' };
const TABS = [{ id: 'jobs', label: '工作與執行紀錄' }, { id: 'audit', label: '操作紀錄' }, { id: 'admins', label: '管理員' }] as const;
const cellClass = 'px-4 py-3 align-top';

function timeText(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function scheduleText(value: string | null): string {
  return value?.replace(/^Daily (\d{2}:\d{2}) Asia\/Taipei$/, '每日 $1（台北時間）')
    .replace(/^Every ([\d.]+) minutes$/, '每 $1 分鐘')
    .replace(/^After data jobs \+ ([\d.]+) minutes$/, '資料工作完成後 $1 分鐘')
    .replace(/^Manual$/, '手動執行') || '未設定排程';
}

function Status({ value, label }: { value: string; label?: string }) {
  const tone = ['healthy', 'success', 'succeeded', 'active', 'running', 'enabled'].includes(value)
    ? 'border-success-border bg-success-muted text-success'
    : ['failed', 'unavailable', 'unhealthy', 'error', 'interrupted', 'rejected'].includes(value)
      ? 'border-danger-border bg-danger-muted text-danger'
      : 'border-border bg-muted text-subtle';
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium', tone)}><span className="size-1.5 rounded-full bg-current" aria-hidden />{label ?? STATUS_LABELS[value] ?? value}</span>;
}

function Pagination({ offset, total, busy, onChange }: { offset: number; total: number; busy: boolean; onChange: (value: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
      <span>{total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}，共 ${total} 筆` : '共 0 筆'}</span>
      <div className="flex gap-2">
        <Button variant="outline" className="min-h-10" disabled={busy || offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>上一頁</Button>
        <Button variant="outline" className="min-h-10" disabled={busy || offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>下一頁</Button>
      </div>
    </div>
  );
}

export function AdminJobs({ jobs, disabled, onAction, checkedAt, schedulerStatus }: { jobs: AdminJob[]; disabled: boolean; onAction: (job: AdminJob, action: 'run' | 'pause' | 'resume') => void; checkedAt?: string; schedulerStatus?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-4 sm:px-5"><h2 className="font-semibold">工作排程</h2><p className="text-xs text-muted-foreground">暫停只停止後續排程，執行中的工作會繼續完成。</p></div>
      {!jobs.length ? <EmptyState>目前沒有工作排程。</EmptyState> : <ul className="divide-y">
        {jobs.map((job) => (
          <li key={job.name} className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{JOB_LABELS[job.name] || job.label || job.name}</h3><Status value={job.paused ? 'paused' : 'enabled'} />{job.active_run_id != null ? <Status value="running" /> : job.queued_run_id != null ? <Status value="queued" /> : null}</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{scheduleText(job.schedule)}<span className="mx-2" aria-hidden>·</span>下次預定：{timeText(job.next_run_at)}</p>
              <p className="text-xs leading-5 text-muted-foreground">{adminScheduleState(job, jobs, checkedAt, schedulerStatus)}</p>
              <div className="mt-2 text-xs leading-5">
                {job.result_summary ? <>
                  <p>最近成功：{job.result_summary.last_success ? `#${job.result_summary.last_success.id} · ${timeText(job.result_summary.last_success.finished_at)}` : '尚無成功紀錄'}</p>
                  <p>最近失敗：{job.result_summary.last_failure ? `#${job.result_summary.last_failure.id} · ${timeText(job.result_summary.last_failure.finished_at)}` : '尚無失敗紀錄'} · 連續失敗 {job.result_summary.consecutive_failed} 次</p>
                  <p className="text-muted-foreground">統計全部已保存紀錄（{job.result_summary.terminal_runs} 筆已結束）；中斷會結束失敗連續計數。</p>
                </> : <p className="text-muted-foreground">工作結果摘要尚無法取得。</p>}
                <p className="text-muted-foreground">資料截至日：未知；工作成功時間不代表資料已完整更新。</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={disabled || !canStartAdminJob(job)} onClick={() => onAction(job, 'run')} aria-label={`立即執行${JOB_LABELS[job.name] || job.label || job.name}`}><Play aria-hidden />立即執行</Button>
              {!['impact', 'text-brief'].includes(job.name) ? <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={disabled} onClick={() => onAction(job, job.paused ? 'resume' : 'pause')} aria-label={`${job.paused ? '恢復' : '暫停'}${JOB_LABELS[job.name] || job.label || job.name}排程`}>{job.paused ? <Play aria-hidden /> : <Pause aria-hidden />}{job.paused ? '恢復排程' : '暫停排程'}</Button> : null}
            </div>
          </li>
        ))}
      </ul>}
    </div>
  );
}

export function AdminRunHistory({ runs, jobs, disabled, onRetry }: { runs: AdminRun[]; jobs: AdminJob[]; disabled: boolean; onRetry: (run: AdminRun) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[740px] text-left text-sm">
        <caption className="sr-only">工作執行紀錄，時間為台北時間</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{['工作', '狀態', '開始／結束', '耗時', '來源', '操作'].map((heading) => <th key={heading} scope="col" className={cellClass}>{heading}</th>)}</tr></thead>
        <tbody className="divide-y">
          {runs.map((run) => <React.Fragment key={run.id}>
            <tr>
              <td className={cellClass}><span className="font-medium">{JOB_LABELS[run.job_name] ?? run.job_name}</span><span className="mt-1 block font-mono text-xs text-muted-foreground">#{run.id}{run.retry_of != null ? ` · 重跑 #${run.retry_of}` : ''}</span></td>
              <td className={cellClass}><Status value={run.status} /></td>
              <td className={cn(cellClass, 'whitespace-nowrap text-xs leading-6 tabular-nums')}>{timeText(run.started_at)}<span className="block text-muted-foreground">{timeText(run.finished_at)}</span></td>
              <td className={cn(cellClass, 'whitespace-nowrap tabular-nums')}>{run.duration_seconds == null ? '—' : `${Math.round(run.duration_seconds)} 秒`}</td>
              <td className={cellClass}>{TRIGGER_LABELS[run.trigger] ?? run.trigger}</td>
              <td className={cellClass}><Button variant="outline" className="min-h-10" disabled={disabled || !canRetryAdminRun(run, jobs)} onClick={() => onRetry(run)} aria-label={`重跑${JOB_LABELS[run.job_name] ?? run.job_name}執行紀錄 ${run.id}`}><RotateCcw aria-hidden />重跑</Button></td>
            </tr>
            <tr><td colSpan={6} className="px-4 pb-3"><AdminRunDiagnostics run={run} /></td></tr>
          </React.Fragment>)}
        </tbody>
      </table>
      {!runs.length ? <EmptyState>目前沒有執行紀錄。工作執行後會顯示在這裡。</EmptyState> : null}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  const [me, setMe] = useState<Administrator | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [runs, setRuns] = useState<AdminList<AdminRun>>({ items: [], total: 0 });
  const [audit, setAudit] = useState<AdminList<AdminAudit>>({ items: [], total: 0 });
  const [admins, setAdmins] = useState<Administrator[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('jobs');
  const [runOffset, setRunOffset] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [email, setEmail] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryCheck, setRetryCheck] = useState(0);
  const accessRef = useRef(access);
  accessRef.current = access;
  const readController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const reading = useRef(false);
  const acting = useRef(false);
  const routerRef = useRef(router);
  routerRef.current = router;

  const handleAccessError = useCallback((err: unknown): boolean => {
    if (!(err instanceof ApiRequestError) || ![401, 403].includes(err.status ?? 0)) return false;
    setOverview(null);
    setRuns({ items: [], total: 0 });
    setAudit({ items: [], total: 0 });
    setAdmins([]);
    setMe(null);
    setAccess('denied');
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    if (err.status === 401) void routerRef.current.replace(LOGIN);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    reading.current = true;
    setRefreshing(true);
    try {
      const config = { signal: controller.signal };
      const [nextOverview, nextRuns, nextAudit, nextAdmins] = await Promise.all([
        apiClient.get<AdminOverview>('/admin/overview', config),
        apiClient.get<AdminList<AdminRun>>('/admin/runs', { ...config, params: { limit: PAGE_SIZE, offset: runOffset } }),
        apiClient.get<AdminList<AdminAudit>>('/admin/audit', { ...config, params: { limit: PAGE_SIZE, offset: auditOffset } }),
        apiClient.get<AdminList<Administrator>>('/admin/administrators', config),
      ]);
      if (controller.signal.aborted || !mounted.current) return;
      setOverview(nextOverview.data);
      setRuns(nextRuns.data);
      setAudit(nextAudit.data);
      setAdmins(nextAdmins.data.items);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || !mounted.current) return;
      if (!handleAccessError(err)) setError(userFacingMessage(err, '無法更新後台資料，請重新整理。'));
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        reading.current = false;
        setRefreshing(false);
      }
    }
  }, [runOffset, auditOffset, handleAccessError]);

  useEffect(() => {
    if (!router.isReady) return;
    mounted.current = true;
    const controller = new AbortController();
    let verified = false;
    const authToken = getToken();
    const check = async () => {
      if (!getToken()) {
        void routerRef.current.replace(LOGIN);
        return;
      }
      try {
        const administrator = await adminMe(controller.signal);
        if (controller.signal.aborted) return;
        verified = true;
        setMe(administrator);
        setAccess('allowed');
        await refresh();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!handleAccessError(err)) {
          setAccess('error');
          setError(userFacingMessage(err, '無法確認後台權限，請稍後再試。'));
        }
      }
    };
    void check();
    const update = () => {
      if (verified && accessRef.current === 'allowed' && !document.hidden && !reading.current && !acting.current && getToken()) void refresh();
    };
    const onAuthChange = () => {
      const nextToken = getToken();
      if (nextToken === authToken) return;
      readController.current?.abort();
      actionController.current?.abort();
      setOverview(null);
      setMe(null);
      setRuns({ items: [], total: 0 });
      setAudit({ items: [], total: 0 });
      setAdmins([]);
      setAccess(nextToken ? 'loading' : 'denied');
      if (nextToken) setRetryCheck((value) => value + 1);
      else void routerRef.current.replace(LOGIN);
    };
    const timer = window.setInterval(update, 20_000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => {
      mounted.current = false;
      controller.abort();
      readController.current?.abort();
      actionController.current?.abort();
      reading.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    };
  }, [router.isReady, refresh, handleAccessError, retryCheck]);

  const mutate = async (request: (signal: AbortSignal) => Promise<unknown>, message: string) => {
    if (acting.current) return;
    acting.current = true;
    setPending(true);
    setActionMessage(null);
    setActionError(null);
    const controller = new AbortController();
    actionController.current = controller;
    try {
      await request(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setActionMessage(message);
      await refresh();
    } catch (err) {
      if (!controller.signal.aborted && mounted.current && !handleAccessError(err)) setActionError(userFacingMessage(err, '操作失敗，請重新整理狀態後再試。'));
    } finally {
      acting.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const jobAction = (job: AdminJob, action: 'run' | 'pause' | 'resume') => {
    const label = JOB_LABELS[job.name] || job.label || job.name;
    if (action === 'run' && !window.confirm(`立即執行「${label}」？這會執行實際工作。`)) return;
    void mutate((signal) => apiClient.post(`/admin/jobs/${encodeURIComponent(job.name)}/${action}`, undefined, { signal }), action === 'run' ? `已提交「${label}」執行。` : `已${action === 'pause' ? '暫停' : '恢復'}「${label}」排程。`);
  };
  const retryRun = (run: AdminRun) => {
    if (!window.confirm(`重跑「${JOB_LABELS[run.job_name] ?? run.job_name}」執行紀錄 #${run.id}？這會重新執行實際工作。`)) return;
    void mutate((signal) => apiClient.post(`/admin/jobs/${encodeURIComponent(run.job_name)}/retry`, { run_id: run.id }, { signal }), `已提交執行紀錄 #${run.id} 的重跑。`);
  };
  const grant = (event: React.FormEvent) => {
    event.preventDefault();
    const target = email.trim();
    if (!target || !window.confirm(`授予 ${target} 管理員權限？此帳號將能控制工作與管理其他管理員。`)) return;
    void mutate((signal) => apiClient.post('/admin/administrators', { email: target }, { signal }), `已授予 ${target} 管理員權限。`);
  };
  const revoke = (administrator: Administrator) => {
    if (!window.confirm(`撤銷 ${administrator.email} 的管理員權限？`)) return;
    void mutate((signal) => apiClient.delete(`/admin/administrators/${administrator.user_id}`, { signal }), `已撤銷 ${administrator.email} 的管理員權限。`);
  };

  const head = <Head><title>股海明燈｜管理後台</title><meta name="description" content="查看服務狀態、控制工作排程及管理後台權限。" /><meta name="robots" content="noindex,nofollow" /></Head>;
  const header = <SiteHeader icon={ShieldCheck} title="管理後台" subtitle="服務狀態與工作排程" />;
  if (access !== 'allowed') return <>{head}{header}<main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-20">
    {access === 'loading' ? <div role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" aria-hidden />確認後台權限中…</div>
      : access === 'denied' ? <Notice tone="danger">目前帳號沒有管理後台權限。請由管理員授予權限後再進入。</Notice>
        : <><Notice tone="danger">{error}</Notice><Button variant="outline" onClick={() => setRetryCheck((value) => value + 1)}>重新確認權限</Button></>}
    {access !== 'loading' ? <Link href="/" className="text-center text-sm text-brand-text underline underline-offset-4">回首頁</Link> : null}
  </main></>;

  const disabled = pending || Boolean(error) || !overview;
  const jobsDisabled = disabled || overview?.scheduler.status !== 'running';
  const activeAdmins = admins.filter((administrator) => administrator.is_active !== false).length;
  return <>{head}{header}<main aria-label="管理後台" className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="rounded-md border border-border-strong bg-accent px-3 py-1.5 text-sm font-semibold text-brand-text">{overview?.environment === 'production' ? '正式環境' : overview?.environment === 'development' ? '開發環境' : '環境確認中'}</span>
        <p className="text-xs leading-5 text-muted-foreground">{overview ? `更新於 ${timeText(overview.checked_at)}` : '正在讀取服務狀態…'}<span className="block">台北時間 · 前景每 20 秒更新</span></p>
      </div>
      <Button variant="outline" className="min-h-11" disabled={refreshing || pending} onClick={() => void refresh()}><RefreshCw className={refreshing ? 'animate-spin' : undefined} aria-hidden />{refreshing ? '更新中' : '重新整理'}</Button>
    </div>
    {error ? <Notice tone="danger">{error}{overview ? ' 畫面保留上次資料，狀態可能已過期；更新成功後才能操作。' : ''}</Notice> : null}
    {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
    {actionMessage ? <Notice tone="success">{actionMessage}</Notice> : null}
    {!overview && !error ? <div role="status" className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 size-6 animate-spin text-brand" aria-hidden />載入服務與工作資料中…</div> : null}
    {overview ? <>
      <section aria-labelledby="services-heading" className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-4 sm:px-5"><Activity className="size-4 text-brand-text" aria-hidden /><h2 id="services-heading" className="font-semibold">服務連線與存活</h2><p className="text-xs text-muted-foreground">連線正常不代表工作成功或資料新鮮。</p></div>
        <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">{overview.services.map((service) => <div key={service.name} className="min-w-0 p-4 sm:border-r sm:last:border-r-0 sm:p-5"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{SERVICE_LABELS[service.name] ?? service.name}</h3><Status value={service.status} label={service.status === 'healthy' ? '可連線' : service.name === 'scheduler' && service.status === 'running' ? '存活' : undefined} /></div><p className="break-words text-xs leading-5 text-muted-foreground">{service.detail || (service.name === 'scheduler' ? '只確認排程器存活，工作處理進度另看執行紀錄。' : '只確認服務可連線。')}{service.latency_ms != null ? ` · ${Math.round(service.latency_ms)} ms` : ''}</p></div>)}</div>
        {overview.scheduler.heartbeat || overview.scheduler.error ? <p className={cn('border-t px-4 py-3 text-xs leading-5 sm:px-5', overview.scheduler.error ? 'text-danger' : 'text-muted-foreground')}>排程器最後回報：{timeText(overview.scheduler.heartbeat)}{overview.scheduler.error ? ` · ${overview.scheduler.error}` : ''}</p> : null}
      </section>
      <nav aria-label="後台功能" className="flex gap-1 overflow-x-auto border-b">{TABS.map((item) => <button type="button" key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={cn('min-h-12 shrink-0 border-b-2 px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring', tab === item.id ? 'border-brand text-brand-text' : 'border-transparent text-muted-foreground hover:text-foreground')}>{item.label}</button>)}</nav>
      {tab === 'jobs' ? <div className="space-y-6">{overview.scheduler.status !== 'running' ? <Notice tone="warning">排程器目前無法接受工作操作，恢復運作後即可執行或變更排程。</Notice> : null}<AdminJobs jobs={overview.jobs} disabled={jobsDisabled} onAction={jobAction} checkedAt={overview.checked_at} schedulerStatus={overview.scheduler.status} /><section aria-labelledby="runs-heading" className="overflow-hidden rounded-xl border bg-card"><h2 id="runs-heading" className="border-b px-4 py-4 font-semibold sm:px-5">執行紀錄</h2><AdminRunHistory runs={runs.items} jobs={overview.jobs} disabled={jobsDisabled} onRetry={retryRun} /><Pagination offset={runOffset} total={runs.total} busy={refreshing || pending} onChange={setRunOffset} /></section></div> : null}
      {tab === 'audit' ? <section aria-labelledby="audit-heading" className="overflow-hidden rounded-xl border bg-card"><h2 id="audit-heading" className="border-b px-4 py-4 font-semibold sm:px-5">操作紀錄</h2><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><caption className="sr-only">後台操作與管理員權限變更，時間為台北時間</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{['時間', '操作者', '動作／對象', '結果'].map((heading) => <th key={heading} scope="col" className={cellClass}>{heading}</th>)}</tr></thead><tbody className="divide-y">{audit.items.map((item) => <tr key={item.id}><td className={cn(cellClass, 'whitespace-nowrap text-xs tabular-nums')}>{timeText(item.created_at)}</td><td className={cn(cellClass, 'break-all')}>{item.actor_email ?? '系統'}</td><td className={cellClass}>{ACTION_LABELS[item.action] ?? item.action}<span className="mt-1 block break-all text-xs text-muted-foreground">{item.target}</span>{item.details != null ? <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">詳細資訊</summary><pre className="mt-2 max-h-40 max-w-md overflow-auto whitespace-pre-wrap break-words">{typeof item.details === 'string' ? item.details : JSON.stringify(item.details, null, 2)}</pre></details> : null}</td><td className={cellClass}><Status value={item.status} /></td></tr>)}</tbody></table>{!audit.items.length ? <EmptyState>目前沒有後台操作紀錄。</EmptyState> : null}</div><Pagination offset={auditOffset} total={audit.total} busy={refreshing || pending} onChange={setAuditOffset} /></section> : null}
      {tab === 'admins' ? <section aria-labelledby="admins-heading" className="overflow-hidden rounded-xl border bg-card"><div className="border-b px-4 py-4 sm:px-5"><h2 id="admins-heading" className="font-semibold">管理員權限</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">所有管理員權限相同，可控制工作與授予／撤銷管理員資格。</p></div><form onSubmit={grant} className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end sm:p-5"><div className="flex-1"><label htmlFor="admin-email" className="mb-2 block text-sm font-medium">授予現有帳號管理員權限</label><Input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" maxLength={320} placeholder="輸入帳號電子郵件" disabled={disabled} className="min-h-11" /></div><Button type="submit" className="min-h-11" disabled={disabled || !email.trim()}><ShieldCheck aria-hidden />授予權限</Button></form><ul className="divide-y">{admins.map((administrator) => <li key={administrator.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5"><div className="min-w-0"><p className="break-all text-sm font-medium">{administrator.email}{administrator.user_id === me?.user_id ? <span className="ml-2 text-xs text-brand-text">目前帳號</span> : null}</p>{administrator.display_name ? <p className="mt-1 text-xs text-muted-foreground">{administrator.display_name}</p> : null}{administrator.is_active === false ? <p className="mt-1 text-xs text-danger">帳號已停用</p> : null}</div><Button variant="outline" className="min-h-11 border-danger-border text-danger hover:bg-danger-muted hover:text-danger" disabled={disabled || (activeAdmins <= 1 && administrator.is_active !== false)} onClick={() => revoke(administrator)} aria-label={`撤銷 ${administrator.email} 的管理員權限`}><Trash2 aria-hidden />撤銷權限</Button></li>)}</ul>{!admins.length ? <EmptyState>沒有管理員資料。</EmptyState> : null}{activeAdmins === 1 ? <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">至少保留一位管理員；請先授予另一個帳號權限，才能撤銷目前管理員。</p> : null}</section> : null}
    </> : null}
    <p className="text-xs text-muted-foreground">後台操作與權限變更會留下紀錄。{pending ? <span role="status" className="ml-2 text-brand-text">操作處理中…</span> : null}</p>
  </main></>;
}
