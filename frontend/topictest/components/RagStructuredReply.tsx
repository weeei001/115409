import React from 'react';
import {
  BookOpen,
  ExternalLink,
  FileText,
  Lightbulb,
  List,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  detectSentiment,
  parseBulletList,
  parseRagStructuredReply,
  parseSourceItems,
  sectionKind,
  type RagReplySection,
  type RagSentiment,
} from '../lib/utils/parseRagStructuredReply';

interface Props {
  content: string;
  showCursor?: boolean;
}

const SENTIMENT_CONFIG: Record<
  RagSentiment,
  { label: string; icon: React.ReactNode; className: string }
> = {
  bullish: {
    label: '看漲',
    icon: <TrendingUp size={14} aria-hidden />,
    className:
      'bg-[var(--color-up-muted)] text-[var(--color-up-emphasis)] border-[var(--color-up)]/25',
  },
  bearish: {
    label: '看跌',
    icon: <TrendingDown size={14} aria-hidden />,
    className:
      'bg-[var(--color-down-muted)] text-[var(--color-down-emphasis)] border-[var(--color-down)]/25',
  },
  neutral: {
    label: '中性',
    icon: <Minus size={14} aria-hidden />,
    className:
      'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  },
};

function SectionIcon({ kind }: { kind: string }) {
  const cls = 'shrink-0 text-brand';
  const size = 15;
  switch (kind) {
    case 'summary':
      return <FileText size={size} className={cls} aria-hidden />;
    case 'sentiment':
      return <TrendingUp size={size} className={cls} aria-hidden />;
    case 'events':
      return <List size={size} className={cls} aria-hidden />;
    case 'tips':
      return <Lightbulb size={size} className={cls} aria-hidden />;
    case 'sources':
      return <BookOpen size={size} className={cls} aria-hidden />;
    default:
      return <FileText size={size} className={cls} aria-hidden />;
  }
}

function SentimentSection({ body }: { body: string }) {
  const sentiment = detectSentiment(body);
  const config = SENTIMENT_CONFIG[sentiment];
  const detail = body.replace(/^(看漲|看跌|中性)\s*[📈📉]?\s*[，,]?\s*/u, '').trim();

  return (
    <>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${config.className}`}
      >
        {config.icon}
        <span>{config.label}</span>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {detail || body}
      </p>
    </>
  );
}

function EventsSection({ body }: { body: string }) {
  const items = parseBulletList(body);
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <span className="text-[var(--color-text-secondary)]">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function TipsSection({ body }: { body: string }) {
  return (
    <div className="ui-alert-warning rounded-xl px-3.5 py-3">
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function tryHostname(url: string): string {
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
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {body}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {sources.map((source, i) => {
        const SourceRow = source.url ? 'a' : 'div';
        return (
        <li key={`${source.url}-${i}`}>
          <SourceRow
            href={source.url || undefined}
            target={source.url ? '_blank' : undefined}
            rel={source.url ? 'noopener noreferrer' : undefined}
            className={`flex gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 px-3 py-2.5 ${source.url ? 'group transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-elevated)]' : ''}`}
          >
            <span className="mt-0.5 shrink-0 text-[10px] font-bold tabular-nums text-brand">
              {source.index ? `[${source.index}]` : '•'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium leading-snug text-[var(--color-text-primary)] group-hover:text-brand">
                {source.title}
              </span>
              {source.url && <span className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                <ExternalLink size={11} aria-hidden />
                <span className="truncate">{tryHostname(source.url)}</span>
              </span>}
            </span>
          </SourceRow>
        </li>
        );
      })}
    </ul>
  );
}

function SectionBody({ section }: { section: RagReplySection }) {
  const kind = sectionKind(section.title);

  switch (kind) {
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
        <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">{section.body}</p>
      );
    default:
      return (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {section.body}
        </p>
      );
  }
}

function ReplySection({ section, isFirst }: { section: RagReplySection; isFirst: boolean }) {
  const kind = sectionKind(section.title);

  return (
    <section
      className={
        isFirst
          ? 'pb-4'
          : 'border-t border-[var(--color-border)]/80 py-4 first:border-t-0 first:pt-0'
      }
    >
      <div className="mb-2.5 flex items-center gap-2">
        <SectionIcon kind={kind} />
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-primary)]">
          {section.title}
        </h3>
      </div>
      <SectionBody section={section} />
    </section>
  );
}

export const RagStructuredReply: React.FC<Props> = ({ content, showCursor }) => {
  const parsed = parseRagStructuredReply(content);
  if (!parsed) return null;

  return (
    <div className="space-y-0">
      {parsed.sections.map((section, i) => (
        <ReplySection key={`${section.title}-${i}`} section={section} isFirst={i === 0} />
      ))}
      {showCursor ? (
        <span
          className="inline-block w-0.5 h-4 ml-0.5 bg-brand align-text-bottom"
          style={{ animation: 'cursor-blink 1s step-end infinite' }}
        />
      ) : null}
    </div>
  );
};
