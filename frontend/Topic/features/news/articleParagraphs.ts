import { stripHtml } from '@/lib/news/newsLinks';

/**
 * 新聞內文的「畫面用」分段與引用標示。只切畫面，不改任何字：
 * 每一段的 segments 依序接起來，就是原始段落的完整文字（測試見 articleParagraphs.test.ts）。
 */
export interface ArticleSegment {
  text: string;
  /** 覆蓋這段文字的引用句（`quotes` 陣列的索引）；空陣列＝一般內文 */
  quotes: number[];
}

export interface ArticleModel {
  /** 確實出現在內文中的引用句（去重、去頭尾空白、長度大於 2） */
  quotes: string[];
  paragraphs: ArticleSegment[][];
}

export interface ArticleParagraphOptions {
  /** 每段目標句數，預設 4（實際會平均成 3～4 句） */
  sentencesPerParagraph?: number;
  /** 一段超過這個句數才切，預設 5；原本就有換行的短段落維持原樣 */
  minSentencesToSplit?: number;
}

/** 句尾：。！？（可連續），後面可帶收尾的引號或括號 */
const SENTENCE_END = /[。！？]+[」』”’）)]*/g;

/** 一個段落內，每個引用句出現的位置（可重疊） */
function quoteRanges(text: string, quotes: string[]) {
  const ranges: { start: number; end: number; quote: number }[] = [];
  quotes.forEach((quote, index) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf(quote, from);
      if (at < 0) break;
      ranges.push({ start: at, end: at + quote.length, quote: index });
      from = at + quote.length;
    }
  });
  return ranges;
}

/** 句子邊界（切點位置）：後面還有非空白文字、而且不落在任何引用句的中間 */
export function sentenceBreaks(text: string, ranges: { start: number; end: number }[] = []): number[] {
  const breaks: number[] = [];
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    if (!text.slice(end).trim()) continue;
    if (ranges.some((range) => range.start < end && end < range.end)) continue;
    breaks.push(end);
  }
  return breaks;
}

/** n 句平均分成每段約 per 句：例如 13 句、每段 4 句 → 4／3／3／3 */
function groupSizes(count: number, per: number): number[] {
  const groups = Math.ceil(count / per);
  const base = Math.floor(count / groups);
  const extra = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 把一個原始段落切成「一般內文／引用句」的片段，再依段落切點分成數個畫面段落 */
function splitParagraph(text: string, quotes: string[], options: Required<ArticleParagraphOptions>): ArticleSegment[][] {
  const ranges = quoteRanges(text, quotes);

  const sentenceEnds = sentenceBreaks(text, ranges);
  const sentenceCount = sentenceEnds.length + 1;
  const cuts: number[] = [];
  if (sentenceCount >= options.minSentencesToSplit) {
    let taken = 0;
    for (const size of groupSizes(sentenceCount, options.sentencesPerParagraph).slice(0, -1)) {
      taken += size;
      cuts.push(sentenceEnds[taken - 1]);
    }
  }

  const bounds = Array.from(new Set([0, text.length, ...cuts, ...ranges.flatMap((range) => [range.start, range.end])])).sort((a, b) => a - b);
  const cutSet = new Set(cuts);
  const paragraphs: ArticleSegment[][] = [[]];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const [start, end] = [bounds[i], bounds[i + 1]];
    if (cutSet.has(start)) paragraphs.push([]);
    const covering = ranges.filter((range) => range.start <= start && end <= range.end).map((range) => range.quote);
    const ids = Array.from(new Set(covering)).sort((a, b) => a - b);
    const current = paragraphs[paragraphs.length - 1];
    const last = current[current.length - 1];
    // 相鄰而且被同一組引用句覆蓋的片段合併成一段
    if (last && last.quotes.join() === ids.join()) last.text += text.slice(start, end);
    else current.push({ text: text.slice(start, end), quotes: ids });
  }
  return paragraphs.filter((segments) => segments.length);
}

/**
 * 去 HTML、依原文換行分段；沒有換行的長段落（超過 minSentencesToSplit 句）只在畫面上依句尾切成每段 3～4 句。
 * 切點不會落在引用句中間，也不增減任何字元。
 */
export function buildArticleParagraphs(content: string | null | undefined, rawQuotes: string[], options: ArticleParagraphOptions = {}): ArticleModel {
  const opts: Required<ArticleParagraphOptions> = { sentencesPerParagraph: 4, minSentencesToSplit: 5, ...options };
  if (!content) return { quotes: [], paragraphs: [] };
  const clean = stripHtml(content).trim();
  const quotes = Array.from(new Set(rawQuotes.map((quote) => quote.trim()))).filter((quote) => quote.length > 2 && clean.includes(quote));
  const paragraphs = clean
    .split('\n')
    .map((para) => para.trim())
    .filter(Boolean)
    .flatMap((para) => splitParagraph(para, quotes, opts));
  return { quotes, paragraphs };
}
