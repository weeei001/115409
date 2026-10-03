import React from 'react';
import Link from 'next/link';
import { Check, Eye, EyeOff, Loader2, type LucideIcon } from 'lucide-react';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * 登入、註冊、忘記密碼、重設密碼與個人中心「變更密碼」共用的表單元件。
 * 帳號頁以表單為主體（左），右側依頁面放不同的旁注：登入＝觀測室的窗、註冊＝桌前（首頁旅程的海報），
 * 忘記／重設密碼＝三個步驟。
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 文字連結：中性色加底線，不用燈色（燈色留給主要按鈕） */
export const authLinkClass =
  'font-medium text-foreground underline decoration-input underline-offset-4 transition-colors duration-(--dur-flash) hover:decoration-foreground';

/* ───────────── 版面：表單為主、圖版為輔 ───────────── */

/**
 * 帳號頁版面：表單是頁面的主體。lg 以上表單在左（7/12），右側（5/12）放一張有意義的旁注：
 * 登入是亮著燈的窗、註冊是守燈人的桌前（AuthPlate），忘記／重設密碼是流程的三個步驟（AuthSteps）。
 * 兩欄頂端對齊（items-start）。
 * 手機單欄：圖版整個不出現（圖與說明一起拿掉，不重複頁首的副標）；步驟表是流程本身，排在表單下面。
 */
export function AuthLedger({ form, aside, asideOnMobile = false }: { form: React.ReactNode; aside: React.ReactNode; asideOnMobile?: boolean }) {
  return (
    <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <AnimatedSection>
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-x-16">
          <div className="min-w-0 lg:col-span-7">{form}</div>
          <div className={cn('min-w-0 lg:col-span-5', asideOnMobile ? undefined : 'hidden lg:block')}>{aside}</div>
        </div>
      </AnimatedSection>
    </main>
  );
}

/**
 * 表單帳頁（同 Ledger 的語法）：襯線 h2、一條粗線，底下是有框的表單面板；
 * footer 放「或用 Google 帳號」列與次要連結列，列與列之間用 1px 線分隔。
 */
export function AuthPanel({ id, title, children, footer }: { id: string; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section data-stagger aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="border-b border-border-strong pb-2 font-serif text-xl leading-snug font-black tracking-[0.06em]">
        {title}
      </h2>
      <div className="border-x border-b bg-card">
        <div className="px-4 pt-2 pb-6 sm:px-6 sm:pb-7">{children}</div>
        {footer ? <div className="grid gap-px border-t bg-border">{footer}</div> : null}
      </div>
    </section>
  );
}

/** 首頁旅程的海報：3＝亮著燈的觀測室窗口，4＝守燈人的桌前（public/beacon，夜班／晨班各一張） */
export type AuthPoster = 3 | 4;

/** 圖框比例：依左欄表單的高度挑，讓兩欄底部大致齊平 */
const PLATE_RATIO = {
  wide: 'aspect-video',
  pano: 'aspect-[2/1]',
  photo: 'aspect-[3/2]',
  square: 'aspect-square',
} as const;

/**
 * 帳號頁的圖版（同首頁海報圖版的語法）：有粗線的站名列、固定比例且有 1px 粗線外框的圖、圖下一行說明。
 * 只在 lg 以上出現（AuthLedger 在手機把整欄拿掉）：圖與說明是一組，不會只剩說明。
 * - 圖依主題用 dark: 選（主題 class 在首次繪製前就寫在 <html>，不會閃）；隱藏的那張與手機版都不會下載（loading="lazy" + display:none）。
 * - 圖框是 aspect-ratio 盒子，圖本身也帶 width／height，載入前後版面不位移。
 */
export function AuthPlate({
  poster,
  caption,
  ratio = 'wide',
  children,
}: {
  poster: AuthPoster;
  /** 站名：圖裡是首頁旅程的哪一處 */
  caption: string;
  ratio?: keyof typeof PLATE_RATIO;
  /** 圖下的一行說明：一句頁首副標沒有說的事實 */
  children: React.ReactNode;
}) {
  return (
    <figure data-stagger className="m-0 min-w-0">
      {/* 行高 28px：粗線與左欄表單標題的粗線對齊 */}
      <p className="border-b border-border-strong pb-2 text-[13px] leading-7 font-medium tracking-[0.04em] text-muted-foreground">{caption}</p>
      <div className={cn('relative mt-4 overflow-hidden border border-border-strong bg-secondary', PLATE_RATIO[ratio])}>
        <picture className="hidden dark:inline">
          <PlateImage poster={poster} theme="night" />
        </picture>
        <picture className="inline dark:hidden">
          <PlateImage poster={poster} theme="dawn" />
        </picture>
      </div>
      <figcaption className="mt-3 text-[13px] leading-relaxed text-subtle">{children}</figcaption>
    </figure>
  );
}

/** 忘記／重設密碼共用的三個步驟（第三步的字數規則與後端一致：8～128 個字元） */
const RESET_STEPS = [
  { order: '第一步', title: '申請重設連結', where: '忘記密碼頁' },
  { order: '第二步', title: '開啟信中的連結', where: '你的信箱' },
  { order: '第三步', title: '設定新密碼', where: '重設密碼頁 · 8～128 個字元' },
] as const;

/**
 * 重設密碼的流程表：一張有線的三列步驟表，目前這一步左側是燈色標線（同選取列）並標「目前」，
 * 做完的步驟標「完成」。這兩頁講的是流程，所以不放圖。
 * @param current 目前在第幾步（1～3）；`done` 時三步都完成
 */
export function AuthSteps({ current, done = false }: { current: 1 | 2 | 3; done?: boolean }) {
  return (
    <section data-stagger aria-labelledby="auth-steps-heading" className="min-w-0">
      {/* 行高 28px：粗線與左欄表單標題的粗線對齊 */}
      <h2 id="auth-steps-heading" className="border-b border-border-strong pb-2 text-[13px] leading-7 font-medium tracking-[0.04em] text-muted-foreground">
        重設密碼的三個步驟
      </h2>
      <ol className="border-x border-b bg-card">
        {RESET_STEPS.map((step, i) => {
          const n = i + 1;
          const isCurrent = !done && n === current;
          const isDone = done || n < current;
          return (
            <li
              key={step.order}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'relative grid min-h-14 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b px-4 py-3 last:border-b-0 sm:px-5',
                isCurrent && 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand',
              )}
            >
              <span className="characteristic">{step.order}</span>
              <span className="min-w-0">
                <span className={cn('block text-sm', isCurrent ? 'font-semibold text-foreground' : isDone ? 'text-subtle' : 'text-foreground')}>{step.title}</span>
                <span className="characteristic mt-0.5 block">{step.where}</span>
              </span>
              <span className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {isDone ? <Check size={14} aria-hidden /> : null}
                {isCurrent ? '目前' : isDone ? '完成' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PlateImage({ poster, theme }: { poster: AuthPoster; theme: 'night' | 'dawn' }) {
  return (
    <img
      src={`/beacon/poster-${theme}-${poster}.webp`}
      width={1600}
      height={900}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/**
 * 表單下方的次要連結列：一行灰字加一個有底線的文字連結（不是整列的 NextStep；
 * NextStep 只留給結果畫面頁尾那一個下一步）。
 */
export function AuthLinkRow({ href, lead, children }: { href: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 bg-card px-4 py-1 text-sm sm:px-6">
      {lead ? <span className="text-muted-foreground">{lead}</span> : null}
      <Link href={href} className={cn('inline-flex min-h-11 items-center', authLinkClass)}>
        {children}
      </Link>
    </p>
  );
}

/** 表單下方「或用 Google 帳號」列：一行說明加 Google 按鈕，不用置中的分隔線 */
export function AuthAltRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-[13px] font-medium tracking-[0.04em] text-subtle">或用 Google 帳號</p>
      {children}
    </div>
  );
}

/* ───────────── 表單元件 ───────────── */

export function FormError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <div id={id} className="mb-5">
      <Notice tone="danger">{message}</Notice>
    </div>
  );
}

/** 有線的欄位列容器：每列下緣 1px 線（帳號頁的登記簿樣式）；第一列的上緣就是面板標題的粗線 */
export function FieldRows({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

/** 方角輸入框：border-input（對比 ≥ 3:1），focus 用 focus-lamp */
const inputClass =
  'h-11 w-full rounded-sm border border-input bg-card text-base text-foreground outline-none transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus-lamp disabled:opacity-60 aria-invalid:border-danger sm:text-sm';
const labelClass = 'mb-1.5 block text-[13px] font-medium tracking-[0.04em] text-subtle';
/** 登記簿列：手機標籤在上，sm 以上標籤在左欄 */
const rowClass = 'grid gap-1.5 border-b py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-4 sm:gap-y-0';
const rowLabelClass = 'block text-[13px] font-medium tracking-[0.04em] text-subtle';

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: React.ReactNode;
  /** 輸入框內的圖示（個人中心用）；登記簿列不放圖示 */
  icon?: LucideIcon;
  /** true：排成登記簿的一列（放在 FieldRows 裡） */
  row?: boolean;
}

function FieldFrame({ id, label, row, children }: { id: string; label: React.ReactNode; row?: boolean; children: React.ReactNode }) {
  return (
    <div className={row ? rowClass : undefined}>
      <label htmlFor={id} className={row ? rowLabelClass : labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function AuthField({ id, label, icon: Icon, row, className, ...input }: FieldProps) {
  return (
    <FieldFrame id={id} label={label} row={row}>
      <div className="relative min-w-0">
        {Icon ? <Icon size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" /> : null}
        <input id={id} className={cn(inputClass, Icon ? 'pl-10' : 'pl-3', 'pr-4', className)} {...input} />
      </div>
    </FieldFrame>
  );
}

interface PasswordFieldProps extends Omit<FieldProps, 'type'> {
  shown: boolean;
  onToggle: () => void;
  /** 切換鈕的無障礙名稱：[顯示時, 隱藏時]（決議 c79） */
  toggleLabels: [string, string];
}

export function PasswordField({ id, label, icon: Icon, row, shown, onToggle, toggleLabels, ...input }: PasswordFieldProps) {
  return (
    <FieldFrame id={id} label={label} row={row}>
      <div className="relative min-w-0">
        {Icon ? <Icon size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" /> : null}
        <input id={id} type={shown ? 'text' : 'password'} className={cn(inputClass, Icon ? 'pl-10' : 'pl-3', 'pr-12')} {...input} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? toggleLabels[1] : toggleLabels[0]}
          className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-(--dur-flash) hover:bg-accent hover:text-foreground focus-lamp"
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    </FieldFrame>
  );
}

/** 登記簿表單的動作列：主要按鈕對齊輸入欄，右側可放次要連結 */
export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-6 sm:pl-[8.5rem]">{children}</div>;
}

/** 表單的主要按鈕：燈色、一個畫面只放一顆 */
export function SubmitButton({ loading, icon: Icon, className, children }: { loading: boolean; icon?: LucideIcon; className?: string; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={loading} aria-busy={loading} className={cn('w-full', className)}>
      {loading ? (
        <Loader2 size={18} className="animate-spin" aria-hidden />
      ) : (
        <>
          {Icon ? <Icon size={18} aria-hidden /> : null}
          {children}
        </>
      )}
    </Button>
  );
}
