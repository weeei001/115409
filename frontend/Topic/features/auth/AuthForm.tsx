import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, Loader2, type LucideIcon } from 'lucide-react';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Notice } from '@/components/common/Notice';
import { cn } from '@/lib/cn';

/** 登入、註冊、忘記密碼、重設密碼與個人中心「變更密碼」共用的表單元件 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 置中的卡片；登入與註冊用 glass（舊版如此），忘記／重設密碼用一般卡片 */
export function AuthCard({ glass = false, children }: { glass?: boolean; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <AnimatedSection className="w-full max-w-md">
        <div className={cn('rounded-2xl p-6 sm:p-8', glass ? 'glass shadow-raised' : 'border bg-card shadow-card')}>{children}</div>
      </AnimatedSection>
    </main>
  );
}

/** 卡片頂部：品牌色圖示、標題、說明 */
export function AuthIntro({ icon: Icon, title, subtitle, glow = false }: { icon: LucideIcon; title: string; subtitle: string; glow?: boolean }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <div className={cn('bg-brand-gradient mb-4 flex size-14 items-center justify-center rounded-2xl shadow-lg shadow-brand/20', glow && 'anim-glow-pulse')}>
        <Icon size={26} className="text-on-brand" aria-hidden />
      </div>
      <h2 className={cn('text-2xl font-bold', glow && 'text-brand-gradient')}>{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** 成功／結果畫面的圓角圖示 */
export function AuthStatusIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: 'success' | 'brand' }) {
  return (
    <div className={cn('mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl', tone === 'success' ? 'bg-success-muted' : 'bg-accent')}>
      <Icon size={tone === 'success' ? 30 : 26} className={tone === 'success' ? 'text-success' : 'text-brand-text'} aria-hidden />
    </div>
  );
}

export function FormError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <div id={id} className="mb-5">
      <Notice tone="danger">{message}</Notice>
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-xl border border-input bg-muted pl-10 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60 sm:text-sm';

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: React.ReactNode;
  icon: LucideIcon;
}

export function AuthField({ id, label, icon: Icon, className, ...input }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-subtle">
        {label}
      </label>
      <div className="relative">
        <Icon size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <input id={id} className={cn(inputClass, 'pr-4', className)} {...input} />
      </div>
    </div>
  );
}

interface PasswordFieldProps extends Omit<FieldProps, 'type'> {
  shown: boolean;
  onToggle: () => void;
  /** 切換鈕的無障礙名稱：[顯示時, 隱藏時] */
  toggleLabels: [string, string];
}

export function PasswordField({ id, label, icon: Icon, shown, onToggle, toggleLabels, ...input }: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-subtle">
        {label}
      </label>
      <div className="relative">
        <Icon size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <input id={id} type={shown ? 'text' : 'password'} className={cn(inputClass, 'pr-12')} {...input} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? toggleLabels[1] : toggleLabels[0]}
          className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-subtle"
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

const brandButton =
  'bg-brand-gradient flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold text-on-brand shadow-lg shadow-brand/20 transition-[opacity,box-shadow] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60';

export function SubmitButton({ loading, icon: Icon, children }: { loading: boolean; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading} aria-busy={loading} className={cn(brandButton, 'w-full py-3')}>
      {loading ? (
        <Loader2 size={18} className="animate-spin" aria-hidden />
      ) : (
        <>
          {Icon ? <Icon size={18} aria-hidden /> : null}
          {children}
        </>
      )}
    </button>
  );
}

/** 品牌色主要連結按鈕（成功畫面的「返回登入」「前往登入」） */
export function BrandLinkButton({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(brandButton, 'px-5 py-2.5')}>
      <Icon size={16} aria-hidden />
      {children}
    </Link>
  );
}

/** 表單下方的「返回登入」文字連結 */
export function BackToLogin() {
  return (
    <div className="mt-6 text-center">
      <Link href="/login" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-text transition-colors hover:text-brand-deep">
        <ArrowLeft size={14} aria-hidden />
        返回登入
      </Link>
    </div>
  );
}

/** 「或使用」分隔線 */
export function OrDivider() {
  return (
    <div className="relative my-8">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="rounded bg-card/80 px-3 text-muted-foreground backdrop-blur-sm">或使用</span>
      </div>
    </div>
  );
}
