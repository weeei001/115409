import React, { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/common/Notice';
import { AI_BRIEF_DISCLAIMER } from '@/lib/disclaimers';
import { EVIDENCE_CATEGORY, buildEvidenceIndex, type EvidenceIndex } from '@/lib/brief/textBriefEvidence';
import { citationLabels, reportAppendix } from '@/lib/brief/report';
import { byImportance } from '@/lib/brief/textBriefClaims';
import {
  briefStatusNote, CONF_HINT, DIRECTION, FORWARD_VIEWS, forwardViewLabel, STANCE_NOTE, STANCE_TONE, type BriefTone,
} from '@/lib/brief/textBriefLabels';
import type { Claim, NewsSupport, TextBriefResponse } from '@/lib/types/textBrief';
import { BriefProvenance } from './BriefProvenance';
import { BriefHeadline, ClaimTypeBadge, DirectionMark, KeyDayMove, StanceIcon, Tag } from './BriefAtoms';

/** 每一項底下的依據：證據名稱與新聞原文摘錄；紙本沒辦法點開，所以直接寫出來 */
const Citations: React.FC<{ ids?: string[]; support?: NewsSupport[]; evidence: EvidenceIndex }> = ({ ids, support, evidence }) => {
  const { labels, unusable } = citationLabels(ids, evidence);
  const quotes = (support ?? []).filter((item) => evidence.usable(item.evidence_id));
  if (!labels.length && !unusable && !quotes.length) return null;
  return (
    <div className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
      {labels.length || unusable ? (
        <p>
          依據：{labels.length ? labels.join('、') : '無可用引用'}
          {unusable ? `（另有 ${unusable} 筆引用無法核對，未列入）` : ''}
        </p>
      ) : null}
      {quotes.map((item, index) => (
        <p key={index}>「{item.quote}」— {evidence.resolve(item.evidence_id)!.label}</p>
      ))}
    </div>
  );
};

const ReportSection: React.FC<{ id: string; title: string; hint?: string; children: React.ReactNode }> = ({ id, title, hint, children }) => (
  <section aria-labelledby={`report-${id}`} id={`report-section-${id}`} className="scroll-mt-[calc(var(--app-header-height)+1rem)] border-t border-border-strong pt-5">
    <h2 id={`report-${id}`} className="font-serif text-xl font-black tracking-[0.06em] print:break-after-avoid">{title}</h2>
    {hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    <div className="mt-3">{children}</div>
  </section>
);

const Items: React.FC<{ children: React.ReactNode[]; empty: string }> = ({ children, empty }) =>
  children.length ? <ul className="divide-y">{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>;

const Item: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="py-3 first:pt-0 print:break-inside-avoid">{children}</li>
);

const ClaimList: React.FC<{ items?: Claim[]; evidence: EvidenceIndex; empty: string }> = ({ items, evidence, empty }) => (
  <Items empty={empty}>
    {byImportance(items ?? []).map((item) => (
      <Item key={item.id}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DirectionMark direction={item.direction} label={DIRECTION[item.direction ?? 'neutral']} />
          <ClaimTypeBadge claimType={item.claim_type} />
        </div>
        <p className="mt-1 text-[15px] leading-[1.8]">{item.text}</p>
        <Citations ids={item.evidence_ids} support={item.news_support} evidence={evidence} />
      </Item>
    ))}
  </Items>
);

/**
 * 可列印的完整報告：抽屜裡的三個分頁與被引用的資料依序排成一頁，項目全部展開。
 * 比照 TradingAgents 的單頁報告，開頭先交代產生條件；列印時隱藏操作按鈕與目錄。
 */
export function BriefReport({ data, title }: { data: TextBriefResponse; title: string }) {
  const evidence = useMemo(() => buildEvidenceIndex(data.evidence_catalog, data.as_of_date), [data]);
  const brief = data.brief!;
  const appendix = useMemo(() => reportAppendix(brief, evidence), [brief, evidence]);
  const statusNote = briefStatusNote(data.status);
  const views = FORWARD_VIEWS.filter(([key]) => brief.forward_views?.[key]);

  const sections: { id: string; title: string; hint?: string; body: React.ReactNode }[] = [
    { id: 'status', title: '現在是什麼狀態', body: <ClaimList items={brief.current_status} evidence={evidence} empty="本節沒有通過檢查的依據。" /> },
    { id: 'positive', title: '正面因素', body: <ClaimList items={brief.positive_factors} evidence={evidence} empty="本節沒有通過檢查的依據。" /> },
    { id: 'negative', title: '負面因素', body: <ClaimList items={brief.negative_factors} evidence={evidence} empty="本節沒有通過檢查的依據。這不代表沒有風險。" /> },
    ...(brief.source_divergences?.length ? [{
      id: 'divergences', title: '資料互相矛盾的地方', hint: '不同來源講的不一樣，AI 沒有硬選一邊，判讀時要自己權衡。',
      body: <ClaimList items={brief.source_divergences} evidence={evidence} empty="" />,
    }] : []),
    {
      id: 'views', title: '不同時間長度的看法', hint: '只講方向與什麼情況下不成立，不給買賣建議與目標價；天數以交易日計算。',
      body: (
        <Items empty="這次沒有這一段內容。">
          {views.map(([key, label]) => {
            const view = brief.forward_views![key]!;
            const tone: BriefTone = STANCE_TONE[view.stance] ?? 'plain';
            return (
              <Item key={key}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{label}</span>
                  <Tag tone={tone}><StanceIcon tone={tone} size={13} />{forwardViewLabel(view)}</Tag>
                </div>
                <p className="mt-1 text-[15px] leading-[1.8]">{view.reason}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-subtle"><span className="font-semibold">什麼情況就不成立：</span>{view.invalidation}</p>
                <Citations ids={view.evidence_ids} support={view.news_support} evidence={evidence} />
              </Item>
            );
          })}
        </Items>
      ),
    },
    {
      id: 'risks', title: '情境風險', hint: '每一項都附上觸發條件，也就是「什麼情況下這個風險會真的發生」。',
      body: (
        <Items empty="本節沒有通過檢查的依據，暫無法提供情境風險判讀。這不代表沒有風險。">
          {(brief.risks ?? []).map((item) => (
            <Item key={item.id}>
              <span className="block text-xs font-bold text-muted-foreground">{item.risk_type}</span>
              <p className="mt-1 text-[15px] leading-[1.8]">{item.description}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-subtle"><span className="font-semibold">觸發條件：</span>{item.trigger}</p>
              <Citations ids={item.evidence_ids} support={item.news_support} evidence={evidence} />
            </Item>
          ))}
        </Items>
      ),
    },
    {
      id: 'watch', title: '接下來觀察什麼',
      body: (
        <Items empty="本節沒有通過檢查的依據，暫無法提供觀察點判讀。">
          {(brief.watch_points ?? []).map((item) => (
            <Item key={item.id}>
              <p className="text-[15px] font-semibold">{item.what_to_watch}<span className="ml-2 text-xs font-normal text-muted-foreground">{item.when}</span></p>
              <p className="mt-1 text-[15px] leading-[1.8] text-subtle">{item.why_it_matters}</p>
              <Citations ids={item.evidence_ids} support={item.news_support} evidence={evidence} />
            </Item>
          ))}
        </Items>
      ),
    },
    {
      id: 'days', title: '關鍵交易日', hint: '漲跌幅與量能倍數取自當日行情，不是 AI 寫的。',
      body: (
        <Items empty="本節沒有通過檢查的依據，暫無法提供交易日判讀。">
          {(brief.key_days ?? []).map((item) => (
            <Item key={item.id}>
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-xs tabular-nums text-subtle">{item.date}</span>
                <KeyDayMove move={item.move_pct} />
                {item.volume_ratio == null ? null : (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">量能 {item.volume_ratio.toFixed(2)} 倍</span>
                )}
              </p>
              <p className="mt-1 text-[15px] leading-[1.8]">{item.what}</p>
              <Citations ids={item.evidence_ids} support={item.news_support} evidence={evidence} />
            </Item>
          ))}
        </Items>
      ),
    },
    ...(brief.limitations?.length ? [{
      id: 'blind', title: '這份分析看不到的部分',
      body: <ul className="list-disc space-y-1 pl-5 text-[15px] leading-[1.8] text-subtle">{brief.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>,
    }] : []),
    ...(data.limitations?.length ? [{
      id: 'limits', title: '分析限制', hint: '系統檢查與資料缺漏的說明。',
      body: <ul className="list-disc space-y-1 pl-5 text-[15px] leading-[1.8] text-subtle">{data.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>,
    }] : []),
    {
      id: 'sources', title: '引用資料', hint: '只列出這份分析實際引用的資料；完整目錄在網頁版的「證據來源」。',
      body: (
        <div className="space-y-5">
          {appendix.groups.map((group) => (
            <div key={group.key}>
              <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{group.label}</h3>
              <ul className="mt-1 divide-y">
                {group.items.map((item) => (
                  <li key={item.id} className="py-2 text-[13px] leading-relaxed print:break-inside-avoid">
                    <p><span className="font-semibold">{item.label}</span><span className="ml-2 text-muted-foreground">{EVIDENCE_CATEGORY[item.category].label}</span></p>
                    {item.title ? <p className="mt-0.5">{item.title}</p> : null}
                    {item.metrics.length ? <p className="mt-0.5 font-mono text-xs tabular-nums text-subtle">{item.summary}</p> : null}
                    {item.url ? <p className="mt-0.5 break-all text-xs text-muted-foreground">{item.url}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs leading-5 text-muted-foreground">
            {appendix.groups.length ? '' : '這份分析沒有可列出的引用資料。'}
            {appendix.uncited ? `另有 ${appendix.uncited} 筆資料沒有被引用。` : ''}
            {appendix.unusable ? `有 ${appendix.unusable} 筆引用在目錄查不到或日期晚於基準日，報告中不列為依據。` : ''}
          </p>
        </div>
      ),
    },
  ];

  return (
    <article className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          <Printer aria-hidden />
          列印／存成 PDF
        </Button>
        <p className="text-xs text-muted-foreground">在列印視窗的「目的地」選「另存為 PDF」就能存檔。</p>
      </div>

      <header className="flex flex-col gap-4">
        {/* 列印時頁首整條隱藏，標題改由這裡印出 */}
        <div className="hidden print:block">
          <p className="text-xs text-muted-foreground">股海明燈 · AI 分析報告</p>
          <p className="mt-1 font-serif text-2xl font-black tracking-[0.04em]">{title}</p>
        </div>
        <BriefProvenance data={data} evidence={evidence} />
        {statusNote ? <Notice>{statusNote}{data.limitations?.length ? '；原因列在「分析限制」。' : '。'}</Notice> : null}
      </header>

      <section aria-labelledby="report-summary" className="print:break-inside-avoid">
        <h2 id="report-summary" className="sr-only">整體結論</h2>
        <BriefHeadline brief={brief} />
        {brief.confidence_reason ? <p className="mt-3 text-[15px] leading-[1.8] text-subtle">{brief.confidence_reason}</p> : null}
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{STANCE_NOTE}分析信心：{CONF_HINT}</p>
      </section>

      <nav aria-label="報告目錄" className="print:hidden">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {sections.map((section) => (
            <li key={section.id}><a href={`#report-section-${section.id}`} className="underline underline-offset-4">{section.title}</a></li>
          ))}
        </ul>
      </nav>

      {sections.map((section) => (
        <ReportSection key={section.id} id={section.id} title={section.title} hint={section.hint}>{section.body}</ReportSection>
      ))}

      <p className="border-t pt-4 text-xs leading-6 text-muted-foreground">{data.disclaimer?.text ?? AI_BRIEF_DISCLAIMER}</p>
    </article>
  );
}
