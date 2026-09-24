import React from 'react';
import { normalizeMarkdownEscapes } from './parseRagStructuredReply';
import { safeHttpUrl } from './url';

const INLINE_RE = /\[([^\]\n]+)\]\(((?:[^()\s<>]|\([^()\s<>]*\))+)\)|\*\*\*([^*\n]+?)\*\*\*|\*\*(?!\*)([^\n]+?)\*\*(?!\*)|\*(?!\*)((?:\*\*[^*\n]+?\*\*|[^*\n])+?)\*(?!\*)/g;
const LIST_ITEM_RE = /^\s*([-*•·]|\d+[.)])\s+/;

function renderInline(text: string, allowLinks = true): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index;
    nodes.push(text.slice(cursor, index));
    if (match[1] !== undefined) {
      const safeUrl = safeHttpUrl(match[2]);
      nodes.push(allowLinks && safeUrl
        ? <a key={index} href={match[2]} className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2">{renderInline(match[1], false)}</a>
        : match[0]);
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={index}><em>{match[3]}</em></strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<strong key={index}>{renderInline(match[4], allowLinks)}</strong>);
    } else {
      nodes.push(<em key={index}>{renderInline(match[5], allowLinks)}</em>);
    }
    cursor = index + match[0].length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

/** Render the small Markdown subset used by AI answers without injecting HTML. */
export function MarkdownText({ text }: { text: string }) {
  return (
    <span className="[overflow-wrap:anywhere] text-pretty">
      {renderInline(normalizeMarkdownEscapes(text))}
    </span>
  );
}

/** Render paragraphs and the unordered/ordered lists used by AI answers. */
export function MarkdownBlock({ text }: { text: string }) {
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
        ? (block.ordered ? <ol key={index} className="list-decimal space-y-1 pl-5"><ListItems items={block.lines} /></ol>
          : <ul key={index} className="list-disc space-y-1 pl-5"><ListItems items={block.lines} /></ul>)
        : <p key={index} className="whitespace-pre-wrap"><MarkdownText text={block.lines.join('\n')} /></p>)}
    </div>
  );
}

function ListItems({ items }: { items: string[] }) {
  return <>{items.map((item, index) => <li key={index}><MarkdownText text={item} /></li>)}</>;
}
