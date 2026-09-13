import React from 'react';
import { normalizeMarkdownEscapes } from './parseRagStructuredReply';

const BOLD_RE = /(\*\*[^*\n]+?\*\*)/g;
const LIST_ITEM_RE = /^\s*([-*•·]|\d+[.)])\s+/;

/** Render the small Markdown subset used by AI answers without injecting HTML. */
export function MarkdownText({ text }: { text: string }) {
  const normalized = normalizeMarkdownEscapes(text);
  return (
    <>
      {normalized.split(BOLD_RE).map((part, index) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={index}>{part.slice(2, -2)}</strong>
          : part
      )}
    </>
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
