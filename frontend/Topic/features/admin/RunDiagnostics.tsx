import { Disclosure } from '@/components/common/Disclosure';
import type { AdminRun } from '@/lib/api/admin';
import { formatTaipei } from '@/lib/utils/date';

const CATEGORIES: Record<string, string> = {
  stage_nonzero: '子工作非零結束；根因待查', service_restart: '服務重新啟動前未完成',
  service_stop: '服務停止前未完成', completion_unknown: '未能記錄完成結果',
  execution_exception: '執行發生例外；詳細原因未知', unknown: '原因未知',
  job_retired: '這項工作已移除',
};

const PHASES: Record<string, string> = {
  arguments: '命令參數', dispatch: '啟動工作', settings: '載入設定', catalog: '載入公司名單',
  lock: '取得工作鎖', database: '連接資料庫', schema: '準備資料表', http: '建立服務連線', analysis: '事件分析',
  chunking: '建立新聞段落', vectorization: '建立新聞向量',
};
const REASONS: Record<string, string> = {
  worker_exception: '執行例外', invalid_arguments: '命令參數無效', catalog_unavailable: '公司名單不可用',
  article_failures: '部分文章分析失敗', budget_exhausted: '已達本次分析預算上限',
  consecutive_failures: '連續分析失敗，已停止本次工作', timeout: '模型回應逾時',
  auth_error_401: '模型服務驗證失敗', model_not_found: '模型不存在或不可用',
  rate_limit_429: '模型服務流量受限', client_uninitialized: '模型服務尚未設定',
  upstream_model_error: '模型服務回報錯誤', truncated_output: '模型回覆遭截斷', validation_failed: '模型回覆未通過驗證',
  indexing_configuration: '索引設定或向量集合不相容', indexing_content: '新聞內容或日期無法建立索引',
  indexing_storage: '索引資料庫寫入失敗', indexing_service: '向量或嵌入服務無法完成請求',
  indexing_incomplete: '向量寫入未確認完成',
};

export function adminStageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    'market-fetch': '下載行情', 'market-import': '匯入行情', 'market-backfill': '補齊行情', 'stock-backfill': '回補個股市場資料',
    'paper-reconcile': '處理模擬投資成交與回顧',
    'crawl-cnyes': '擷取鉅亨新聞', 'crawl-ltn': '擷取自由財經新聞',
    'migrate-news-impact-schema': '準備新聞分析資料', 'news-ingest': '建立新聞向量索引',
    'news-impact-batch': '新聞 AI 分析', 'news-impact-sync': '同步向量標記', 'cache-warmup': '產生個股摘要',
  };
  return stage ? labels[stage] ?? stage : '等待階段資訊';
}

export function adminRunProblem(run: AdminRun): { title: string; next: string } | null {
  if (!['failed', 'interrupted', 'error'].includes(run.status)) return null;
  if (['pipeline', 'all'].includes(run.job_name)) return { title: '完整更新已移除', next: '此為歷史紀錄；請分別執行需要更新的工作。' };
  if (run.job_name === 'ltn') return { title: '此新聞來源已停用', next: '保留歷史紀錄，不再執行。' };
  const data = run.diagnostics;
  if (run.status === 'interrupted' || ['service_stop', 'service_restart'].includes(data?.error_category ?? '')) {
    return { title: '服務停止，本次工作未完成', next: '確認排程器恢復後，再補跑需要更新的工作。' };
  }
  const stages = data?.failed_stages ?? [];
  const failed = stages[0];
  const reasons = stages.flatMap((stage) => [stage.reason ?? '', ...Object.keys(stage.failure_reasons ?? {})]);
  const indexActions: Record<string, string> = {
    indexing_configuration: '確認索引版本、嵌入模型與向量集合設定相符，再執行新聞索引。',
    indexing_content: '確認原始新聞內容與日期，修正後再執行新聞索引。',
    indexing_storage: '確認資料庫連線與寫入權限，再執行新聞索引。',
    indexing_service: '確認嵌入服務與 Qdrant 連線恢復，再執行新聞索引。',
    indexing_incomplete: '確認 Qdrant 寫入狀態，再重試新聞索引。',
  };
  const indexReason = reasons.find((reason) => reason in indexActions);
  if (indexReason) return { title: REASONS[indexReason], next: indexActions[indexReason] };
  const invalid = stages.find((stage) => stage.reason === 'validation_failed' || (stage.failure_reasons?.validation_failed ?? 0) > 0);
  if (invalid) {
    return { title: `${run.job_name === 'rag' && invalid.stage === 'news-impact-batch' ? '舊版索引的 AI 分析' : adminStageLabel(invalid.stage)}：模型回覆未通過驗證`, next: invalid.stage === 'news-impact-batch' ? '先檢查模型輸出格式，再補跑新聞影響分析。' : '先檢查模型輸出格式，再補跑該項工作。' };
  }
  if (reasons.some((reason) => ['auth_error_401', 'model_not_found', 'client_uninitialized'].includes(reason))) {
    return { title: '模型服務設定有誤', next: '確認模型名稱與服務授權後再補跑。' };
  }
  if (reasons.some((reason) => ['timeout', 'rate_limit_429', 'upstream_model_error'].includes(reason))) {
    return { title: '模型服務暫時無法完成分析', next: '確認服務恢復後再補跑，避免連續重試。' };
  }
  if (failed?.reason) return { title: `${adminStageLabel(failed.stage)}：${REASONS[failed.reason] ?? '執行失敗'}`, next: '展開技術紀錄查看失敗階段，處理後再補跑。' };
  return { title: `${failed ? `${adminStageLabel(failed.stage)}：` : ''}執行失敗，原因未記錄`, next: `需查看執行紀錄 #${run.id} 對應的服務日誌，才能確認原因。` };
}

export function AdminRunDiagnostics({ run }: { run: AdminRun }) {
  const data = run.diagnostics;
  const hasReason = data?.failed_stages?.some((stage) => stage.reason);
  const problem = adminRunProblem(run);
  const time = (value: string | null) => formatTaipei(value, { hour12: false }, '未知');
  // 帳頁語法：方角細線框，摘要列 44px，內容用細線分段；代號、結束碼與時間用等寬字
  return <div className="space-y-3 text-sm">
    {problem ? <div className="space-y-1"><p className="font-medium">{problem.title}</p><p className="text-subtle">{problem.next}</p></div> : null}
    {data?.stage ? <p>{['running', 'queued'].includes(run.status) ? '目前階段' : '最後階段'}：{adminStageLabel(data.stage)}</p> : null}
    <Disclosure
    className="border bg-card text-sm"
    summaryProps={{ className: 'px-3 font-medium text-foreground hover:bg-accent' }}
    // 內容是階段與結束碼，不是資安檢查：叫「執行診斷」（P2-148、05）
    summary={<>技術紀錄 · <span className="font-mono tabular-nums">#{run.id}</span>{run.exit_code != null ? <> · 結束碼 <span className="font-mono tabular-nums">{run.exit_code}</span></> : ''}</>}
  >
    <div className="divide-y border-t leading-5 [&>*]:px-3 [&>*]:py-2">
      {data?.error_category ? <p className="font-medium">{hasReason ? '子工作回報失敗原因' : CATEGORIES[data.error_category] ?? '原因未知'}</p> : null}
      <p>最後活動：<span className="font-mono tabular-nums">{time(data?.last_activity_at ?? null)}</span>{run.status === 'running' ? ' · 子工作處理進度未知' : ''}</p>
      {data?.failed_stages?.length ? <ul className="space-y-0.5">{data.failed_stages.map((stage, index) => <li key={`${stage.stage}-${index}`}>
        <p className="font-mono">{stage.stage} · 結束碼 {stage.exit_code}</p>
        {stage.phase ? <p>失敗階段：{PHASES[stage.phase] ?? '未知'}{stage.error_type ? <> · <span className="font-mono">{stage.error_type}</span></> : null}</p> : null}
        {stage.reason ? <p>原因：{REASONS[stage.reason] ?? '未知'}</p> : null}
        {stage.failure_reasons ? <p>文章失敗：{Object.entries(stage.failure_reasons).map(([reason, count]) => `${REASONS[reason] ?? '未知'} ${count} 篇`).join('、')}</p> : null}
      </li>)}</ul> : null}
      {run.error ? <p className="border-l-2 border-l-danger-border font-mono break-words text-danger">{run.error}</p> : null}
      <p className="text-muted-foreground">服務日誌：<code className="font-mono">admin_run={run.id}</code></p>
    </div>
  </Disclosure></div>;
}
