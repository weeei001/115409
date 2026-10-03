import React from 'react';

/** 斷在它後面的標點：句讀與收尾的括號、引號 */
const BREAK_AFTER = new Set(['，', '、', '。', '！', '？', '：', '；', '」', '》', '）']);
/** 斷在它前面的標點：開頭的括號、引號（不讓一行以「、《、（結尾） */
const BREAK_BEFORE = new Set(['「', '《', '（']);

/**
 * 把新聞標題切成「優先換行點」之間的片段：標點之後（開頭括號則在它之前）。
 * 片段接回去就是原字串，一個字都不改；連續的標點（例如「。」」）視為一組，斷在整組之後。
 * 搭配 `word-break: keep-all`＋`overflow-wrap: anywhere` 使用時，換行會先落在標點，
 * 單一片段比一行還長時才在片段中間斷開，不會溢出。
 */
export function splitTitleAtPunctuation(title: string): string[] {
  const chars = [...title];
  const parts: string[] = [];
  let current = '';
  chars.forEach((ch, i) => {
    if (BREAK_BEFORE.has(ch) && current && !BREAK_BEFORE.has(chars[i - 1])) {
      parts.push(current);
      current = '';
    }
    current += ch;
    const next = chars[i + 1];
    if (BREAK_AFTER.has(ch) && next !== undefined && !BREAK_AFTER.has(next)) {
      parts.push(current);
      current = '';
    }
  });
  if (current) parts.push(current);
  return parts;
}

/** 在片段之間放 <wbr>，給標題 h1 用（需配合 keep-all 才會優先斷在標點） */
export function TitleWithBreaks({ title }: { title: string }) {
  const parts = splitTitleAtPunctuation(title);
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          {part}
        </React.Fragment>
      ))}
    </>
  );
}
