import assert from 'node:assert/strict';
import { splitHighlightedParagraphs } from './highlight';

const flat = (paras: ReturnType<typeof splitHighlightedParagraphs>) =>
  paras.map((segs) => segs.map((s) => (s.quote ? `[${s.text}]` : s.text)).join(''));

// 沒有內文
assert.deepEqual(splitHighlightedParagraphs(null, ['abc']), []);

// 沒有可用引用：去 HTML、依換行分段、去空白段
assert.deepEqual(flat(splitHighlightedParagraphs('<p>第一段</p>\n\n  第二段  ', [])), ['第一段', '第二段']);

// 引用句要完整出現在內文、長度大於 2
assert.deepEqual(flat(splitHighlightedParagraphs('營收創新高，外資買超', ['營收創新高', '不存在的句子', '外資'])), ['[營收創新高]，外資買超']);

// 長句優先，短句不會把長句拆開
assert.deepEqual(flat(splitHighlightedParagraphs('台積電營收創新高', ['營收創', '台積電營收創新高'])), ['[台積電營收創新高]']);

// 正規表示式特殊字元要跳脫
assert.deepEqual(flat(splitHighlightedParagraphs('EPS (年增) 20%+ 成長', ['(年增) 20%+'])), ['EPS [(年增) 20%+] 成長']);

// 每段各自比對
assert.deepEqual(flat(splitHighlightedParagraphs('第一段有關鍵句子\n第二段沒有', ['有關鍵句子'])), ['第一段[有關鍵句子]', '第二段沒有']);

console.log('news highlight tests passed');
