import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface LedgerProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  /** 標題列右側的燈質列：資料日、單位、來源等真實資訊 */
  stamp?: React.ReactNode;
  actions?: React.ReactNode;
  /** 面板的欄位切法；預設單欄。面板之間用 1px 線分隔，不留間距 */
  cols?: string;
  as?: 'h2' | 'h3';
  children: React.ReactNode;
}

/**
 * 帳頁標題列：襯線標題＋右側燈質列（資料日、單位、來源）與動作，下緣一條粗線。
 * Ledger 自己用它；標題下面不是面板格（例如清單、表單、文章側欄）時也直接用它。
 */
export function LedgerHeading({
  title,
  stamp,
  actions,
  as: Heading = 'h2',
  headingProps,
  className,
}: {
  title: React.ReactNode;
  stamp?: React.ReactNode;
  actions?: React.ReactNode;
  as?: 'h2' | 'h3';
  /** 給標題元素本身的屬性（id、ref、tabIndex） */
  headingProps?: React.ComponentPropsWithRef<'h2'>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border-strong pb-2', className)}>
      <Heading {...headingProps} className={cn('font-serif text-xl leading-snug font-black tracking-[0.06em]', headingProps?.className)}>
        {title}
      </Heading>
      {stamp || actions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {stamp ? <span className="characteristic">{stamp}</span> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 帳頁：全站的區塊語法。襯線標題＋右側燈質列、一條粗線、底下是用細線分隔的面板。
 * 取代原本的 bento 卡片格。
 */
export function Ledger({ title, stamp, actions, cols, as = 'h2', className, children, ...rest }: LedgerProps) {
  return (
    <section className={cn('min-w-0', className)} {...rest}>
      <LedgerHeading title={title} stamp={stamp} actions={actions} as={as} />
      <div className={cn('grid gap-px border-x border-b bg-border', cols ?? 'grid-cols-1')}>{children}</div>
    </section>
  );
}

interface LedgerPanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  /** 標題右側：單位或資料日 */
  unit?: React.ReactNode;
  padded?: boolean;
  /** 單獨放、不在 Ledger 格線裡的面板：自己畫 1px 外框 */
  framed?: boolean;
  /** 需要 aria-label 的獨立面板用 section */
  as?: 'div' | 'section';
}

/** 面板的底與內距；單獨放的面板（例如 <form>、<p>）不能用 LedgerPanel 時，加 border 直接套這組 class */
export const panelClass = 'min-w-0 bg-card p-4 sm:p-5';

/** 面板裡的主讀數（金額、比例）：等寬數字，隨視窗寬度在 24–32px 間縮放 */
export const figureClass = 'font-mono text-[clamp(24px,2.4vw,32px)] leading-tight font-semibold tabular-nums';

/** 帳頁表格（放在 padded={false} 的面板裡）：表頭淺底加粗線，列高至少 44px；第一欄左內距和面板對齊 */
export const cellClass = 'px-4 py-3 align-top first:pl-4 sm:first:pl-5';
export const headCellClass = 'h-11 px-4 align-middle text-[12px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground first:pl-4 sm:first:pl-5';

/** 帳頁裡的一格面板。固定順序：標題與單位 → 讀數 → 圖或刻度 → 日期戳記 */
export function LedgerPanel({ title, unit, padded = true, framed = false, as: Element = 'div', className, children, ...rest }: LedgerPanelProps) {
  return (
    <Element data-stagger className={cn('min-w-0 bg-card', padded && 'p-4 sm:p-5', framed && 'border', className)} {...rest}>
      {title || unit ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title ? <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{title}</h3> : <span />}
          {unit ? <span className="characteristic shrink-0">{unit}</span> : null}
        </div>
      ) : null}
      {children}
    </Element>
  );
}

/** 帳頁結尾的「下一步」列：一行字加一個真的連結 */
export function NextStep({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const className =
    'lamp-row group flex min-h-11 w-full items-center justify-between gap-3 bg-card px-4 py-2.5 text-left text-sm font-medium sm:px-5';
  const body = (
    <>
      <span className="min-w-0">{children}</span>
      <ArrowRight size={16} className="shrink-0 text-muted-foreground transition-transform duration-(--dur-flash) group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export type LightState = 'loading' | 'ready' | 'error';

/** 讀螢幕軟體與 title 念的是資料狀態本身，不用燈質代碼與航海術語（P2-061） */
export const LIGHT_STATE: Record<LightState, { label: string; className: string }> = {
  loading: { label: '載入中', className: 'light-glyph light-glyph-q' },
  ready: { label: '已載入', className: 'light-glyph light-glyph-f' },
  error: { label: '載入失敗', className: 'light-glyph light-glyph-ecl' },
};

/**
 * 燈質記號：視覺上用燈塔表的燈質畫法標資料狀態。
 * Q（急閃）＝載入中、F（定光）＝已載入、熄燈＝載入失敗。只有 8px，放在戳記或面板標題旁。
 */
export function LightGlyph({ state, className }: { state: LightState; className?: string }) {
  const meta = LIGHT_STATE[state];
  return <span role="img" aria-label={meta.label} title={meta.label} className={cn(meta.className, className)} />;
}

/**
 * 資料日戳記：「收盤 2026-10-01」。「非即時」一頁說一次就好（頁首、首頁第一章、觀測台標題），
 * 需要時傳 nonRealtime；每個面板都重複會變成雜訊。
 */
export function DataStamp({
  date,
  label = '收盤',
  nonRealtime = false,
  state,
  className,
}: {
  date?: string | null;
  label?: string;
  nonRealtime?: boolean;
  /** 給了就在前面放燈質記號（Q／F／熄燈） */
  state?: LightState;
  className?: string;
}) {
  const text = date ? `${label} ${date}${nonRealtime ? ' · 非即時' : ''}` : nonRealtime ? '非即時收盤資料' : '資料日未載入';
  return (
    <span className={cn('characteristic inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      {state ? <LightGlyph state={state} /> : null}
      {text}
    </span>
  );
}
