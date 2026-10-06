import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { acceptedJobAudit, adminDuration, adminJobAlerts, adminRetryBlockedReason, adminRunScope, adminRunId, adminScheduleState, auditRunId, canRetryAdminRun, canStartAdminJob, filterAdminRuns } from '../../lib/api/admin';
import type { AdminAudit, AdminJob, AdminRun } from '../../lib/api/admin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminLoginHref, AdminAuditResult, AdminJobAlertSummary, AdminJobs, AdminRunHistory } from '../../pages/admin';
import { AdminRunDiagnostics } from './RunDiagnostics';
import { renderedElements, renderedText } from '../../lib/testing/markup';

const job: AdminJob = {
  name: 'market', schedule: '每日 16:00', paused: true, next_run_at: null, active_run_id: null,
};
const run: AdminRun = {
  id: 7, job_name: 'market', status: 'failed', trigger: 'manual', retry_of: null,
  started_at: '2026-09-30T02:00:00Z', finished_at: '2026-09-30T02:00:05Z',
  exit_code: 1, error: '<script>unsafe()</script>', duration_seconds: 5,
};

const pipeline: AdminJob = { ...job, name: 'pipeline', schedule: 'Daily 20:00 Asia/Taipei', paused: false };
const source: AdminJob = { ...job, name: 'ltn', schedule: 'Pipeline source' };
const pipelineMarkup = renderToStaticMarkup(<AdminJobs jobs={[pipeline, { ...job, schedule: 'Manual' }, source]} disabled={false} onAction={() => undefined} />);
assert.match(pipelineMarkup, /每日 20:00/);
assert.equal((pipelineMarkup.match(/自動排程/g) ?? []).length, 1);
assert.match(pipelineMarkup, /立即執行完整更新流水線/);
assert.match(pipelineMarkup, /立即執行行情更新/);
assert.match(pipelineMarkup, /啟用自由財經新聞來源/);
assert.doesNotMatch(pipelineMarkup, /恢復行情更新排程/);
assert.match(adminScheduleState(source, [pipeline, source]), /完整流水線會略過/);
assert.match(adminScheduleState({ ...job, schedule: 'Manual' }, [pipeline]), /補跑不會接續/);

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
assert.match(historyMarkup, /2026\/9\/30 10:00:00/);
assert.match(historyMarkup, /5 秒/);
assert.equal(renderedElements(historyMarkup, 'script').length, 0);
// P2-148：診斷收在列內的按鈕，按了才展開；名稱是「執行診斷」（錯誤訊息的跳脫在下方 diagnosticMarkup 驗證）
assert.match(historyMarkup, /aria-expanded="false"[^>]*>執行診斷/);
assert.doesNotMatch(historyMarkup, /安全診斷/);
// P2-142：手機版一筆一張，起訖時間寫在同一行
assert.match(historyMarkup, /<ul class="divide-y sm:hidden"/);
assert.match(historyMarkup, /2026\/9\/30 10:00:00 → 2026\/9\/30 10:00:05/);
const diagnosticMarkup = renderToStaticMarkup(<AdminRunDiagnostics run={{ ...run, diagnostics: {
  run_id: 7, error_category: 'stage_nonzero', failed_stages: [{ stage: 'news-impact-batch', exit_code: 1 }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown', worker_progress: 'unknown',
} }} />);
assert.match(diagnosticMarkup, /根因待查/);
assert.match(diagnosticMarkup, /執行診斷/);
assert.match(diagnosticMarkup, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
assert.equal(renderedElements(diagnosticMarkup, 'script').length, 0);
assert.ok(renderedText(diagnosticMarkup).includes(run.error!));
assert.match(diagnosticMarkup, /子工作處理進度未知/);
assert.match(diagnosticMarkup, /admin_run=7/);
assert.match(diagnosticMarkup, /news-impact-batch/);
assert.doesNotMatch(diagnosticMarkup, /死鎖|已恢復/);
const reasonMarkup = renderToStaticMarkup(<AdminRunDiagnostics run={{ ...run, error: null, diagnostics: {
  run_id: 7, error_category: 'stage_nonzero', failed_stages: [{ stage: 'news-impact-batch', exit_code: 1,
    phase: 'analysis', reason: 'consecutive_failures', failure_reasons: { validation_failed: 3 } }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown', worker_progress: 'unknown',
} }} />);
assert.match(reasonMarkup, /失敗階段：事件分析/);
assert.match(reasonMarkup, /連續分析失敗，已停止本次工作/);
assert.match(reasonMarkup, /模型回覆未通過驗證 3 篇/);
assert.doesNotMatch(reasonMarkup, /根因待查/);
const now = '2026-10-01T13:00:00Z';
const future = { ...job, paused: false, next_run_at: '2026-10-01T13:30:00Z' };
const due = { ...future, next_run_at: '2026-10-01T12:30:00Z' };
assert.match(adminScheduleState(future, [future], now), /預定時間/);
assert.match(adminScheduleState(due, [due], now), /已到排程時間.*原因未知/);
assert.equal(adminScheduleState(due, [due, { ...job, active_run_id: 39 }], now), '已到排程時間，等 #39 完成後開始');
assert.doesNotMatch(adminScheduleState(due, [due, { ...job, active_run_id: 39 }], now), /序列排程/);
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
assert.match(summaryMarkup, /最近成功：.*執行紀錄 #1/);
assert.match(summaryMarkup, /連續失敗 40 次/);
assert.match(summaryMarkup, /統計全部已保存紀錄/);
assert.match(summaryMarkup, /資料截至日：未知/);
assert.match(summaryMarkup, /已到排程時間/);
assert.doesNotMatch(summaryMarkup, /資料已成功更新|死鎖/);
const audit: AdminAudit = { id: 12, actor_email: 'operator@example.test', action: 'job.run', target: 'market',
  status: 'succeeded', created_at: now, details: { run_id: 7 } };
for (const action of ['job.run', 'job.retry']) {
  assert.equal(acceptedJobAudit({ ...audit, action }), true);
  const markup = renderToStaticMarkup(<AdminAuditResult item={{ ...audit, action }} />);
  assert.match(markup, /執行請求已接受/);
  assert.match(markup, /href="\/admin\?run=7#run-detail"/);
  assert.doesNotMatch(markup, /工作結果成功/);
}
for (const action of ['job.pause', 'job.resume', 'administrator.grant', 'administrator.revoke']) {
  assert.equal(acceptedJobAudit({ ...audit, action }), false);
  assert.doesNotMatch(renderToStaticMarkup(<AdminAuditResult item={{ ...audit, action }} />), /執行請求已接受|run=7/);
}
for (const status of ['failed', 'rejected']) {
  assert.doesNotMatch(renderToStaticMarkup(<AdminAuditResult item={{ ...audit, status }} />), /執行請求已接受|run=7/);
}
for (const details of [null, 'run_id=7', {}, { run_id: '7' }, { run_id: -1 }, { run_id: 7.5 }, { run_id: 2147483648 }]) {
  assert.equal(auditRunId({ ...audit, details }), null);
  assert.match(renderToStaticMarkup(<AdminAuditResult item={{ ...audit, details }} />), /工作結果未知/);
}
for (const value of ['0', '007', ['7'], '7#other', NaN, Infinity, 2147483648, undefined]) assert.equal(adminRunId(value), null);
assert.equal(adminRunId('7'), 7);
assert.equal(adminRunId(7), 7);
assert.equal(adminDuration(3744), '62 分 24 秒');
assert.equal(adminDuration(null), '--');
assert.equal(adminRunScope({ job_name: 'text-brief', symbol: '2330' }), '股票 2330');
assert.equal(adminRunScope({ job_name: 'text-brief' }), '全部股票');
assert.match(adminScheduleState({ ...job, active_run_id: 9 }, [job]), /正在執行 #9/);
assert.match(adminScheduleState({ ...job, queued_run_id: 10 }, [{ ...job, active_run_id: 9 }]), /等待工作 #9 完成/);
const brief = { ...job, name: 'text-brief', paused: false, schedule: 'After news indexing' };
const briefMarkup = renderToStaticMarkup(<AdminJobs jobs={[brief]} disabled={false} onAction={() => undefined} />);
assert.match(briefMarkup, /label for="brief-symbol"/);
assert.match(briefMarkup, /select id="brief-symbol" required=""/);
// P2-145：無障礙名稱包含看得到的文字
assert.match(briefMarkup, /disabled=""[^>]*aria-label="立即執行個股摘要"/);
assert.match(briefMarkup, /新聞索引完成後自動執行/);
assert.match(briefMarkup, /暫停個股摘要排程/);
assert.doesNotMatch(briefMarkup, /option[^>]*>全部股票/);
const liveMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...brief, active_run_id: 7, active_run: {
  ...run, job_name: 'text-brief', symbol: '2330', status: 'running', duration_seconds: 3744,
  diagnostics: { run_id: 7, error_category: null, failed_stages: [], stage: 'cache-warmup', stage_started_at: now,
    last_activity_at: now, activity_kind: 'stage_started', worker_progress: 'unknown' },
} }]} disabled={false} onAction={() => undefined} />);
assert.match(liveMarkup, /目前階段：產生個股摘要/);
assert.match(liveMarkup, /62 分 24 秒/);
assert.match(liveMarkup, /執行範圍：股票 2330/);
const scopedHistory = renderToStaticMarkup(<AdminRunHistory runs={[{ ...run, job_name: 'text-brief', symbol: '2330' }, { ...run, id: 8, job_name: 'text-brief' }]} jobs={[brief]} disabled={false} onRetry={() => undefined} />);
assert.match(scopedHistory, /股票 2330/);
assert.match(scopedHistory, /全部股票/);
// P2-145：重跑停用時寫出原因
assert.equal(adminRetryBlockedReason(run, [job], '行情更新'), null);
assert.equal(adminRetryBlockedReason(run, [{ ...job, active_run_id: 9 }], '行情更新'), '行情更新執行中，完成後可重跑。');
assert.equal(adminRetryBlockedReason({ ...run, status: 'running' }, [job], '行情更新'), '這筆執行尚未結束，結束後可重跑。');
assert.equal(adminRetryBlockedReason(run, [], '行情更新'), '這項工作已不在排程裡，無法重跑。');
const blockedHistory = renderToStaticMarkup(<AdminRunHistory runs={[run]} jobs={[{ ...job, active_run_id: 9 }]} disabled={false} onRetry={() => undefined} />);
assert.match(blockedHistory, /aria-describedby="run-7-retry-reason"/);
assert.match(blockedHistory, /行情更新執行中，完成後可重跑。/);
// P2-148：狀態篩選
const mixed = [run, { ...run, id: 8, status: 'succeeded' }, { ...run, id: 9, status: 'running' }, { ...run, id: 10, status: 'interrupted' }];
assert.deepEqual(filterAdminRuns(mixed, 'failed').map((item) => item.id), [7, 10]);
assert.deepEqual(filterAdminRuns(mixed, 'running').map((item) => item.id), [9]);
assert.equal(filterAdminRuns(mixed, 'all').length, 4);
// P2-146：首屏工作摘要
const alerts = adminJobAlerts([
  { ...job, name: 'rag', paused: false, schedule: 'Every 30 minutes', result_summary: { history_scope: 'all_stored_runs', terminal_runs: 50, last_success: null, last_failure: run, consecutive_failed: 43 } },
  { ...job, name: 'ltn', paused: true, schedule: 'Every 30 minutes', result_summary: { history_scope: 'all_stored_runs', terminal_runs: 30, last_success: null, last_failure: run, consecutive_failed: 24 } },
  { ...job, name: 'impact', paused: true, schedule: 'Manual' },
]);
assert.deepEqual(alerts, { failing: [{ name: 'rag', count: 43 }, { name: 'ltn', count: 24 }], paused: ['ltn'] });
const alertMarkup = renderToStaticMarkup(<AdminJobAlertSummary jobs={[
  { ...job, name: 'rag', paused: false, schedule: 'Every 30 minutes', result_summary: { history_scope: 'all_stored_runs', terminal_runs: 50, last_success: null, last_failure: run, consecutive_failed: 43 } },
  { ...job, name: 'ltn', paused: true, schedule: 'Every 30 minutes' },
]} />);
assert.match(alertMarkup, /2 項工作：1 項連續失敗 · 1 項暫停/);
assert.match(alertMarkup, /href="#job-rag"[^>]*>新聞索引 連續失敗 43 次/);
assert.match(alertMarkup, /href="#job-ltn"[^>]*>自由財經新聞 已暫停/);
// P2-149：後端英文標籤不直接上畫面
const backfill = renderToStaticMarkup(<AdminJobs jobs={[{ ...job, name: 'stock-backfill', label: 'Stock market history', schedule: 'Manual', paused: false }]} disabled={false} onAction={() => undefined} />);
assert.match(backfill, /個股市場資料回補/);
assert.doesNotMatch(backfill, /Stock market history/);
assert.match(backfill, /id="job-stock-backfill"/);
// P2-143：未登入導去登入時保留 ?run=、?tab=
assert.deepEqual(adminLoginHref('/admin?run=3'), { pathname: '/login', query: { returnUrl: '/admin?run=3' } });
assert.deepEqual(adminLoginHref('//evil.example'), { pathname: '/login', query: { returnUrl: '/admin' } });
// P1-34（admin 部分）、P2-144：用共用的登入狀態訂閱（含其他分頁的 storage 事件）；分頁寫進網址
const adminSource = readFileSync(join(__dirname, '../../pages/admin.tsx'), 'utf8');
assert.match(adminSource, /subscribeAuthAccount\(onAuthChange\)/);
assert.doesNotMatch(adminSource, /addEventListener\(AUTH_CHANGE_EVENT, onAuthChange\)/);
assert.match(adminSource, /query: Record<string, unknown>|tab: next/);
assert.doesNotMatch(adminSource, /台北時間/);
console.log('Admin checks passed: paused manual runs, overlap guards, completed retries, unavailable actions, manual-only jobs, Taipei timestamps, and escaped errors.');

const backfillJob = { ...job, name: 'stock-backfill', schedule: 'Manual', paused: false };
const backfillMarkup = renderToStaticMarkup(<AdminJobs jobs={[backfillJob]} disabled={false} onAction={() => undefined} />);
assert.match(backfillMarkup, /label for="stock-backfill-symbol"/);
assert.match(backfillMarkup, /disabled=""[^>]*aria-label="立即執行個股市場資料回補"/);
assert.equal(adminRunScope({ job_name: 'stock-backfill', symbol: '2330' }), '股票 2330');
assert.equal(canRetryAdminRun({ ...run, job_name: 'stock-backfill', symbol: '2330' }, [backfillJob]), true);
