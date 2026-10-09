import { useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Ledger } from '@/components/common/Ledger';
import { Disclosure } from '@/components/common/Disclosure';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Pagination } from '@/components/common/Pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { DetailDrawer } from '@/features/stock/DetailDrawer';
import {
  ADMIN_CHAT_OUTCOMES, ADMIN_CHAT_PAGE_SIZE, ADMIN_CHAT_REASON_LABELS, INITIAL_ADMIN_CHAT_FILTERS,
  adminChatOutcomeLabel, adminChatReasonLabel, adminChatIssueLabel,
  type AdminChatAttempt, type AdminChatDetail, type AdminChatFilters, type AdminChatList,
  type AdminChatOutcomeFilter, type AdminChatSource, type AdminChatTokens,
} from '@/lib/api/adminChat';
import { cn } from '@/lib/cn';
import { formatTaipei } from '@/lib/utils/date';
import { useAIConversationReview } from './useAIConversationReview';

const numberText = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-TW');
const durationText = (value: number | null | undefined) => value == null ? '未回報' : `${numberText(value)} ms`;
const dateText = (value: string) => formatTaipei(value, { hour12: false }, '時間未記錄');

function Outcome({ value }: { value: string }) {
  const tone = ['error', 'interrupted'].includes(value) ? 'text-danger'
    : value === 'fallback' ? 'text-warning' : ['passed', 'repaired'].includes(value) ? 'text-success' : 'text-subtle';
  return <span className={cn('text-xs font-medium', tone)}>{adminChatOutcomeLabel(value)}</span>;
}

function Reason({ value }: { value: string }) {
  return <span>{adminChatReasonLabel(value)} <code className="font-mono text-xs break-all">{value}</code></span>;
}

function SnapshotText({ label, text, truncated, originalChars, empty }: {
  label: string; text: string; truncated?: boolean; originalChars?: number; empty: string;
}) {
  return <div className="min-w-0 space-y-2">
    {truncated ? <p className="text-xs leading-5 text-warning">除錯紀錄已裁切：保留 {numberText(Array.from(text).length)}／原始 {numberText(originalChars)} 字元，這不是完整原文。</p> : null}
    {text ? <pre aria-label={label} tabIndex={0} className="max-h-96 overflow-auto border bg-muted p-3 font-sans text-[13px] leading-6 break-words whitespace-pre-wrap [overflow-wrap:anywhere] focus-lamp-inset">{text}</pre>
      : <p className="text-sm text-muted-foreground">{empty}</p>}
  </div>;
}

function TokenCounts({ tokens }: { tokens: AdminChatTokens }) {
  return <span className="font-mono tabular-nums">輸入 {numberText(tokens.input)} · 輸出 {numberText(tokens.output)} · 思考 {numberText(tokens.thinking)}</span>;
}

function AttemptReview({ attempt }: { attempt: AdminChatAttempt }) {
  const status = attempt.validation === 'passed' ? '通過檢核' : attempt.validation === 'rejected' ? '未通過檢核' : '未執行檢核';
  return <Disclosure open={attempt.validation !== 'passed'} className="min-w-0 border-b last:border-b-0"
    summary={<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="font-semibold">第 {attempt.number} 輪 · {attempt.stage === 'repair' ? '修復稿' : '初稿'}</span><span className={attempt.validation === 'rejected' ? 'text-warning' : 'text-subtle'}>{status}</span>{attempt.reason ? <code className="font-mono text-xs">{attempt.reason}</code> : null}</span>}>
    <div className="space-y-3 pb-4">
      {attempt.validation === 'rejected' ? <p className="text-xs leading-5 text-warning">此稿未通過完整檢核，僅供管理員除錯，不是提供給使用者的有效分析。</p> : null}
      {attempt.reason || attempt.issue || attempt.detail || attempt.hint || attempt.claim ? <dl className="grid min-w-0 gap-2 border-l-2 border-warning-border pl-3 text-[13px] leading-6">
        {attempt.reason ? <div><dt className="text-muted-foreground">檢核原因</dt><dd><Reason value={attempt.reason} /></dd></div> : null}
        {attempt.issue ? <div><dt className="text-muted-foreground">檢核細節</dt><dd>{adminChatIssueLabel(attempt.issue)} <code className="font-mono text-xs break-all">{attempt.issue}</code></dd></div> : null}
        {attempt.detail ? <div><dt className="text-muted-foreground">驗證訊息</dt><dd className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{attempt.detail}</dd></div> : null}
        {attempt.claim ? <div><dt className="text-muted-foreground">問題敘述</dt><dd className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{attempt.claim}</dd></div> : null}
        {attempt.hint ? <div><dt className="text-muted-foreground">給修復流程的提示</dt><dd className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{attempt.hint}</dd></div> : null}
      </dl> : null}
      {attempt.diagnostics_truncated ? <p className="text-xs leading-5 text-warning">檢核訊息已裁切，提示或問題敘述可能不完整。</p> : null}
      <div className="space-y-1 text-xs leading-5 text-subtle">
        <p>結束標記 <code className="font-mono break-all">{attempt.finish_reason ?? '未回報'}</code> · 模型截斷標記：{attempt.truncated ? '是' : '否'} · 耗時 <span className="font-mono tabular-nums">{durationText(attempt.duration_ms)}</span></p>
        <p>輸出上限 <span className="font-mono tabular-nums">{numberText(attempt.max_tokens)}</span> tokens · <TokenCounts tokens={attempt.tokens} /></p>
      </div>
      <SnapshotText label={`第 ${attempt.number} 輪${attempt.stage === 'repair' ? '修復稿' : '初稿'}原文`} text={attempt.text} truncated={attempt.text_truncated} originalChars={attempt.original_chars} empty="這一輪沒有取得可保存的回覆文字。" />
    </div>
  </Disclosure>;
}

function SourceReview({ source }: { source: AdminChatSource }) {
  const { content: _content, ...metadata } = source;
  return <Disclosure className="min-w-0 border-b last:border-b-0" summary={<span className="text-sm"><code className="mr-2 font-mono">{source.citation_id || '未編號'}</code>{source.title || '無標題來源'}</span>}>
    <div className="min-w-0 space-y-3 pb-4">
      <dl className="grid gap-2 text-xs leading-5 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">類別／來源</dt><dd className="break-words">{source.category || '未記錄'} · {source.source_name || source.source || '未記錄'}</dd></div>
        <div><dt className="text-muted-foreground">來源日期（原值）</dt><dd className="font-mono break-all">{source.pub_time || '未記錄'}</dd></div>
        <div><dt className="text-muted-foreground">股票代號</dt><dd className="font-mono break-all">{source.stock_ids?.join('、') || source.stock_id || '未指定'}</dd></div>
        {source.url ? <div className="sm:col-span-2"><dt className="text-muted-foreground">來源網址（原值）</dt><dd className="break-all">{source.url}</dd></div> : null}
      </dl>
      {source.snapshot_truncated ? <p className="text-xs leading-5 text-warning">這筆來源快照部分欄位已裁切，不能視為完整證據。</p> : null}
      <SnapshotText label={`來源 ${source.citation_id} 原文`} text={source.content} truncated={source.content_truncated} originalChars={source.original_chars} empty="這筆來源沒有可保存的內文。" />
      <Disclosure summary="來源欄位與歸屬資料" summaryProps={{ className: 'text-xs' }}>
        <pre tabIndex={0} aria-label={`來源 ${source.citation_id} 欄位`} className="max-h-64 overflow-auto border bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap [overflow-wrap:anywhere] focus-lamp-inset">{JSON.stringify(metadata, null, 2)}</pre>
      </Disclosure>
    </div>
  </Disclosure>;
}

/** Pure detail view keeps all captured strings escaped, including source metadata. */
export function AIConversationDetail({ record }: { record: AdminChatDetail }) {
  return <div className="min-w-0 space-y-6">
    <section aria-label="本輪結果" className="space-y-3 border-b pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Outcome value={record.outcome} /><span className="font-mono text-xs tabular-nums">{dateText(record.created_at)}</span></div>
      <p className="text-xs leading-5 break-all text-subtle">{record.user_email ?? (record.user_id == null ? '無帳號連結' : `使用者 #${record.user_id}`)} · 模型 {record.model || '未記錄'}</p>
      {record.reasons.length ? <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{record.reasons.map((reason) => <Reason key={reason} value={reason} />)}</p> : null}
      {record.outcome === 'fallback' ? <Notice tone="warning">本輪改用安全回覆，請先查看下方各輪的檢核原因。</Notice> : null}
      {record.outcome === 'direct' ? <p className="text-xs leading-5 text-muted-foreground">本輪直接回覆，未執行回答內容檢核。</p> : null}
      {record.recovery?.method === 'validated_partial' && record.recovery.validation === 'passed' ? <Notice>
        <p>{record.attempts.filter((attempt) => attempt.validation === 'rejected').length} 輪稿件未通過完整檢核；已從{record.recovery.draft_stage === 'repair' ? '修復稿' : '初稿'}省略未確認敘述及相依結論，保留內容經本機重新核對通過。</p>
        <ul className="mt-2 space-y-1 text-xs">{record.recovery.removed.map((entry, index) => <li key={index}>
          {entry.paragraph == null ? '' : `第 ${entry.paragraph + 1} 段 · `}{adminChatIssueLabel(entry.reason)}
          {' · '}{({ removed: '已移除', narrowed: '已收斂', retained: '已保留', withheld: '未發布', ineligible: '不適用' } as Record<string, string>)[entry.result] ?? entry.result}
          {entry.units == null ? '' : `（${entry.units} 個內容單位）`}
        </li>)}</ul>
      </Notice> : null}
      {record.error_type ? <p className="text-sm">流程錯誤類型：<code className="font-mono break-all">{record.error_type}</code></p> : null}
      <p className="text-xs leading-5 text-muted-foreground">{record.publication_completed ? 'AI 服務已交出完整結果。' : '尚未確認 AI 服務交出完整結果。'}對話是否保存、瀏覽器是否完整接收，仍需另行核對。</p>
    </section>

    <section aria-labelledby="ai-review-query" className="space-y-2">
      <h3 id="ai-review-query" className="text-sm font-semibold">使用者問題</h3>
      <SnapshotText label="使用者問題原文" text={record.query} truncated={record.query_truncated} originalChars={record.query_original_chars} empty="未保存問題文字。" />
    </section>

    <section aria-labelledby="ai-review-final" className="space-y-2">
      <h3 id="ai-review-final" className="text-sm font-semibold">最後回覆（伺服器紀錄）</h3>
      <SnapshotText label="最後回覆原文" text={record.final_answer} truncated={record.final_answer_truncated} originalChars={record.final_answer_original_chars} empty="本輪沒有保存最後回覆。" />
    </section>

    <section aria-labelledby="ai-review-attempts" className="min-w-0 border-t border-border-strong pt-3">
      <h3 id="ai-review-attempts" className="text-sm font-semibold">生成與修復紀錄 · {record.attempts.length} 輪</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">檢核結果反映程式判斷；原稿仍需對照本輪來源。未通過的稿件只供管理員檢查。</p>
      {record.attempts.length ? record.attempts.map((attempt) => <AttemptReview key={attempt.number} attempt={attempt} />)
        : <p className="py-3 text-sm text-muted-foreground">沒有模型原稿紀錄；可能在生成前結束，或本輪使用直接回覆。</p>}
    </section>

    <section aria-labelledby="ai-review-sources" className="min-w-0 border-t border-border-strong pt-3">
      <h3 id="ai-review-sources" className="text-sm font-semibold">本輪引用資料 · 保存 {record.sources.length} 筆</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">這裡保存生成當時的來源快照。引用編號存在，不代表來源一定支持整句主張。</p>
      {record.sources_truncated ? <p className="mt-2 text-xs leading-5 text-warning">來源快照已達保存上限，部分來源或欄位未完整保存。</p> : null}
      {record.sources.length ? record.sources.map((source, index) => <SourceReview key={`${source.citation_id}-${index}`} source={source} />)
        : <p className="py-3 text-sm text-muted-foreground">本輪沒有保存來源資料。</p>}
    </section>

    <Disclosure className="border-t border-border-strong" summary={<span className="text-sm font-semibold">耗時、Token 與關聯編號</span>}>
      <dl className="grid gap-3 pb-3 text-xs leading-6 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">總耗時</dt><dd className="font-mono tabular-nums">{durationText(record.duration_ms)}</dd></div>
        <div><dt className="text-muted-foreground">整輪時間上限</dt><dd className="font-mono tabular-nums">{numberText(record.request_timeout_seconds)} 秒</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">已回報 Token 合計（未回報為 —）</dt><dd><TokenCounts tokens={record.tokens} /></dd></div>
        <div><dt className="text-muted-foreground">修復輸出上限</dt><dd className="font-mono tabular-nums">{numberText(record.repair_max_tokens)} tokens</dd></div>
        <div><dt className="text-muted-foreground">是否需要帳戶約束</dt><dd>{record.requires_portfolio ? '需要' : '不需要'}</dd></div>
        <div><dt className="text-muted-foreground">回答詳細度</dt><dd>{({ plain: '白話', standard: '標準', technical: '技術' } as Record<string, string>)[record.answer_detail] ?? record.answer_detail}</dd></div>
        <div><dt className="text-muted-foreground">紀錄格式版本</dt><dd className="font-mono">{record.schema_version}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">檢核紀錄 ID</dt><dd className="font-mono break-all">{record.id}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">對話 ID</dt><dd className="font-mono break-all">{record.conversation_id ?? '無持久對話連結'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">本輪 ID</dt><dd className="font-mono break-all">{record.turn_id ?? '未記錄'}</dd></div>
      </dl>
    </Disclosure>
  </div>;
}

export function AIConversationList({ data, loading, error, selectedId, onSelect, onRetry, onShowAll }: {
  data: AdminChatList | null; loading: boolean; error: string | null; selectedId: string | null;
  onSelect: (id: string) => void; onRetry: () => void; onShowAll: () => void;
}) {
  if (loading) return <LoadingRows label="載入 AI 對話檢核紀錄中…" className="h-44" />;
  if (error) return <div className="p-4 sm:p-5"><Notice tone="danger" action={<Button variant="outline" onClick={onRetry}>重試讀取</Button>}>{error}</Notice></div>;
  if (!data) return <EmptyState>尚未載入檢核紀錄。</EmptyState>;
  if (!data.items.length) return <EmptyState action={<Button variant="outline" onClick={onShowAll}>查看近 14 天全部結果</Button>}>目前篩選下沒有檢核紀錄。紀錄自功能上線後開始保存；過去被擋下的原稿無法回補。查不到紀錄不代表檢核通過。</EmptyState>;
  return <ul aria-label="AI 對話檢核紀錄（台灣時間）" className="divide-y">
    {data.items.map((item) => <li key={item.id}>
      <button type="button" aria-label={`檢視對話：${item.query_preview || item.id}`} aria-haspopup="dialog" onClick={() => onSelect(item.id)} data-selected={selectedId === item.id}
        className="lamp-row grid w-full min-w-0 gap-2 px-4 py-4 text-left focus-lamp-inset sm:px-5 lg:grid-cols-[180px_minmax(0,1fr)_180px] lg:gap-5">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:block lg:space-y-2">
          <span className="block font-mono text-xs tabular-nums">{dateText(item.created_at)}</span><Outcome value={item.outcome} />
        </span>
        <span className="min-w-0 space-y-1">
          <span className="line-clamp-2 block text-sm font-medium break-words [overflow-wrap:anywhere]">{item.query_preview || '未保存問題摘要'}</span>
          <span className="block text-xs break-all text-muted-foreground">{item.user_email ?? (item.user_id == null ? '無帳號連結' : `使用者 #${item.user_id}`)} · {item.model || '模型未記錄'}</span>
          {item.reasons.length ? <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">{item.reasons.map((reason) => <Reason key={reason} value={reason} />)}</span> : null}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-subtle lg:block lg:text-right">
          <span className="block font-mono tabular-nums">{item.attempt_count} 輪生成 · {item.source_count} 筆來源</span>
          <span className="block font-mono tabular-nums">{durationText(item.duration_ms)}</span>
          {!item.publication_completed ? <span className="block text-warning">完整結果尚未確認</span> : null}
          <span className="block text-foreground underline decoration-input underline-offset-4">檢視詳情</span>
        </span>
      </button>
    </li>)}
  </ul>;
}

export function AIConversationDetailState({ record, loading, error, onRetry }: {
  record: AdminChatDetail | null; loading: boolean; error: string | null; onRetry: () => void;
}) {
  if (loading) return <LoadingRows label="載入本輪檢核詳情中…" className="h-44" />;
  if (error) return <Notice tone="danger" action={<Button variant="outline" onClick={onRetry}>重試詳情</Button>}>{error}</Notice>;
  return record ? <AIConversationDetail record={record} /> : <EmptyState>請從清單選擇一筆對話。</EmptyState>;
}

export function AIConversationReview({ onAccessError }: { onAccessError: (error: unknown) => boolean }) {
  const review = useAIConversationReview(onAccessError);
  const [draft, setDraft] = useState<AdminChatFilters>(INITIAL_ADMIN_CHAT_FILTERS);
  const showAll = () => {
    const next = { ...INITIAL_ADMIN_CHAT_FILTERS, outcome: '' as const };
    setDraft(next);
    review.applyFilters(next);
  };
  const offset = review.offset;
  const total = review.list?.total ?? 0;
  return <Ledger aria-labelledby="ai-conversation-heading" title={<span id="ai-conversation-heading">AI 對話檢核</span>}
    stamp={<span>台灣時間 · 保存 {review.list?.retention_days ?? 14} 天</span>}
    actions={<Button variant="outline" disabled={review.listLoading} aria-busy={review.listLoading || undefined} onClick={review.refresh}><RefreshCw aria-hidden />{review.listLoading ? '讀取中…' : '重新整理檢核'}</Button>}>
    <div className="min-w-0 bg-card">
      <div className="space-y-1 border-b px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        <p>目前回答直接輸出，不執行內容檢核。歷史原稿、修復稿與檢核原因仍可查閱；預設顯示歷史安全回覆、生成失敗及中斷。</p>
        <p>原稿僅限管理員查看；紀錄自功能上線後開始保存，過去未保存的原稿無法回補。</p>
        <p>查不到紀錄不代表檢核通過：部署前、程序強制終止或紀錄寫入失敗，都可能沒有紀錄。</p>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); review.applyFilters(draft); }} aria-label="篩選 AI 對話檢核紀錄" className="grid gap-3 border-b p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[140px_minmax(220px,1fr)_minmax(180px,1fr)]">
        <div><label htmlFor="ai-review-days" className="mb-1.5 block text-xs text-subtle">日期範圍</label><NativeSelect id="ai-review-days" value={draft.days} onChange={(event) => setDraft((value) => ({ ...value, days: Number(event.target.value) }))}>{[1, 3, 7, 14].map((days) => <option key={days} value={days}>近 {days} 天</option>)}</NativeSelect></div>
        <div><label htmlFor="ai-review-outcome" className="mb-1.5 block text-xs text-subtle">回覆結果</label><NativeSelect id="ai-review-outcome" value={draft.outcome} onChange={(event) => setDraft((value) => ({ ...value, outcome: event.target.value as AdminChatOutcomeFilter }))}>{ADMIN_CHAT_OUTCOMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect></div>
        <div><label htmlFor="ai-review-reason" className="mb-1.5 block text-xs text-subtle">檢核原因</label><NativeSelect id="ai-review-reason" value={draft.reason} onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))}><option value="">全部原因</option>{Object.entries(ADMIN_CHAT_REASON_LABELS).map(([code, label]) => <option key={code} value={code}>{label}（{code}）</option>)}</NativeSelect></div>
        <div className="sm:col-span-2"><label htmlFor="ai-review-search" className="mb-1.5 block text-xs text-subtle">問題、使用者或對話 ID</label><Input id="ai-review-search" value={draft.q} onChange={(event) => setDraft((value) => ({ ...value, q: event.target.value }))} maxLength={120} autoComplete="off" placeholder="輸入關鍵字或關聯編號" /></div>
        <div className="flex flex-wrap items-end gap-2"><Button type="submit" disabled={review.listLoading}><Search aria-hidden />套用篩選</Button><Button variant="outline" type="button" onClick={showAll} disabled={review.listLoading}>全部結果</Button></div>
      </form>
      <AIConversationList data={review.list} loading={review.listLoading} error={review.listError} selectedId={review.selectedId} onSelect={review.select} onRetry={review.refresh} onShowAll={showAll} />
      {review.list && !review.listError ? <Pagination label="AI 對話檢核分頁" className="border-t px-4 py-3 sm:px-5" page={Math.floor(offset / ADMIN_CHAT_PAGE_SIZE) + 1} totalPages={Math.max(1, Math.ceil(total / ADMIN_CHAT_PAGE_SIZE))} disabled={review.listLoading}
        summary={total ? `${offset + 1}–${Math.min(offset + ADMIN_CHAT_PAGE_SIZE, total)}，共 ${total} 筆` : '共 0 筆'} onPageChange={(page) => review.changePage((page - 1) * ADMIN_CHAT_PAGE_SIZE)} /> : null}
      <DetailDrawer open={review.selectedId !== null} onClose={review.closeDetail} title="本輪 AI 對話檢核" subtitle="管理員檢核資料 · 原稿不代表有效分析">
        <AIConversationDetailState record={review.detail} loading={review.detailLoading} error={review.detailError} onRetry={() => { if (review.selectedId) review.select(review.selectedId); }} />
      </DetailDrawer>
    </div>
  </Ledger>;
}
