import assert from 'node:assert/strict';
import { newsSourceName } from './newsSource';

for (const [source, name] of [
  ['cnyes', '鉅亨網'], ['CNYES', '鉅亨網'], [' ltn ', '自由時報'], ['moneydj', 'MoneyDJ'], ['udn', '聯合新聞網'],
  ['chinatimes', '中時新聞網'], ['yahoo', 'Yahoo 財經'], ['crawler_csv', 'CMoney 財經社群'], ['Josh', 'CMoney 財經社群'],
  ['123456', 'CMoney 財經社群'],
] as const) {
  assert.equal(newsSourceName(source), name, source);
}
for (const unknown of [null, undefined, '', '   ', 'reuters', 'cnyes2']) assert.equal(newsSourceName(unknown), null);
console.log('News source name mapping checks passed.');
