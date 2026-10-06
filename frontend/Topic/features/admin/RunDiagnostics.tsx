import { Disclosure } from '@/components/common/Disclosure';
import type { AdminRun } from '@/lib/api/admin';
import { formatTaipei } from '@/lib/utils/date';

const CATEGORIES: Record<string, string> = {
  stage_nonzero: '子工作非零結束；根因待查', service_restart: '服務重新啟動前未完成',
  service_stop: '服務停止前未完成', completion_unknown: '未能記錄完成結果',
  execution_exception: '執行發生例外；詳細原因未知', unknown: '原因未知',
};

const PHASES: Record<string, string> = {
  arguments: '命令參數', dispatch: '啟動工作', settings: '載入設定', catalog: '載入公司名單',
  lock: '取得工作鎖', database: '連接資料庫', schema: '準備資料表', http: '建立服務連線', analysis: '事件分析',
};
const REASONS: Record<string, string> = {
  worker_exception: '執行例外', invalid_arguments: '命令參數無效', catalog_unavailable: '公司名單不可用',
  article_failures: '部分文章分析失敗', budget_exhausted: '已達本次分析預算上限',
  consecutive_failures: '連續分析失敗，已停止本次工作', timeout: '模型回應逾時',
  auth_error_401: '模型服務驗證失敗', model_not_found: '模型不存在或不可用',
  rate_limit_429: '模型服務流量受限', client_uninitialized: '模型服務尚未設定',
  upstream_model_error: '模型服務回報錯誤', truncated_output: '模型回覆遭截斷', validation_failed: '模型回覆未通過驗證',
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

export function AdminRunDiagnostics({ run }: { run: AdminRun }) {
  const data = run.diagnostics;
  const hasReason = data?.failed_stages?.some((stage) => stage.reason);
  const time = (value: string | null) => formatTaipei(value, { hour12: false }, '未知');
  // 帳頁語法：方角細線框，摘要列 44px，內容用細線分段；代號、結束碼與時間用等寬字
  return <Disclosure
    className="border bg-card text-xs"
    summaryProps={{ className: 'px-3 font-medium text-foreground hover:bg-accent' }}
    // 內容是階段與結束碼，不是資安檢查：叫「執行診斷」（P2-148、05）
    summary={<>執行診斷 · <span className="font-mono tabular-nums">#{run.id}</span>{run.exit_code != null ? <> · 結束碼 <span className="font-mono tabular-nums">{run.exit_code}</span></> : ''}</>}
  >
    <div className="divide-y border-t leading-5 [&>*]:px-3 [&>*]:py-2">
      {data?.error_category ? <p className="font-medium">{hasReason ? '子工作回報失敗原因' : CATEGORIES[data.error_category] ?? '原因未知'}</p> : null}
      <p>目前階段：{adminStageLabel(data?.stage)} · 最後階段活動：<span className="font-mono tabular-nums">{time(data?.last_activity_at ?? null)}</span></p>
      <p className="text-subtle">階段開始代表已啟動子工作；子工作處理進度未知。排程器存活回報不代表資料處理有進展。</p>
      {data?.failed_stages?.length ? <ul className="space-y-0.5">{data.failed_stages.map((stage, index) => <li key={`${stage.stage}-${index}`}>
        <p className="font-mono">{stage.stage} · 結束碼 {stage.exit_code}</p>
        {stage.phase ? <p>失敗階段：{PHASES[stage.phase] ?? '未知'}{stage.error_type ? <> · <span className="font-mono">{stage.error_type}</span></> : null}</p> : null}
        {stage.reason ? <p>原因：{REASONS[stage.reason] ?? '未知'}</p> : null}
        {stage.failure_reasons ? <p>文章失敗：{Object.entries(stage.failure_reasons).map(([reason, count]) => `${REASONS[reason] ?? '未知'} ${count} 篇`).join('、')}</p> : null}
      </li>)}</ul> : null}
      {run.error ? <p className="border-l-2 border-l-danger-border font-mono break-words text-danger">{run.error}</p> : null}
      <p className="text-muted-foreground">受控服務日誌關聯：<code className="font-mono">admin_run={run.id}</code>。舊紀錄可能沒有此關聯；沒有階段證據時保持未知。</p>
    </div>
  </Disclosure>;
}
