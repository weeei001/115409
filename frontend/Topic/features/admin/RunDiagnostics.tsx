import type { AdminRun } from '@/lib/api/admin';

const CATEGORIES: Record<string, string> = {
  stage_nonzero: '子工作非零結束；根因待查', service_restart: '服務重新啟動前未完成',
  service_stop: '服務停止前未完成', completion_unknown: '未能記錄完成結果',
  execution_exception: '執行發生例外；詳細原因未知', unknown: '原因未知',
};

export function adminStageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    'market-fetch': '下載行情', 'market-import': '匯入行情', 'market-backfill': '補齊行情',
    'crawl-cnyes': '擷取鉅亨新聞', 'crawl-ltn': '擷取自由財經新聞',
    'migrate-news-impact-schema': '準備新聞分析資料', 'news-ingest': '建立新聞向量索引',
    'news-impact-batch': '新聞 AI 分析', 'news-impact-sync': '同步向量標記', 'cache-warmup': '產生個股摘要',
  };
  return stage ? labels[stage] ?? stage : '等待階段資訊';
}

export function AdminRunDiagnostics({ run }: { run: AdminRun }) {
  const data = run.diagnostics;
  const time = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }).replace(/\s+/g, ' ') : '未知';
  return <details className="rounded-lg border px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">安全診斷 · 執行紀錄 #{run.id}{run.exit_code != null ? ` · 結束碼 ${run.exit_code}` : ''}</summary>
    <div className="mt-2 space-y-2 leading-5">
      {data?.error_category ? <p>{CATEGORIES[data.error_category] ?? '原因未知'}</p> : null}
      <p>目前階段：{adminStageLabel(data?.stage)} · 最後階段活動：{time(data?.last_activity_at ?? null)}</p>
      <p>階段開始代表已啟動子工作；子工作處理進度未知。排程器存活回報不代表資料處理有進展。</p>
      {data?.failed_stages?.length ? <ul>{data.failed_stages.map((stage, index) => <li key={`${stage.stage}-${index}`}>{stage.stage} · 結束碼 {stage.exit_code}</li>)}</ul> : null}
      {run.error ? <p className="break-words text-danger">{run.error}</p> : null}
      <p className="text-muted-foreground">受控服務日誌關聯：<code>admin_run={run.id}</code>。舊紀錄可能沒有此關聯；沒有階段證據時保持未知。</p>
    </div>
  </details>;
}
