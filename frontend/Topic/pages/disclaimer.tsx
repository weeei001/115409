import type { ReactNode } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Notice } from '@/components/common/Notice';
import { INVESTMENT_RISK_NOTICE } from '@/lib/disclaimers';

/** 聲明內容有實質修改時更新這個日期 */
const LAST_UPDATED = '2026-10-10';

const SECTIONS: Array<{ id: string; title: string; paragraphs: ReactNode[] }> = [
  {
    id: 'service',
    title: '一、服務性質',
    paragraphs: [
      '股海明燈是國立臺北商業大學資訊管理系的專題作品，提供台股資料整理、AI 研究摘要與模擬投資等學習用途的功能。',
      '本站不是依《證券投資信託及顧問法》核准的證券投資顧問事業，也不是證券商；不提供個別有價證券的投資建議、代客操作或真實下單服務，也不收取任何投資顧問費用。',
    ],
  },
  {
    id: 'data',
    title: '二、資料來源與正確性',
    paragraphs: [
      '行情、三大法人、財務報表等資料整理自臺灣證券交易所、證券櫃檯買賣中心與公開資訊觀測站等公開來源，新聞取自公開的新聞網站。',
      '資料在最近交易日收盤後整理，不是即時行情，可能有延遲、缺漏或錯誤；一切以主管機關及公司的正式公告為準。',
    ],
  },
  {
    id: 'ai',
    title: '三、AI 分析的限制',
    paragraphs: [
      'AI 依公開資料自動整理，可能誤判、遺漏或引用不完整。摘要中的多空立場、情境與風險是研究參考，不是買進或賣出的建議，也不保證準確。',
      '本站公開 AI 摘要的歷史命中率（個股頁「AI 判斷回顧」），讓你自行評估 AI 判斷的可信度；過去的命中率不代表未來的表現。',
    ],
  },
  {
    id: 'paper',
    title: '四、模擬投資',
    paragraphs: [
      '模擬投資使用虛擬資金，不涉及真實金錢與交易。委託以下一個交易日的收盤價估算成交，未完全反映滑價、除權息與交割制度等真實市場條件，模擬結果不代表真實報酬。',
    ],
  },
  {
    id: 'systemic',
    title: '五、系統性風險',
    paragraphs: [
      '地緣政治衝突、重大政策變動或國際政經事件，可能讓整體市場在短時間內劇烈波動，這類風險無法靠分散投資消除。本站資料不是即時資料，無法即時反映突發事件。',
    ],
  },
  {
    id: 'liability',
    title: '六、投資風險與責任歸屬',
    paragraphs: [
      '證券投資有賺有賠，可能損失全部本金。你應依自身的財務狀況、投資目標與風險承受度獨立判斷，並自行承擔投資決策的損益。',
      '本站及製作團隊對於你依本站內容所做的任何投資決策及其損益，不負任何責任。',
    ],
  },
  {
    id: 'update',
    title: '七、聲明更新',
    paragraphs: ['本聲明可能隨服務調整而更新，更新後會公告在本頁。'],
  },
];

export default function DisclaimerPage() {
  return (
    <>
      <Head>
        <title>股海明燈｜投資免責聲明</title>
        <meta name="description" content="股海明燈的服務性質、資料與 AI 分析的限制、模擬投資說明，以及投資風險與責任歸屬。" />
      </Head>
      <SiteHeader title="投資免責聲明" subtitle="使用本站前，請先了解資料與 AI 分析的限制" />
      <main aria-label="投資免責聲明" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <article className="max-w-[68ch]">
          <Notice tone="warning">{INVESTMENT_RISK_NOTICE}</Notice>
          {SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={`disclaimer-${section.id}`} className="mt-8 border-t border-border-strong pt-4">
              <h2 id={`disclaimer-${section.id}`} className="font-serif text-lg font-bold">{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="mt-3 text-[15px] leading-relaxed text-pretty">{paragraph}</p>
              ))}
            </section>
          ))}
          <p className="mt-10 border-t pt-4 text-[13px] text-muted-foreground">
            最後更新：<span className="font-mono tabular-nums">{LAST_UPDATED}</span> · <Link href="/" className="underline underline-offset-4 hover:text-foreground">回到首頁</Link>
          </p>
        </article>
      </main>
    </>
  );
}
