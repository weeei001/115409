import React from 'react';
import { FileText, Lightbulb, List, TrendingUp } from 'lucide-react';
import {
  parseBulletList,
  parseRagStructuredReply,
  sectionKind,
  type RagReplySection,
} from '@/lib/utils/parseRagStructuredReply';
import { MarkdownBlock, MarkdownText, type CitationRenderer } from '@/lib/utils/markdown';
import { chatAnswerBody } from '@/lib/utils/chatCitations';

interface Props {
  content: string;
  showCursor?: boolean;
  renderCitation?: CitationRenderer;
}

function SectionIcon({ kind }: { kind: string }) {
  const Icon = { summary: FileText, sentiment: TrendingUp, events: List, tips: Lightbulb }[kind] ?? FileText;
  return <Icon size={15} className="shrink-0 text-brand" aria-hidden />;
}

interface BodyProps { body: string; renderCitation?: CitationRenderer }

function SentimentSection({ body, renderCitation }: BodyProps) {
  return <MarkdownBlock text={body} renderCitation={renderCitation} />;
}

function EventsSection({ body, renderCitation }: BodyProps) {
  return (
    <ul className="space-y-2">
      {parseBulletList(body).map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <span className="text-subtle">
            <MarkdownText text={item} renderCitation={renderCitation} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TipsSection({ body, renderCitation }: BodyProps) {
  return (
    <div className="rounded-lg border border-warning-border bg-warning-muted px-3.5 py-3 text-warning">
      <p className="text-sm leading-relaxed">
        <MarkdownText text={body} renderCitation={renderCitation} />
      </p>
    </div>
  );
}

function SectionBody({ section, renderCitation }: { section: RagReplySection; renderCitation?: CitationRenderer }) {
  switch (sectionKind(section.title)) {
    case 'sentiment':
      return <SentimentSection body={section.body} renderCitation={renderCitation} />;
    case 'events':
      return <EventsSection body={section.body} renderCitation={renderCitation} />;
    case 'tips':
      return <TipsSection body={section.body} renderCitation={renderCitation} />;
    case 'summary':
      return (
        <p className="text-sm leading-relaxed text-foreground">
          <MarkdownText text={section.body} renderCitation={renderCitation} />
        </p>
      );
    default:
      return (
        <div className="text-sm leading-relaxed text-subtle">
          <MarkdownBlock text={section.body} renderCitation={renderCitation} />
        </div>
      );
  }
}

/** 含【標題】的 AI 回覆：依標題切段，開頭文字自成「重點」段 */
export function RagStructuredReply({ content, showCursor, renderCitation }: Props) {
  const body = chatAnswerBody(content);
  if (!body.trim()) return null;
  const parsed = parseRagStructuredReply(body) ?? { sections: [{ title: '重點', body }] };
  const sections = parsed.sections;
  return (
    <div>
      {sections.map((section, i) => (
        <section key={`${section.title}-${i}`} className={i === 0 ? 'pb-4' : 'border-t py-4'}>
          <div className="mb-2.5 flex items-center gap-2">
            <SectionIcon kind={sectionKind(section.title)} />
            <h3 className="text-xs font-bold tracking-wide text-foreground">{section.title}</h3>
          </div>
          <SectionBody section={section} renderCitation={renderCitation} />
        </section>
      ))}
      {showCursor ? <span className="ml-0.5 inline-block h-4 w-0.5 bg-brand align-text-bottom" style={{ animation: 'cursor-blink 1s step-end infinite' }} /> : null}
    </div>
  );
}
