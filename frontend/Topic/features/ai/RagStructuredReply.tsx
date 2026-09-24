import React from 'react';
import { BookOpen, ExternalLink, FileText, Lightbulb, List, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  detectSentiment,
  parseBulletList,
  parseRagStructuredReply,
  parseSourceItems,
  sectionKind,
  type RagReplySection,
  type RagSentiment,
} from '@/lib/utils/parseRagStructuredReply';
import { MarkdownBlock, MarkdownText } from '@/lib/utils/markdown';
import { cn } from '@/lib/cn';

interface Props {
  content: string;
  showCursor?: boolean;
  /** 有新聞資料面板時隱藏「引用來源」段，避免重複 */
  showSources?: boolean;
}

/** 市場情緒徽章：依 AI 在該段自己寫的字判斷（決議 c49），看漲用漲色、看跌用跌色 */
const SENTIMENT: Record<RagSentiment, { label: string; icon: React.ReactNode; className: string }> = {
  bullish: { label: '看漲', icon: <TrendingUp size={14} aria-hidden />, className: 'border-up/25 bg-up-muted text-up-emphasis' },
  bearish: { label: '看跌', icon: <TrendingDown size={14} aria-hidden />, className: 'border-down/25 bg-down-muted text-down-emphasis' },
  neutral: { label: '中性', icon: <Minus size={14} aria-hidden />, className: 'border-border bg-muted text-subtle' },
};

function SectionIcon({ kind }: { kind: string }) {
  const Icon = { summary: FileText, sentiment: TrendingUp, events: List, tips: Lightbulb, sources: BookOpen }[kind] ?? FileText;
  return <Icon size={15} className="shrink-0 text-brand" aria-hidden />;
}

function SentimentSection({ body }: { body: string }) {
  const config = SENTIMENT[detectSentiment(body)];
  const detail = body.replace(/^(看漲|看跌|中性)\s*[📈📉]?\s*[，,]?\s*/u, '').trim();
  return (
    <>
      <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', config.className)}>
        {config.icon}
        <span>{config.label}</span>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-subtle">
        <MarkdownText text={detail || body} />
      </p>
    </>
  );
}

function EventsSection({ body }: { body: string }) {
  return (
    <ul className="space-y-2">
      {parseBulletList(body).map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <span className="text-subtle">
            <MarkdownText text={item} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TipsSection({ body }: { body: string }) {
  return (
    <div className="rounded-lg border border-warning-border bg-warning-muted px-3.5 py-3 text-warning">
      <p className="text-sm leading-relaxed">
        <MarkdownText text={body} />
      </p>
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourcesSection({ body }: { body: string }) {
  const sources = parseSourceItems(body);
  if (sources.length === 0) {
    return (
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-subtle">
        <MarkdownText text={body} />
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {sources.map((source, i) => {
        const Row = source.url ? 'a' : 'div';
        const external = /^https?:\/\//.test(source.url);
        return (
          <li key={`${source.url}-${i}`}>
            <Row
              href={source.url || undefined}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              className={cn(
                'flex gap-2.5 rounded-lg border bg-muted/60 px-3 py-2.5',
                source.url && 'group transition-colors hover:border-border-strong hover:bg-muted',
              )}
            >
              <span className="mt-0.5 shrink-0 text-[10px] font-bold text-brand-text tabular-nums">{source.index ? `[${source.index}]` : '•'}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm leading-snug font-medium text-foreground group-hover:text-brand-text">{source.title}</span>
                {source.url ? (
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <ExternalLink size={11} aria-hidden />
                    <span className="truncate">{external ? hostname(source.url) : '查看新聞證據'}</span>
                  </span>
                ) : null}
              </span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

function SectionBody({ section }: { section: RagReplySection }) {
  switch (sectionKind(section.title)) {
    case 'sentiment':
      return <SentimentSection body={section.body} />;
    case 'events':
      return <EventsSection body={section.body} />;
    case 'tips':
      return <TipsSection body={section.body} />;
    case 'sources':
      return <SourcesSection body={section.body} />;
    case 'summary':
      return (
        <p className="text-sm leading-relaxed text-foreground">
          <MarkdownText text={section.body} />
        </p>
      );
    default:
      return (
        <div className="text-sm leading-relaxed text-subtle">
          <MarkdownBlock text={section.body} />
        </div>
      );
  }
}

/** 含【標題】的 AI 回覆：依標題切段，開頭文字自成「重點」段 */
export function RagStructuredReply({ content, showCursor, showSources = true }: Props) {
  const parsed = parseRagStructuredReply(content);
  if (!parsed) return null;
  const sections = showSources ? parsed.sections : parsed.sections.filter((section) => sectionKind(section.title) !== 'sources');
  return (
    <div>
      {sections.map((section, i) => (
        <section key={`${section.title}-${i}`} className={i === 0 ? 'pb-4' : 'border-t py-4'}>
          <div className="mb-2.5 flex items-center gap-2">
            <SectionIcon kind={sectionKind(section.title)} />
            <h3 className="text-xs font-bold tracking-wide text-foreground">{section.title}</h3>
          </div>
          <SectionBody section={section} />
        </section>
      ))}
      {showCursor ? <span className="ml-0.5 inline-block h-4 w-0.5 bg-brand align-text-bottom" style={{ animation: 'cursor-blink 1s step-end infinite' }} /> : null}
    </div>
  );
}
