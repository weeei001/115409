// DEMO: ai-trade-demo — 整頁可刪；刪除清單見 features/ai-trade-demo/README.md
import React from 'react';
import Head from 'next/head';
import { FlaskConical } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AiTradeDemo } from '@/features/ai-trade-demo/AiTradeDemo';

export default function AiTradeDemoPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>股海明燈｜AI 模擬下單 Demo</title>
        <meta name="description" content="由 AI 逐日決定買賣的模擬回測 Demo，不構成投資建議。" />
      </Head>
      <SiteHeader icon={FlaskConical} title="AI 模擬下單 Demo" subtitle="模擬回測，不構成投資建議" />
      <AiTradeDemo />
    </div>
  );
}
