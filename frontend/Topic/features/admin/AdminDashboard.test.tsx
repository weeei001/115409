import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { acceptedJobAudit, adminDuration, adminJobAlerts, adminLatestResult, adminRetryBlockedReason, adminRunScope, adminRunId, adminScheduleState, auditRunId, canRetryAdminRun, canStartAdminJob, filterAdminRuns } from '../../lib/api/admin';
import type { AdminAudit, AdminJob, AdminRun } from '../../lib/api/admin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminLoginHref, AdminAuditResult, AdminJobAlertSummary, AdminJobs, AdminRunHistory } from '../../pages/admin';
import { adminRunProblem, AdminRunDiagnostics } from './RunDiagnostics';
import { FeatureUsageLedger } from './AIEffectivenessPanel';
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
assert.doesNotMatch(pipelineMarkup, /每日 20:00|完整資料更新|job-pipeline/);
assert.equal((pipelineMarkup.match(/自動排程/g) ?? []).length, 0);
assert.equal(canStartAdminJob(pipeline), false);
assert.equal(canRetryAdminRun({ ...run, job_name: 'pipeline' }, [pipeline]), false);
assert.match(adminRetryBlockedReason({ ...run, job_name: 'pipeline' }, [pipeline], '完整更新')!, /已移除/);
assert.match(pipelineMarkup, /立即執行行情更新/);
assert.doesNotMatch(pipelineMarkup, /自由財經新聞/);
assert.equal(canStartAdminJob(source), false);
assert.equal(canRetryAdminRun({ ...run, job_name: 'ltn' }, [source]), false);
assert.doesNotMatch(pipelineMarkup, /恢復行情更新排程/);
assert.match(adminScheduleState(source, [pipeline, source]), /手動執行新聞擷取/);
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
assert.match(historyMarkup, /aria-expanded="false"[^>]*>查看原因/);
assert.doesNotMatch(historyMarkup, /安全診斷/);
// P2-142：手機版一筆一張，起訖時間寫在同一行
assert.match(historyMarkup, /<ul class="divide-y sm:hidden"/);
assert.match(historyMarkup, /2026\/9\/30 10:00:00 → 2026\/9\/30 10:00:05/);
const diagnosticMarkup = renderToStaticMarkup(<AdminRunDiagnostics run={{ ...run, diagnostics: {
  run_id: 7, error_category: 'stage_nonzero', failed_stages: [{ stage: 'news-impact-batch', exit_code: 1 }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown', worker_progress: 'unknown',
} }} />);
assert.match(diagnosticMarkup, /根因待查/);
assert.match(diagnosticMarkup, /技術紀錄/);
assert.match(diagnosticMarkup, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
assert.equal(renderedElements(diagnosticMarkup, 'script').length, 0);
assert.ok(renderedText(diagnosticMarkup).includes(run.error!));
assert.match(diagnosticMarkup, /原因未記錄/);
assert.doesNotMatch(diagnosticMarkup, /目前階段：等待/);
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
const crawlRun: AdminRun = { ...run, job_name: 'cnyes', error: null, diagnostics: {
  run_id: 7, error_category: 'stage_nonzero', failed_stages: [{ stage: 'crawl-cnyes', exit_code: 1,
    phase: 'http', reason: 'crawl_incomplete', failure_reasons: { crawl_timeout: 1 } }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown', worker_progress: 'unknown',
} };
const crawlMarkup = renderToStaticMarkup(<AdminRunDiagnostics run={crawlRun} />);
assert.equal(adminRunProblem(crawlRun)?.title, '新聞來源回應逾時');
assert.match(crawlMarkup, /已成功寫入的新聞會保留/);
assert.match(crawlMarkup, /新聞來源回應逾時 1 筆/);
assert.doesNotMatch(crawlMarkup, /模型|原因未記錄|根因待查/);
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
assert.equal(adminScheduleState({ ...future, name: 'rag', next_run_at: null }, [], now), '尚無下次排程資訊');
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
const brief = { ...job, name: 'text-brief', paused: false, schedule: 'Daily 22:30 Asia/Taipei' };
const briefMarkup = renderToStaticMarkup(<AdminJobs jobs={[brief]} disabled={false} onAction={() => undefined} />);
assert.match(briefMarkup, /label for="brief-symbol"/);
assert.match(briefMarkup, /select id="brief-symbol" required=""/);
// P2-145：無障礙名稱包含看得到的文字
assert.match(briefMarkup, /disabled=""[^>]*aria-label="立即執行個股摘要"/);
assert.match(briefMarkup, /每日 22:30（台灣時間） · 全部支援股票/);
assert.doesNotMatch(briefMarkup, /新聞索引完成後自動執行/);
assert.match(briefMarkup, /暫停個股摘要排程/);
assert.doesNotMatch(briefMarkup, /option[^>]*>全部股票/);
const automaticJobs: AdminJob[] = [
  { ...future, name: 'cnyes', schedule: 'Hourly :00 Asia/Taipei' },
  { ...future, name: 'rag', schedule: 'Hourly :10 Asia/Taipei' },
  { ...future, name: 'impact', schedule: 'Hourly :20 Asia/Taipei', paused: true },
  { ...brief, next_run_at: future.next_run_at },
];
const automaticMarkup = renderToStaticMarkup(<AdminJobs jobs={automaticJobs} disabled={false} schedulerStatus="running" checkedAt={now} onAction={() => undefined} />);
assert.match(automaticMarkup, /每小時整點（台灣時間）/);
assert.match(automaticMarkup, /每小時 10 分（台灣時間）/);
assert.match(automaticMarkup, /每小時 20 分（台灣時間）/);
assert.equal((automaticMarkup.match(/ · 下次 /g) ?? []).length, 3, 'Paused jobs must not advertise a stale next-run time.');
assert.match(automaticMarkup, /2026\/10\/1 21:30:00/);
for (const label of ['暫停鉅亨新聞排程', '暫停新聞索引排程', '恢復新聞影響分析排程', '暫停個股摘要排程']) {
  const control = renderedElements(automaticMarkup, 'button').find((button) => button.attribs['aria-label'] === label);
  assert.ok(control, `Missing independent schedule control: ${label}`);
  assert.equal(control.attribs.disabled, undefined, 'Schedule controls do not require selecting a stock.');
}
assert.doesNotMatch(automaticMarkup, /等待資料工作完成後安排|等待新聞索引完成後安排/);
const stoppedAutomaticMarkup = renderToStaticMarkup(<AdminJobs jobs={automaticJobs} disabled={true} schedulerStatus="stopped" onAction={() => undefined} />);
assert.doesNotMatch(stoppedAutomaticMarkup, / · 下次 /);
assert.match(stoppedAutomaticMarkup, /排程器未運作/);
assert.match(stoppedAutomaticMarkup, /disabled=""[^>]*aria-label="暫停鉅亨新聞排程"/);
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
assert.deepEqual(alerts, { failing: [{ name: 'rag', count: 43 }], paused: [] });
const alertMarkup = renderToStaticMarkup(<AdminJobAlertSummary jobs={[
  { ...job, name: 'rag', paused: false, schedule: 'Every 30 minutes', result_summary: { history_scope: 'all_stored_runs', terminal_runs: 50, last_success: null, last_failure: run, consecutive_failed: 43 } },
  { ...job, name: 'ltn', paused: true, schedule: 'Every 30 minutes' },
]} />);
assert.match(alertMarkup, /1 項工作：1 項工作有失敗紀錄/);
assert.match(alertMarkup, /href="\/admin#job-rag"[^>]*>新聞索引 · 43 次/);
assert.doesNotMatch(alertMarkup, /job-ltn|自由財經新聞/);
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

// 各功能的模型呼叫（ai_usage_logs）：依後端給的順序列出；沒有紀錄時是空狀態
const usageBase = {
  days: 30, briefs: 0, unavailable: 0, measured: 0, input_price_per_m: 0.2, output_price_per_m: 1.2,
};
const featureMarkup = renderToStaticMarkup(<FeatureUsageLedger usage={{ ...usageBase, features: [
  { feature: 'chat', requests: 2, calls: 4, failed_calls: 1, measured_requests: 1, avg_prompt_tokens: 10000, avg_completion_tokens: 1000, avg_cost_usd: 0.0032, total_cost_usd: 0.0032 },
  { feature: 'news_impact', requests: 1, calls: 1, failed_calls: 0, measured_requests: 1, avg_prompt_tokens: 3000, avg_completion_tokens: 500, avg_cost_usd: 0.0012, total_cost_usd: 0.0012 },
] }} />);
assert.deepEqual(renderedElements(featureMarkup, 'th').filter((cell) => cell.attribs.scope === 'row').map((cell) => renderedText(cell)), ['AI 對話與小燈', '新聞事件判讀']);
assert.match(featureMarkup, /4 次 · 失敗 1（每次請求 2\.0 次）/);
assert.match(featureMarkup, /US\$0\.0032/);
assert.match(featureMarkup, /AI 對話與小燈 2 次中有 1 次/);
assert.match(renderToStaticMarkup(<FeatureUsageLedger usage={usageBase} />), /近 30 天沒有模型呼叫紀錄/);
console.log('AI usage by feature passed: feature labels, calls per request, estimated cost, partial measurement note, empty state.');

// A newer interruption must not be replaced by an older failure.
const latestInterrupted = { ...run, id: 8, status: 'interrupted' };
const latestJob = { ...job, result_summary: { history_scope: 'all_stored_runs' as const,
  terminal_runs: 2, last_success: null, last_failure: run, last_run: latestInterrupted, consecutive_failed: 0 } };
assert.equal(adminLatestResult(latestJob)?.id, 8);
const latestMarkup = renderToStaticMarkup(<AdminJobs jobs={[latestJob]} disabled={false} onAction={() => undefined} />);
assert.match(latestMarkup, /最近執行：.*已中斷/);
assert.match(adminRunProblem(latestInterrupted)!.title, /服務停止/);
const validationRun = { ...run, job_name: 'rag', diagnostics: { run_id: 7, error_category: 'stage_nonzero',
  failed_stages: [{ stage: 'news-impact-batch', exit_code: 1, reason: 'article_failures', failure_reasons: { validation_failed: 3 } }],
  stage: null, stage_started_at: null, last_activity_at: null, activity_kind: 'unknown' as const, worker_progress: 'unknown' as const } };
assert.match(adminRunProblem(validationRun)!.title, /舊版索引的 AI 分析：模型回覆未通過驗證/);
assert.doesNotMatch(adminRunProblem(validationRun)!.title, /索引失敗/);
assert.match(adminRunProblem(validationRun)!.next, /補跑新聞影響分析/);
assert.equal(adminRunProblem({ ...run, status: 'succeeded' }), null);
assert.match(adminRunProblem({ ...run, job_name: 'ltn' })!.title, /來源已停用/);
assert.match(adminRunProblem(run)!.title, /原因未記錄/);
console.log('Admin diagnosis checks passed: retired source, latest interruption, failed stage and unknown cause.');

const retiredAlerts = renderToStaticMarkup(<AdminJobAlertSummary jobs={[{ ...pipeline, result_summary: {
  history_scope: 'all_stored_runs', terminal_runs: 4, last_success: null, last_failure: run, consecutive_failed: 4,
} }]} />);
assert.doesNotMatch(retiredAlerts, /job-pipeline|完整更新/);
const legacySourceMarkup = renderToStaticMarkup(<AdminJobs jobs={[{ ...source, name: 'cnyes' }]} disabled={false} onAction={() => undefined} />);
assert.match(legacySourceMarkup, /立即執行鉅亨新聞/);
assert.doesNotMatch(legacySourceMarkup, /完整流水線|啟用來源|停用來源/);

for (const [reason, expected] of [
  ['indexing_configuration', '索引設定或向量集合不相容'],
  ['indexing_content', '新聞內容或日期無法建立索引'],
  ['indexing_storage', '索引資料庫寫入失敗'],
  ['indexing_service', '向量或嵌入服務無法完成請求'],
  ['indexing_incomplete', '向量寫入未確認完成'],
]) {
  const indexedRun = { ...validationRun, diagnostics: { ...validationRun.diagnostics,
    failed_stages: [{ stage: 'news-ingest', exit_code: 1, reason }] } };
  assert.equal(adminRunProblem(indexedRun)!.title, expected);
  assert.match(adminRunProblem(indexedRun)!.next, /索引/);
  assert.doesNotMatch(adminRunProblem(indexedRun)!.title, /舊版|AI 分析/);
}
console.log('Index failures distinguish configuration, content, storage, service and incomplete writes.');
