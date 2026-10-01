import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminScheduleState, canRetryAdminRun, canStartAdminJob } from '../../lib/api/admin';
import type { AdminJob, AdminRun } from '../../lib/api/admin';
import { AdminJobs, AdminRunHistory } from '../../pages/admin';
import { AdminRunDiagnostics } from './RunDiagnostics';

const job: AdminJob = {
  name: 'market', schedule: '每日 16:00', paused: true, next_run_at: null, active_run_id: null,
};
const run: AdminRun = {
  id: 7, job_name: 'market', status: 'failed', trigger: 'manual', retry_of: null,
  started_at: '2026-09-30T02:00:00Z', finished_at: '2026-09-30T02:00:05Z',
  exit_code: 1, error: '<script>unsafe()</script>', duration_seconds: 5,
};

assert.equal(canStartAdminJob(job), true, 'Pausing automatic schedules still allows a manual run.');
assert.equal(canStartAdminJob({ ...job, active_run_id: 9 }), false);
assert.equal(canStartAdminJob({ ...job, queued_run_id: 9 }), false);
for (const status of ['succeeded', 'failed', 'interrupted']) {
  assert.equal(canRetryAdminRun({ ...run, status }, [job]), true);
}
for (const status of ['queued', 'running', 'unknown']) {
  assert.equal(canRetryAdminRun({ ...run, status }, [job]), false);
}
assert.equal(canRetryAdminRun(run, [{ ...job, active_run_id: 9 }]), false, 'Do not overlap a retry with any current run.');
assert.equal(canRetryAdminRun(run, [{ ...job, queued_run_id: 9 }]), false, 'Do not overlap a retry with a queued run.');
assert.equal(canRetryAdminRun(run, []), false, 'Unknown jobs cannot be retried.');

const jobsMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...job, active_run_id: 9 }]} disabled={false} onAction={() => undefined} />);
assert.match(jobsMarkup, /已暫停/);
assert.match(jobsMarkup, /執行中/);
assert.match(jobsMarkup, /disabled=""[^>]*aria-label="立即執行行情更新"/);
assert.doesNotMatch(jobsMarkup, /disabled=""[^>]*aria-label="恢復行情更新排程"/);
const queuedMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...job, queued_run_id: 9 }]} disabled={false} onAction={() => undefined} />);
assert.match(queuedMarkup, /等待執行/);
assert.match(queuedMarkup, /disabled=""[^>]*aria-label="立即執行行情更新"/);
const manualMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...job, name: 'impact', schedule: 'Manual', paused: false }]} disabled={false} onAction={() => undefined} />);
assert.match(manualMarkup, /手動執行/);
assert.doesNotMatch(manualMarkup, /暫停新聞影響分析排程/);

const historyMarkup = renderToStaticMarkup(<AdminRunHistory runs={[run]} jobs={[job]} disabled={true} onRetry={() => undefined} />);
assert.match(historyMarkup, /disabled=""[^>]*aria-label="重跑行情更新執行紀錄 7"/);
assert.match(historyMarkup, /2026\/9\/30\s10:00:00/);
assert.match(historyMarkup, /5 秒/);
assert.match(historyMarkup, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
assert.doesNotMatch(historyMarkup, /<script>/);
const diagnosticMarkup = renderToStaticMarkup(<AdminRunDiagnostics run={{ ...run, diagnostics: {
  run_id: 7, error_category: 'stage_nonzero', failed_stages: [{ stage: 'news-impact-batch', exit_code: 1 }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown', worker_progress: 'unknown',
} }} />);
assert.match(diagnosticMarkup, /根因待查/);
assert.match(diagnosticMarkup, /子工作處理進度未知/);
assert.match(diagnosticMarkup, /admin_run=7/);
assert.match(diagnosticMarkup, /news-impact-batch/);
assert.doesNotMatch(diagnosticMarkup, /死鎖|已恢復/);
const now = '2026-10-01T13:00:00Z';
const future = { ...job, paused: false, next_run_at: '2026-10-01T13:30:00Z' };
const due = { ...future, next_run_at: '2026-10-01T12:30:00Z' };
assert.match(adminScheduleState(future, [future], now), /預定時間/);
assert.match(adminScheduleState(due, [due], now), /已到期.*原因未知/);
assert.match(adminScheduleState(due, [due, { ...job, active_run_id: 39 }], now), /已到期.*#39/);
assert.match(adminScheduleState({ ...due, active_run_id: 7 }, [due], now), /正在執行 #7/);
assert.match(adminScheduleState({ ...due, queued_run_id: 8 }, [due], now), /已排入等待 #8/);
assert.match(adminScheduleState(job, [job], now), /已暫停/);
assert.match(adminScheduleState({ ...future, schedule: 'Manual', next_run_at: null }, [], now), /僅手動/);
assert.match(adminScheduleState({ ...future, name: 'rag', next_run_at: null }, [], now), /等待資料工作/);
assert.match(adminScheduleState(future, [], now, 'stopped'), /排程器未運作/);
const summaryMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...due, result_summary: {
  history_scope: 'all_stored_runs', terminal_runs: 41, last_success: { ...run, id: 1, status: 'succeeded' },
  last_failure: run, consecutive_failed: 40,
} }]} disabled={false} checkedAt={now} onAction={() => undefined} />);
assert.match(summaryMarkup, /最近成功：#1/);
assert.match(summaryMarkup, /連續失敗 40 次/);
assert.match(summaryMarkup, /統計全部已保存紀錄/);
assert.match(summaryMarkup, /資料截至日：未知/);
assert.match(summaryMarkup, /已到期/);
assert.doesNotMatch(summaryMarkup, /資料已成功更新|死鎖/);
console.log('Admin checks passed: paused manual runs, overlap guards, completed retries, unavailable actions, manual-only jobs, Taipei timestamps, and escaped errors.');
