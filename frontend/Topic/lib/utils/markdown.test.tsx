import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { RagStructuredReply } from '../../features/ai/RagStructuredReply';
import { MarkdownBlock, MarkdownText } from './markdown';
import { parseRagStructuredReply } from './parseRagStructuredReply';

const inline = (text: string) => renderToStaticMarkup(<MarkdownText text={text} />);
const formatted = inline('Plain **bold** *italic* ***both*** **bold *nested*** *italic **nested***');
assert.match(formatted, /Plain <strong>bold<\/strong> <em>italic<\/em>/);
assert.match(formatted, /<strong><em>both<\/em><\/strong>/);
assert.match(formatted, /<strong>bold <em>nested<\/em><\/strong>/);
assert.match(formatted, /<em>italic <strong>nested<\/strong><\/em>/);
assert.match(inline(String.raw`\*\*bold\*\* \*italic\*`), /<strong>bold<\/strong> <em>italic<\/em>/);

const links = inline('[**Source**](https://example.com/report_(2026)?a=1&b=2) [HTTP](http://example.com)');
assert.equal((links.match(/<a /g) ?? []).length, 2);
assert.match(links, /href="https:\/\/example.com\/report_\(2026\)\?a=1&amp;b=2"/);
assert.match(links, /<strong>Source<\/strong><\/a>/);
for (const destination of ['javascript:alert(1)', 'data:text/html,evil', 'file:///tmp/test', '//example.com', 'https://user:pass@example.com', 'https://']) {
  const markup = inline(`[Unsafe](${destination})`);
  assert.doesNotMatch(markup, /<a /, destination);
  assert.ok(markup.includes('[Unsafe]'), destination);
}
assert.doesNotMatch(inline('<script>alert(1)</script> <img src=x onerror=alert(1)>'), /<script|<img/);
assert.match(inline('<script>'), /&lt;script&gt;/);
assert.ok(inline('A partial **answer and [unfinished](').includes('A partial **answer and [unfinished]('));

const blocks = renderToStaticMarkup(<MarkdownBlock text={'**Summary**\n\n- *First*\n- [Second](https://example.com)\n\n1. One\n2. Two'} />);
assert.match(blocks, /<strong>Summary<\/strong>/);
assert.match(blocks, /<ul[^>]*><li>.*<em>First<\/em>/);
assert.match(blocks, /<ol[^>]*><li>.*One.*<\/li><li>.*Two/);

const headings = renderToStaticMarkup(<MarkdownBlock text={'Before\n### **Analysis** ###\nAfter\n- Item\n## Outlook\n1. Next'} />);
assert.match(headings, /<p[^>]*>.*Before.*<\/p><h3[^>]*>.*<strong>Analysis<\/strong>.*<\/h3><p[^>]*>.*After/);
assert.match(headings, /<\/ul><h2[^>]*>.*Outlook.*<\/h2><ol/);
assert.doesNotMatch(headings, /###/);
for (let level = 1; level <= 6; level++) {
  const markup = renderToStaticMarkup(<MarkdownBlock text={`${'#'.repeat(level)} Heading`} />);
  assert.ok(markup.includes(`<h${level} `));
  assert.ok(markup.includes(`</h${level}>`));
}
const literalHashes = renderToStaticMarkup(<MarkdownBlock text={'###hashtag\n####### Not a heading\nA ### marker'} />);
assert.doesNotMatch(literalHashes, /<h[1-6]/);
assert.ok(literalHashes.includes('###hashtag'));
const citedHeading = renderToStaticMarkup(<MarkdownBlock text={String.raw`\#\#\# Escaped [S1]`} renderCitation={(id) => <button>{id}</button>} />);
assert.match(citedHeading, /<h3[^>]*>.*Escaped <button>S1<\/button>.*<\/h3>/);

// Each structured text section uses the same wrapping and inline formatting.
const longUrl = `https://example.com/${'a'.repeat(180)}`;
for (const section of ['綜合摘要', '市場情緒', '關鍵事件', '投資提示', '其他']) {
  const markup = renderToStaticMarkup(<RagStructuredReply content={`【${section}】\n*Detail* [Source](${longUrl})`} />);
  assert.match(markup, /<em>Detail<\/em>/, section);
  assert.match(markup, /class="\[overflow-wrap:anywhere\] text-pretty"/, section);
  assert.ok(markup.includes(`href="${longUrl}"`), section);
  const sectionHeading = renderToStaticMarkup(<RagStructuredReply content={`### 【${section}】\n### **Detail**\n- First\nTrailing explanation`} />);
  assert.match(sectionHeading, /<h3[^>]*>.*<strong>Detail<\/strong>/, section);
  assert.match(sectionHeading, /<ul[^>]*><li>.*First/, section);
  assert.ok(sectionHeading.includes('Trailing explanation'), section);
  assert.doesNotMatch(sectionHeading, /###/, section);
}
assert.deepEqual(parseRagStructuredReply('### 【綜合摘要】 ###\nFirst\n## 【投資提示】\nSecond')?.sections, [
  { title: '綜合摘要', body: 'First' },
  { title: '投資提示', body: 'Second' },
]);
assert.match(inline(longUrl), /\[overflow-wrap:anywhere\]/);
console.log('Markdown SSR checks passed: emphasis, nested formatting, safe links, lists, escaped text, and structured reply wrapping.');
