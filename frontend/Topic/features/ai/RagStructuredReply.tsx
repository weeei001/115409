import React from 'react';
import { BookOpen, ExternalLink, FileText, Lightbulb, List, TrendingUp } from 'lucide-react';
import {
  parseBulletList,
  parseRagStructuredReply,
  parseSourceItems,
  sectionKind,
  type RagReplySection,
} from '@/lib/utils/parseRagStructuredReply';
import { MarkdownBlock, MarkdownText } from '@/lib/utils/markdown';
import { cn } from '@/lib/cn';

interface Props {
  content: string;
  showCursor?: boolean;
}

function SectionIcon({ kind }: { kind: string }) {
  const Icon = { summary: FileText, sentiment: TrendingUp, events: List, tips: Lightbulb, sources: BookOpen }[kind] ?? FileText;
  return <Icon size={15} className="shrink-0 text-brand" aria-hidden />;
}

function SentimentSection({ body }: { body: string }) {
  return <MarkdownBlock text={body} />;
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
export function RagStructuredReply({ content, showCursor }: Props) {
  const parsed = parseRagStructuredReply(content);
  if (!parsed) return null;
  const sections = parsed.sections;
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
