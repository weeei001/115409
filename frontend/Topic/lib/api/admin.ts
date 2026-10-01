import apiClient from './client';

export interface Administrator {
  user_id: number;
  email: string;
  display_name?: string | null;
  created_at?: string;
  is_active?: boolean;
}

export interface AdminJob {
  name: string;
  label?: string;
  schedule: string | null;
  paused: boolean;
  next_run_at: string | null;
  active_run_id: number | null;
  queued_run_id?: number | null;
  result_summary?: {
    history_scope: 'all_stored_runs';
    terminal_runs: number;
    last_success: AdminRun | null;
    last_failure: AdminRun | null;
    consecutive_failed: number;
  };
}

export interface AdminRun {
  id: number;
  job_name: string;
  status: string;
  trigger: string;
  actor_id?: number | null;
  retry_of: number | null;
  created_at?: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
  duration_seconds?: number | null;
  diagnostics?: {
    run_id: number;
    error_category: string | null;
    failed_stages: Array<{ stage: string; exit_code: number }>;
    stage: string | null;
    stage_started_at: string | null;
    last_activity_at: string | null;
    activity_kind: 'stage_started' | 'unknown';
    worker_progress: 'unknown';
  } | null;
}

export interface AdminAudit {
  id: number;
  actor_email: string | null;
  action: string;
  target: string;
  status: string;
  created_at: string;
  details?: unknown;
}

export interface AdminOverview {
  environment: string;
  checked_at: string;
  services: Array<{ name: string; status: string; detail?: string; latency_ms?: number }>;
  scheduler: { status: string; heartbeat: string | null; error: string | null };
  jobs: AdminJob[];
  recent_runs: AdminRun[];
}

export interface AdminList<T> {
  items: T[];
  total: number;
}

export async function adminMe(signal?: AbortSignal): Promise<Administrator> {
  const { data } = await apiClient.get<Administrator>('/admin/me', { signal });
  return data;
}

export function canStartAdminJob(job: AdminJob): boolean {
  return job.active_run_id == null && job.queued_run_id == null;
}

export function canRetryAdminRun(run: AdminRun, jobs: AdminJob[]): boolean {
  const job = jobs.find((item) => item.name === run.job_name);
  return Boolean(job && canStartAdminJob(job) && ['success', 'succeeded', 'failed', 'interrupted'].includes(run.status));
}

export function adminScheduleState(job: AdminJob, jobs: AdminJob[], checkedAt?: string, schedulerStatus = 'running'): string {
  if (job.paused) return '排程已暫停；手動執行不受影響';
  if (job.active_run_id != null) return `正在執行 #${job.active_run_id}；下次時間於完成後確認`;
  if (job.queued_run_id != null) return `已排入等待 #${job.queued_run_id}；開始時間尚未確認`;
  if (schedulerStatus !== 'running') return '排程器未運作；下次時間尚無法確認';
  if (job.next_run_at) {
    const deadline = Date.parse(job.next_run_at);
    const observed = checkedAt ? Date.parse(checkedAt) : NaN;
    if (Number.isFinite(deadline) && Number.isFinite(observed) && deadline <= observed) {
      const previous = jobs.find((item) => item.active_run_id != null);
      return previous ? `已到期，序列排程等待工作 #${previous.active_run_id} 完成` : '已到期，尚未開始；等待原因未知';
    }
    return '預定時間；實際開始依序列排程而定';
  }
  return job.schedule === 'Manual' ? '僅手動執行，沒有下次排程' : job.name === 'rag'
    ? '目前沒有後續排程；等待資料工作完成後安排' : '尚無下次排程資訊';
}
