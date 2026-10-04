import React from 'react';
import { normalizeMarkdownEscapes } from './parseRagStructuredReply';
import { safeHttpUrl } from './url';
import { CHAT_CITATION_PATTERN } from './chatCitations';
import { textLinkClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const INLINE_PATTERN = String.raw`\[([^\]\n]+)\]\(((?:[^()\s<>]|\([^()\s<>]*\))+)\)|\*\*\*([^*\n]+?)\*\*\*|\*\*(?!\*)([^\n]+?)\*\*(?!\*)|\*(?!\*)((?:\*\*[^*\n]+?\*\*|[^*\n])+?)\*(?!\*)`;
const INLINE_RE = new RegExp(INLINE_PATTERN, 'g');
const CITATION_INLINE_RE = new RegExp(String.raw`${INLINE_PATTERN}|\[\*{0,3}(${CHAT_CITATION_PATTERN})\*{0,3}\]`, 'g');
const CITATION_LABEL_RE = new RegExp(`^(${CHAT_CITATION_PATTERN})$`);
const LIST_ITEM_RE = /^\s*([-*•·]|\d+[.)])\s+/;
export type CitationRenderer = (id: string) => React.ReactNode;
interface TextProps { text: string; renderCitation?: CitationRenderer }

function renderInline(text: string, allowLinks = true, renderCitation?: CitationRenderer): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(renderCitation ? CITATION_INLINE_RE : INLINE_RE)) {
    const index = match.index;
    nodes.push(text.slice(cursor, index));
    if (match[1] !== undefined) {
      const safeUrl = safeHttpUrl(match[2]);
      const citation = match[1].replace(/\*/g, '').match(CITATION_LABEL_RE)?.[1];
      nodes.push(renderCitation && citation
        ? <React.Fragment key={index}>{renderCitation(citation)}</React.Fragment>
        : !renderCitation && allowLinks && safeUrl
        ? <a key={index} href={match[2]} className={cn(textLinkClass, 'focus-visible:outline-2 focus-visible:outline-offset-2')}>{renderInline(match[1], false)}</a>
        : match[0]);
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={index}><em>{renderInline(match[3], allowLinks, renderCitation)}</em></strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={index}>{renderInline(match[4], allowLinks, renderCitation)}</strong>);
    } else if (match[5] !== undefined) {
      nodes.push(<em key={index}>{renderInline(match[5], allowLinks, renderCitation)}</em>);
    } else {
      nodes.push(<React.Fragment key={index}>{renderCitation ? renderCitation(match[6]) : match[0]}</React.Fragment>);
    }
    cursor = index + match[0].length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

/** Render the small Markdown subset used by AI answers without injecting HTML. */
export function MarkdownText({ text, renderCitation }: TextProps) {
  return (
    <span className="[overflow-wrap:anywhere] text-pretty">
      {renderInline(normalizeMarkdownEscapes(text), true, renderCitation)}
    </span>
  );
}

/** Render paragraphs and the unordered/ordered lists used by AI answers. */
export function MarkdownBlock({ text, renderCitation }: TextProps) {
  const normalized = normalizeMarkdownEscapes(text);
  const blocks: Array<{ type: 'paragraph' | 'list'; ordered?: boolean; lines: string[] }> = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', ordered, lines: list });
    list = [];
  };

  for (const line of normalized.split('\n')) {
    const match = line.match(LIST_ITEM_RE);
    if (match) {
      flushParagraph();
      const nextOrdered = /^\d/.test(match[1]);
      if (list.length && ordered !== nextOrdered) flushList();
      ordered = nextOrdered;
      list.push(line.slice(match[0].length));
    } else if (line.trim()) {
      flushList();
      paragraph.push(line);
    } else {
      flushParagraph();
      flushList();
    }
  }
  flushParagraph();
  flushList();

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => block.type === 'list'
        ? (block.ordered ? <ol key={index} className="list-decimal space-y-1 pl-5 marker:font-mono marker:text-muted-foreground"><ListItems items={block.lines} renderCitation={renderCitation} /></ol>
          : <ul key={index} className="list-disc space-y-1 pl-5 marker:text-muted-foreground"><ListItems items={block.lines} renderCitation={renderCitation} /></ul>)
        : <p key={index} className="whitespace-pre-wrap"><MarkdownText text={block.lines.join('\n')} renderCitation={renderCitation} /></p>)}
    </div>
  );
}

function ListItems({ items, renderCitation }: { items: string[]; renderCitation?: CitationRenderer }) {
  return <>{items.map((item, index) => <li key={index}><MarkdownText text={item} renderCitation={renderCitation} /></li>)}</>;
}
