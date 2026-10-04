import assert from 'node:assert/strict';
import { buildArticleParagraphs, sentenceBreaks, type ArticleSegment } from './articleParagraphs';
import { buildCitationIndex, eventCitationId, groupCitationId, impactCitationId } from './citations';

/** 段落接回原文 */
const joinParagraph = (segments: ArticleSegment[]) => segments.map((segment) => segment.text).join('');

const flat = (model: ReturnType<typeof buildArticleParagraphs>) =>
  model.paragraphs.map((segs) => segs.map((s) => (s.quotes.length ? `[${s.text}]` : s.text)).join(''));
const joined = (model: ReturnType<typeof buildArticleParagraphs>) => model.paragraphs.map(joinParagraph).join('');

// 沒有內文
assert.deepEqual(buildArticleParagraphs(null, ['abc']), { quotes: [], paragraphs: [] });

// 原文有換行：每個換行就是一段，短段落不再切
assert.deepEqual(flat(buildArticleParagraphs('<p>第一段。還是第一段。</p>\n\n  第二段  ', [])), ['第一段。還是第一段。', '第二段']);

// 沒有換行的長段落：13 句 → 4／3／3／3 句，接回去和原文一字不差
const sentences = Array.from({ length: 13 }, (_, i) => `第${i + 1}句說明內容${i % 3 === 0 ? '！' : i % 3 === 1 ? '？' : '。'}`);
const long = sentences.join('');
const model = buildArticleParagraphs(long, []);
assert.equal(model.paragraphs.length, 4);
assert.deepEqual(model.paragraphs.map((p) => sentenceBreaks(joinParagraph(p)).length + 1), [4, 3, 3, 3]);
assert.equal(joined(model), long);

// 收尾引號跟著句尾，不會被切到下一段開頭
const quoted = '甲說「好。」乙說「不好！」丙說好。丁說好。戊說好。己說好。';
const quotedModel = buildArticleParagraphs(quoted, []);
assert.equal(joined(quotedModel), quoted);
assert.ok(quotedModel.paragraphs.every((p) => !joinParagraph(p).startsWith('」')));

// 引用句跨過句尾：切點不能落在引用句中間，引用句也不能被拆成兩段
const crossing = '一句。二句。三句開始引用。引用的後半句。四句。五句。六句。七句。八句。';
const quote = '三句開始引用。引用的後半句';
const crossingModel = buildArticleParagraphs(crossing, [quote]);
assert.equal(joined(crossingModel), crossing);
const holder = crossingModel.paragraphs.filter((p) => p.some((s) => s.quotes.length));
assert.equal(holder.length, 1);
assert.ok(joinParagraph(holder[0]).includes(quote));
assert.ok(flat(crossingModel).some((p) => p.includes(`[${quote}]`)));

// 重疊的引用句：拆成最小片段，每段標出覆蓋它的引用句
const overlap = buildArticleParagraphs('國巨：預估營收自2026年成長至2028年，三年放大2.4倍。', ['國巨：預估營收自2026年成長至2028年', '預估營收自2026年成長至2028年，三年放大2.4倍']);
assert.deepEqual(overlap.paragraphs[0].map((s) => [s.text, s.quotes]), [
  ['國巨：', [0]],
  ['預估營收自2026年成長至2028年', [0, 1]],
  ['，三年放大2.4倍', [1]],
  ['。', []],
]);

// 無效引用：不在內文、太短、重複
assert.deepEqual(buildArticleParagraphs('營收創新高，外資買超', ['營收創新高', '營收創新高 ', '不存在的句子', '外資']).quotes, ['營收創新高']);

// 隨機內文：不論怎麼切，接回去都和原文完全相同，切點也不落在引用句中間
let seed = 7;
const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const alphabet = ['台', '積', '電', '營', '收', 'A', 'I', '2', '。', '！', '？', '」', '「', '，', ' '];
for (let round = 0; round < 300; round += 1) {
  const text = Array.from({ length: 40 + rand(200) }, () => alphabet[rand(alphabet.length)]).join('').trim();
  if (!text) continue;
  const picks = Array.from({ length: rand(4) }, () => { const start = rand(text.length); return text.slice(start, start + 3 + rand(30)); });
  const result = buildArticleParagraphs(text, picks);
  assert.equal(joined(result), text, `round ${round}`);
  for (const q of result.quotes) {
    // 每個引用句仍完整出現在某一段（沒有被切點拆開）
    assert.ok(result.paragraphs.some((p) => joinParagraph(p).includes(q)), `quote kept whole in round ${round}`);
  }
}

// 引用句 → 面板項目：先找直接引用的影響，再找事件被影響引用的，最後是未連到影響的事件
const citations = buildCitationIndex({
  status: 'success',
  events: [
    { key: 'e1', summary: '', statement_type: 'fact', topics: [], evidence: [{ field: 'content', quote: '事件一的原文' }] },
    { key: 'e2', summary: '', statement_type: 'fact', topics: [], evidence: [{ field: 'content', quote: '沒有影響的事件' }] },
  ],
  impacts: [
    { event_key: 'e1', target_type: 'company', target_id: '2330', direction: 'positive', importance: 'high', basis: 'reported', reason: '', evidence: [{ field: 'content', quote: '影響一的原文' }] },
    { event_key: 'e1', target_type: 'company', target_id: '2330', direction: 'positive', importance: 'low', basis: 'reported', reason: '', evidence: [{ field: 'content', quote: '影響二的原文 ' }] },
  ],
});
assert.equal(citations.ownerOf('影響二的原文'), impactCitationId(1));
assert.equal(citations.ownerOf('事件一的原文'), impactCitationId(0));
assert.equal(citations.ownerOf('沒有影響的事件'), eventCitationId('e2'));
assert.equal(citations.ownerOf('不存在'), null);
assert.deepEqual(citations.quotesOf(impactCitationId(0)), ['影響一的原文', '事件一的原文']);
assert.deepEqual(citations.quotesOf(groupCitationId('company:2330')), ['影響一的原文', '事件一的原文', '影響二的原文']);
assert.deepEqual(buildCitationIndex({ status: 'failed', events: [], impacts: [] }).quotesOf(impactCitationId(0)), []);

console.log('article paragraph and citation tests passed');
