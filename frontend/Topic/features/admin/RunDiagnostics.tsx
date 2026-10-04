import { Disclosure } from '@/components/common/Disclosure';
import type { AdminRun } from '@/lib/api/admin';
import { formatTaipei } from '@/lib/utils/date';

const CATEGORIES: Record<string, string> = {
  stage_nonzero: '子工作非零結束；根因待查', service_restart: '服務重新啟動前未完成',
  service_stop: '服務停止前未完成', completion_unknown: '未能記錄完成結果',
  execution_exception: '執行發生例外；詳細原因未知', unknown: '原因未知',
};

export function adminStageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    'market-fetch': '下載行情', 'market-import': '匯入行情', 'market-backfill': '補齊行情',
    'paper-reconcile': '處理模擬投資成交與回顧',
    'crawl-cnyes': '擷取鉅亨新聞', 'crawl-ltn': '擷取自由財經新聞',
    'migrate-news-impact-schema': '準備新聞分析資料', 'news-ingest': '建立新聞向量索引',
    'news-impact-batch': '新聞 AI 分析', 'news-impact-sync': '同步向量標記', 'cache-warmup': '產生個股摘要',
  };
  return stage ? labels[stage] ?? stage : '等待階段資訊';
}

export function AdminRunDiagnostics({ run }: { run: AdminRun }) {
  const data = run.diagnostics;
  const time = (value: string | null) => formatTaipei(value, { hour12: false }, '未知');
  // 帳頁語法：方角細線框，摘要列 44px，內容用細線分段；代號、結束碼與時間用等寬字
  return <Disclosure
    className="border bg-card text-xs"
    summaryProps={{ className: 'px-3 font-medium text-foreground hover:bg-accent' }}
    summary={<>安全診斷 · 執行紀錄 <span className="font-mono tabular-nums">#{run.id}</span>{run.exit_code != null ? <> · 結束碼 <span className="font-mono tabular-nums">{run.exit_code}</span></> : ''}</>}
  >
    <div className="divide-y border-t leading-5 [&>*]:px-3 [&>*]:py-2">
      {data?.error_category ? <p className="font-medium">{CATEGORIES[data.error_category] ?? '原因未知'}</p> : null}
      <p>目前階段：{adminStageLabel(data?.stage)} · 最後階段活動：<span className="font-mono tabular-nums">{time(data?.last_activity_at ?? null)}</span></p>
      <p className="text-subtle">階段開始代表已啟動子工作；子工作處理進度未知。排程器存活回報不代表資料處理有進展。</p>
      {data?.failed_stages?.length ? <ul className="space-y-0.5 font-mono">{data.failed_stages.map((stage, index) => <li key={`${stage.stage}-${index}`}>{stage.stage} · 結束碼 {stage.exit_code}</li>)}</ul> : null}
      {run.error ? <p className="border-l-2 border-l-danger-border font-mono break-words text-danger">{run.error}</p> : null}
      <p className="text-muted-foreground">受控服務日誌關聯：<code className="font-mono">admin_run={run.id}</code>。舊紀錄可能沒有此關聯；沒有階段證據時保持未知。</p>
    </div>
  </Disclosure>;
}
