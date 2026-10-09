import {
  parseRagStructuredReply,
  sectionKind,
  type RagReplySection,
} from '@/lib/utils/parseRagStructuredReply';
import { MarkdownBlock, type CitationRenderer } from '@/lib/utils/markdown';
import { chatAnswerBody } from '@/lib/utils/chatCitations';
import { StreamCursor } from './StreamCursor';

interface Props {
  content: string;
  showCursor?: boolean;
  renderCitation?: CitationRenderer;
}

interface BodyProps { body: string; renderCitation?: CitationRenderer }

function SentimentSection({ body, renderCitation }: BodyProps) {
  return <MarkdownBlock text={body} renderCitation={renderCitation} />;
}

function EventsSection({ body, renderCitation }: BodyProps) {
  return (
    <div className="text-[15px] leading-[1.8] text-subtle">
      <MarkdownBlock text={body} renderCitation={renderCitation} />
    </div>
  );
}

/** 提示框：墨色左側粗線＋中性內文；不用燈泡圖示、不用狀態色或燈色（燈只當光用） */
function TipsSection({ body, renderCitation }: BodyProps) {
  return (
    <div className="border border-l-2 border-l-border-strong bg-card px-3.5 py-2.5 text-subtle dark:border-l-foreground/60">
      <div className="text-sm leading-relaxed">
        <MarkdownBlock text={body} renderCitation={renderCitation} />
      </div>
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
        <div className="text-[15px] leading-[1.8] text-foreground">
          <MarkdownBlock text={section.body} renderCitation={renderCitation} />
        </div>
      );
    default:
      return (
        <div className="text-[15px] leading-[1.8] text-subtle">
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
          {/* 段落標題是純文字小標（面板 caption），不配裝飾圖示 */}
          <h3 className="mb-2 text-[13px] font-semibold tracking-[0.04em] text-subtle">{section.title}</h3>
          <SectionBody section={section} renderCitation={renderCitation} />
        </section>
      ))}
      {showCursor ? <StreamCursor /> : null}
    </div>
  );
}
