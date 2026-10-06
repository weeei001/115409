import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { EChart } from '@/components/charts/EChart';
import { DataStamp, Ledger, LedgerPanel, LightGlyph, NextStep } from '@/components/common/Ledger';
import { signedText } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Sparkline } from '@/components/common/Sparkline';
import { Button } from '@/components/ui/button';
import { toggleVariants } from '@/components/ui/toggle';
import { HomeNews } from '@/features/home/HomeNews';
import { chipsVolumeOption } from '@/lib/charts/adapters';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { useTheme } from '@/lib/theme/ThemeContext';
import { signedShares } from '@/features/stock/signedShares';
import { fmtAmount, fmtNum, fmtPrice, fmtVolume, lotToneValue } from '@/lib/utils/format';
import { SignalTag } from '@/components/common/SignalTag';
import { getValueTone, toneText, valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';
import { RangeRuler } from './RangeRuler';
import { TerminalKline } from './TerminalKline';
import { CHART_RANGES, type Loadable, type TerminalData } from './useTerminalData';
import { NO_STOCKS_TEXT, Watchlist } from './Watchlist';
import { terminalIndicatorRows } from './terminalIndicators';

const numeral = 'font-mono tabular-nums';


/** 面板共用的載入（燈質 Q）、錯誤（熄燈）、空資料（燈質 F）三種狀態 */
function PanelBody<T>({
  state,
  height,
  loadingText,
  emptyText,
  idleText = '選定股票後才會顯示',
  isEmpty,
  children,
}: {
  state: Loadable<T>;
  height: string;
  loadingText: string;
  emptyText: string;
  idleText?: string;
  isEmpty?: (data: NonNullable<T>) => boolean;
  children: (data: NonNullable<T>) => React.ReactNode;
}) {
  if (state.status === 'error') {
    return (
      <Notice
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={state.reload}>
            <RefreshCw aria-hidden />
            重試
          </Button>
        }
      >
        {state.error}
      </Notice>
    );
  }
  if (state.data == null) {
    if (state.status === 'ready') return <EmptyState className="py-6">{emptyText}</EmptyState>;
    // 還沒有選中的股票（清單沒載入或是空的）：不要一直閃，直接說明在等什麼
    if (state.status === 'idle') return <EmptyState className="py-6">{idleText}</EmptyState>;
    return <LoadingRows label={loadingText} className={height} />;
  }
  if (isEmpty?.(state.data)) return <EmptyState className="py-6">{emptyText}</EmptyState>;
  return <>{children(state.data)}</>;
}

/** 捲動清單下方還沒露出來的列數（lg 以上的觀測清單用，取代漸層淡出）；不能捲動時是 0 */
function useRowsBelow(ref: React.RefObject<HTMLDivElement | null>, key: unknown): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.scrollHeight <= el.clientHeight + 1) return setCount(0);
      const bottom = el.getBoundingClientRect().bottom;
      let n = 0;
      el.querySelectorAll('ul > li').forEach((row) => {
        if (row.getBoundingClientRect().top >= bottom - 1) n += 1;
      });
      setCount(n);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, key]);
  return count;
}

/** 以 0 為中線、往左右長的橫條；依數值正負上色（買超紅、賣超綠） */
function FlowRow({ label, value, max, strong }: { label: string; value: number | null; max: number; strong?: boolean }) {
  const width = value != null && max > 0 ? `${(Math.abs(value) / max) * 50}%` : '0%';
  // 不滿 1 張不上漲跌色（P1-21）
  const tone = getValueTone(lotToneValue(value));
  return (
    <div className={cn('grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 border-b last:border-b-0', strong && 'font-medium')}>
      <span className={cn('text-sm', strong ? 'text-foreground' : 'text-subtle')}>{label}</span>
      <span className="relative h-2.5" aria-hidden>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-input" />
        <span
          className={cn('absolute inset-y-0', tone === 'up' ? 'left-1/2 bg-up' : tone === 'down' ? 'right-1/2 bg-down' : '')}
          style={{ width }}
        />
      </span>
      <span className={cn(numeral, 'text-right text-[13.5px]', toneText(tone))}>
        {signedShares(value)}
      </span>
    </div>
  );
}

/** toolbar：手機版放在標題下方的工具列（股票搜尋） */
export function ObservationTerminal({ id, data, toolbar }: { id: string; data: TerminalData; toolbar?: React.ReactNode }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const reduce = usePrefersReducedMotion();
  const quoteRef = useRef<HTMLDivElement>(null);
  const { boardState, watchState, watchDates, selected, selectedInfo, quote, priceChart, stats, institutional, technical, chips, range, setRange } = data;

  const watchListRef = useRef<HTMLDivElement>(null);
  const rowsBelow = useRowsBelow(watchListRef, `${watchState.status}:${data.stockInfos.length}`);
  const pick = useCallback(
    (symbol: string) => {
      data.select(symbol);
      // 手機版清單在報價下方：選了之後把報價捲回視窗
      if (window.matchMedia('(max-width: 1023px)').matches) {
        quoteRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      }
    },
    [data, reduce],
  );

  const board = boardState.data;
  /** 後端整個連不上：大盤與股票清單都失敗時只說一次，其他面板改成靜止的「等待」 */
  const allDown = boardState.status === 'error' && data.infos.status === 'error';
  const reloadAll = () => {
    boardState.reload();
    data.infos.reload();
  };
  /** 沒有任何股票可看（清單失敗或是空的）：整個格線換成一個狀態，不要每格各說一次 */
  const gridDown = !selected && (data.infos.status === 'error' || data.infos.status === 'ready');
  const idleText = data.infos.status === 'error' ? '股票清單載入失敗，這一格暫時沒有資料' : data.infos.status === 'ready' ? '目前沒有股票資料，這一格暫時沒有資料' : '等待股票清單';
  const q = quote.data && quote.data.symbol === selected ? quote.data : null;
  const prevClose = q?.close != null && q.change != null ? q.close - q.change : null;
  const changePercent = q?.change != null && prevClose ? (q.change / prevClose) * 100 : null;
  /** 區間標示以實際畫出的 K 線為準，不用請求的日期區間 */
  const candles = priceChart.data?.candles;
  const plotted = candles?.length ? { first: candles[0].time, last: candles[candles.length - 1].time, count: candles.length } : null;
  const chipsOption = useMemo(() => chipsVolumeOption(chips.data, isDark), [chips.data, isDark]);
  const flowMax = institutional.data
    ? Math.max(
        ...[institutional.data.foreign_net, institutional.data.investment_trust_net, institutional.data.dealer_net, institutional.data.total_institutional_net].map((v) =>
          Math.abs(v ?? 0),
        ),
      )
    : 0;

  /** 大盤：右欄第一格（對應觀測室右邊那台螢幕） */
  const boardBlock =
    boardState.status === 'error' ? (
      <Notice
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={boardState.reload}>
            <RefreshCw aria-hidden />
            重試
          </Button>
        }
      >
        {boardState.error}
      </Notice>
    ) : board ? (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn(numeral, 'text-2xl font-semibold tracking-tight')}>{fmtNum(board.close)}</span>
          <span className={cn(numeral, 'text-sm whitespace-nowrap', valueToneText(board.change))}>
            {signedText(board.change)}
            {board.changePercent != null ? `（${signedText(board.changePercent, 2, '%')}）` : ''}
          </span>
        </div>
        <Sparkline
          values={board.closes}
          trend={board.change == null || board.change === 0 ? 'flat' : board.change > 0 ? 'up' : 'down'}
          className="mt-3 h-10 w-full"
        />
      </div>
    ) : boardState.status === 'ready' ? (
      <EmptyState className="py-4">大盤資料暫缺</EmptyState>
    ) : (
      <LoadingRows label="載入大盤資料…" className="h-[88px]" />
    );

  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className="scroll-mt-14 bg-background outline-none focus-visible:shadow-none">
      <div className="mx-auto w-full max-w-[1320px] px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id={`${id}-title`} className="font-serif text-[clamp(28px,3.3vw,46px)] leading-[1.22] font-black tracking-[0.02em]">
            觀測台
          </h2>
          <p className="max-w-[34em] text-[13px] leading-relaxed text-muted-foreground">
            以下是最近一個交易日的收盤資料，不是即時報價；僅供學習與專題使用。
          </p>
        </div>

        {toolbar ? <div className="mt-4 md:hidden">{toolbar}</div> : null}

        {allDown ? (
          <Notice
            tone="danger"
            className="mt-6"
            action={
              <Button size="sm" variant="outline" onClick={reloadAll}>
                <RefreshCw aria-hidden />
                重試
              </Button>
            }
          >
            暫時無法取得行情資料，請稍後重試。
          </Notice>
        ) : null}

        {gridDown && !allDown ? <LedgerPanel framed className="mt-6">{boardBlock}</LedgerPanel> : null}

        {board && q?.date && board.date !== q.date ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            大盤（<span className="font-mono tabular-nums">{board.date}</span>）和個股（<span className="font-mono tabular-nums">{q.date}</span>）的收盤日不同：兩者分開更新，各自顯示最近一個收盤日。
          </p>
        ) : null}
        {watchDates.length > 1 ? (
          <Notice tone="info" className="mt-3">
            部分個股資料日期不同：最新 <span className="font-mono tabular-nums">{watchDates[watchDates.length - 1]}</span>，最舊 <span className="font-mono tabular-nums">{watchDates[0]}</span>。日期不同的列會另外標示。
          </Notice>
        ) : null}

        {gridDown ? (
          <div className="mt-6 border bg-card">
            <EmptyState
              className="py-20"
              action={
                allDown ? undefined : (
                  <Button variant="outline" size="sm" onClick={data.infos.reload}>
                    <RefreshCw aria-hidden />
                    {data.infos.status === 'error' ? '重試' : '重新整理'}
                  </Button>
                )
              }
            >
              {allDown
                ? '目前無法連線，行情暫時無法顯示；連線恢復後請按上方的「重試」。'
                : data.infos.status === 'error'
                  ? '股票清單載入失敗，行情暫時無法顯示。請按「重試」。'
                  : NO_STOCKS_TEXT}
            </EmptyState>
          </div>
        ) : null}
        <div className={cn('handoff-fade mt-6 grid gap-px border bg-border lg:grid-cols-[300px_minmax(0,1fr)_320px]', gridDown && 'hidden')}>
          {/* 觀測清單 */}
          <div id={`${id}-watchlist`} className="order-2 min-w-0 scroll-mt-16 bg-card lg:relative lg:order-none">
            <div className="flex flex-col lg:absolute lg:inset-0">
              <div className="flex items-baseline justify-between gap-3 border-b border-border-strong px-4 py-3 sm:px-5">
                <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">觀測清單</h3>
                <span className="characteristic inline-flex items-center gap-1.5">
                  <LightGlyph state={watchState.status === 'idle' ? 'loading' : watchState.status} />
                  {data.stockInfos.length ? `${data.stockInfos.length} 檔 · 依產業` : ''}
                </span>
              </div>
              {/* 第一次出現的自訂名詞，標題下說明它是什麼（P2-091、04-U5） */}
              <p id={`${id}-watchlist-note`} className="border-b px-4 py-2 text-xs leading-relaxed text-muted-foreground sm:px-5">
                本站收錄的全部股票，收藏的排最前面；點一檔切換報價與圖表，鍵盤可用上下鍵移動。
              </p>
              <div ref={watchListRef} className="min-h-0 flex-1 lg:snap-y lg:snap-proximity lg:overflow-y-auto">
                <Watchlist data={data} onSelect={pick} quiet={allDown} describedBy={`${id}-watchlist-note`} />
              </div>
              {/* 清單還有更多：寫出還有幾檔（不用漸層淡出） */}
              {rowsBelow ? (
                <p className="hidden border-t px-4 py-2 text-xs text-muted-foreground sm:px-5 lg:block">
                  還有 <span className="font-mono tabular-nums">{rowsBelow}</span> 檔，捲動清單查看
                </p>
              ) : null}
            </div>
          </div>

          {/* 報價與 K 線 */}
          <div ref={quoteRef} className="order-1 min-w-0 scroll-mt-16 bg-card p-4 sm:p-5 lg:order-none">
            {selected ? (
              <>
                <a
                  href={`#${id}-watchlist`}
                  className="lamp-row -mx-4 -mt-4 mb-4 flex min-h-11 items-center justify-between gap-3 border-b px-4 text-[13px] text-subtle sm:-mx-5 sm:-mt-5 sm:px-5 lg:hidden"
                >
                  <span>目前個股</span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    換股
                    <ArrowDown size={14} aria-hidden />
                  </span>
                </a>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-2xl leading-tight font-bold tracking-[0.02em]">{selectedInfo?.name ?? selected}</h3>
                    <p className="characteristic mt-1 flex flex-wrap gap-x-2">
                      {[selected, selectedInfo?.industry, q?.date ? `收盤 ${q.date}` : null].filter(Boolean).map((seg, i) => (
                        <span key={seg} className="whitespace-nowrap">
                          {i > 0 ? '· ' : ''}
                          {seg}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className={cn(numeral, 'text-[clamp(30px,3vw,40px)] leading-none font-semibold tracking-tight')}>{fmtPrice(q?.close)}</span>
                    <span className={cn(numeral, 'text-sm', valueToneText(q?.change))}>
                      {signedText(q?.change)}
                      {changePercent != null ? `（${signedText(changePercent, 2, '%')}）` : ''}
                    </span>
                  </div>
                </div>

                {quote.status === 'error' ? (
                  <Notice
                    tone="danger"
                    className="mt-3"
                    action={
                      <Button size="sm" variant="outline" onClick={quote.reload}>
                        <RefreshCw aria-hidden />
                        重試
                      </Button>
                    }
                  >
                    {quote.error}
                  </Notice>
                ) : (
                  <dl className="mt-4 grid grid-cols-2 gap-px border bg-border sm:grid-cols-3">
                    {[
                      ['開盤', fmtPrice(q?.open)],
                      ['最高', fmtPrice(q?.high)],
                      ['最低', fmtPrice(q?.low)],
                      ['成交量', fmtVolume(q?.volume_shares)],
                      ['成交金額', fmtAmount(q?.amount)],
                      ['成交筆數', fmtNum(q?.trades)],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-card px-3 py-2">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className={cn(numeral, 'mt-0.5 text-[13.5px] whitespace-nowrap')}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div role="group" aria-label="K 線區間" className="flex gap-1">
                    {CHART_RANGES.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        aria-pressed={range === r.key}
                        onClick={() => setRange(r.key)}
                        className={toggleVariants({ variant: 'square' })}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <Link href={`/stock/${selected}`}>開啟完整個股頁</Link>
                  </Button>
                </div>

                <div className="neatline mt-2">
                  <div className="h-[340px] sm:h-[420px]">
                    <PanelBody
                      state={priceChart}
                      height="h-full min-h-[320px]"
                      loadingText="載入 K 線中…"
                      emptyText="此區間沒有 K 線資料"
                      isEmpty={(d) => d.candles.length === 0}
                    >
                      {(d) => <TerminalKline data={d} title={`${selectedInfo?.name ?? selected} 日 K 線、MA5／20／60 與成交量`} />}
                    </PanelBody>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground">區間尺</h4>
                    <span className="characteristic">{plotted ? `${plotted.first} → ${plotted.last} · ${plotted.count} 個交易日` : ''}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">K 線區間的最低價到最高價；「均」是區間平均收盤，「收」是最近收盤。</p>
                  <PanelBody state={stats} height="h-[88px]" loadingText="載入區間統計中…" emptyText="這個區間沒有統計資料">
                    {(d) => <RangeRuler low={d.lowest_price} high={d.highest_price} average={d.average_close} close={q?.close ?? null} />}
                  </PanelBody>
                </div>
              </>
            ) : data.infos.status === 'ready' ? (
              <EmptyState
                className="py-16"
                action={
                  <Button variant="outline" size="sm" onClick={data.infos.reload}>
                    <RefreshCw aria-hidden />
                    重新整理
                  </Button>
                }
              >
                {NO_STOCKS_TEXT}
              </EmptyState>
            ) : data.infos.status === 'error' ? (
              <EmptyState className="py-16">股票清單載入失敗，報價與 K 線暫時無法顯示。重試成功後會自動顯示。</EmptyState>
            ) : (
              <LoadingRows label="載入報價與 K 線…" className="h-[528px]" />
            )}
          </div>

          {/* 法人、指標、量與籌碼 */}
          <div className="order-3 grid min-w-0 content-start gap-px bg-card lg:order-none [&>*]:border-b [&>*:last-child]:border-b-0">
            <LedgerPanel title="加權指數" unit={<DataStamp date={board?.date} state={boardState.status === 'idle' ? 'loading' : boardState.status} />}>
              {boardBlock}
            </LedgerPanel>
            {!selected ? (
              <div className="bg-card">
                <EmptyState className="h-full min-h-40 px-4">{idleText.replace('這一格', '法人、技術指標與收盤走勢')}</EmptyState>
              </div>
            ) : null}
            {selected ? (
              <>
            <LedgerPanel title="三大法人買賣超" unit={<DataStamp label="法人" date={institutional.data?.date} state={institutional.status === 'idle' ? 'loading' : institutional.status} />}>
              <PanelBody state={institutional} idleText={idleText} height="h-[176px]" loadingText="載入法人資料中…" emptyText="此區間沒有法人資料">
                {(d) => (
                  <div>
                    <FlowRow label="外資" value={d.foreign_net} max={flowMax} />
                    <FlowRow label="投信" value={d.investment_trust_net} max={flowMax} />
                    <FlowRow label="自營" value={d.dealer_net} max={flowMax} />
                    <FlowRow label="合計" value={d.total_institutional_net} max={flowMax} strong />
                  </div>
                )}
              </PanelBody>
            </LedgerPanel>

            <LedgerPanel title="技術指標" unit={<DataStamp label="指標" date={technical.data?.date} state={technical.status === 'idle' ? 'loading' : technical.status} />}>
              <PanelBody state={technical} idleText={idleText} height="h-[176px]" loadingText="載入技術指標中…" emptyText="資料不足以計算技術指標">
                {(d) => (
                  <dl>
                    {/* 名稱、參數與小數位和個股頁一致（P2-091、04-U7） */}
                    {terminalIndicatorRows(d).map((row) => (
                      <div key={row.label} className="flex min-h-11 items-center justify-between gap-3 border-b">
                        <dt className="text-sm text-subtle">{row.label}</dt>
                        <dd className="flex items-center gap-2">
                          <span className={cn(numeral, 'text-[13.5px]')}>{row.value}</span>
                          <SignalTag signal={row.signal} />
                        </dd>
                      </div>
                    ))}
                    <div className="py-2.5">
                      <dt className="text-sm text-subtle">布林通道（上軌／中軌／下軌）</dt>
                      <dd className={cn(numeral, 'mt-1 text-[13.5px] whitespace-nowrap')}>
                        {fmtPrice(d.boll_upper20)} / {fmtPrice(d.boll_mid20)} / {fmtPrice(d.boll_lower20)}
                      </dd>
                    </div>
                  </dl>
                )}
              </PanelBody>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">RSI ≥ 70 為超買、≤ 30 為超賣；標籤只描述指標狀態，不是買賣建議。</p>
            </LedgerPanel>

            <LedgerPanel title="收盤與法人合計" unit="近 30 個交易日">
              <PanelBody state={chips} idleText={idleText} height="h-[220px]" loadingText="載入量與籌碼資料中…" emptyText="此區間沒有量與籌碼資料" isEmpty={(d) => d.length === 0}>
                {() => (chipsOption ? <EChart title="收盤價與三大法人合計買賣超" option={chipsOption} height={220} /> : null)}
              </PanelBody>
            </LedgerPanel>
              </>
            ) : null}
          </div>
        </div>

        {allDown ? null : (
          <LedgerPanel framed className="mt-10 lg:mt-16">
            <HomeNews />
          </LedgerPanel>
        )}

        <Ledger title="觀測台以外" className="mt-10 lg:mt-16">
          <NextStep href="/ai">AI 對話：用一句話問個股、比較或技術指標</NextStep>
          <NextStep href="/compare">多股比較：把幾檔股票放在同一張圖上，看報酬、風險與相關性</NextStep>
          <NextStep href="/order">模擬投資：登入後用虛擬資金練習買賣，日後回顧當初的理由</NextStep>
        </Ledger>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-[46em] text-[13px] leading-relaxed text-muted-foreground">
            所有數字為最近一個交易日的收盤資料，非即時行情；僅供學習與專題用途，不構成投資建議。
          </p>
          <Button variant="ghost" size="sm" className="min-h-11 border border-transparent hover:border-border-strong" onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}>
            <ArrowUp aria-hidden />
            回到頂端
          </Button>
        </div>
      </div>
    </section>
  );
}
