import React from 'react';
import Link from 'next/link';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { authLinkClass } from './AuthForm';
import { cn } from '@/lib/cn';

/**
 * 需要登入的頁面（收藏股、通知、模擬投資）未登入時的帳頁：說明登入後能做什麼，主要按鈕去登入，
 * 下一列給還沒有帳號的人。登入與註冊都帶 returnUrl，完成後回到原頁。
 */
export function LoginPrompt({ title, action, returnUrl, children }: { title: string; action: string; returnUrl: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-x-16">
      <Ledger title={title} className="lg:col-span-7">
        <LedgerPanel>
          <p className="max-w-[34em] text-[15px] leading-[1.8] text-subtle">{children}</p>
          <Button asChild className="mt-5 w-full sm:w-auto sm:min-w-44">
            <Link href={{ pathname: '/login', query: { returnUrl } }}>{action}</Link>
          </Button>
        </LedgerPanel>
        <p className="flex flex-wrap items-center gap-x-2 bg-card px-4 py-1 text-sm sm:px-5">
          <span className="text-muted-foreground">還沒有帳號？</span>
          <Link href={{ pathname: '/register', query: { returnUrl } }} className={cn('inline-flex min-h-11 items-center', authLinkClass)}>建立帳號</Link>
        </p>
      </Ledger>
    </div>
  );
}
