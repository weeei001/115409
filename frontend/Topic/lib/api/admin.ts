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
