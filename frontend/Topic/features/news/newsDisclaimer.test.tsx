import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { HomeNews, HomeNewsList } from '../home/HomeNews';
import { TopNewsCard } from '../stock/cards/TopNewsCard';
import { StockNewsPanel } from '../stock/StockNewsPanel';
import { NEWS_IMPACT_DISCLAIMER } from '../../lib/disclaimers';

const router = (asPath: string, query: NextRouter['query'] = {}, isReady = true) =>
  ({ asPath, pathname: asPath.split('?')[0], route: '/', query, isReady, replace: async () => true, push: async () => true }) as unknown as NextRouter;
const render = (node: React.ReactNode, value: NextRouter) =>
  renderToStaticMarkup(<RouterContext.Provider value={value}>{node}</RouterContext.Provider>);

assert.equal(NEWS_IMPACT_DISCLAIMER, '影響標籤由 AI 判讀，僅供研究參考，不是投資建議。');

// P0-6：首頁、個股頁卡片、相關新聞抽屜都在區塊標題層放免責（不藏在收合的內容裡）
const homeServer = render(<HomeNews />, router('/', {}, false));
assert.ok(homeServer.includes(NEWS_IMPACT_DISCLAIMER));
// 伺服器輸出不能隨 isReady 改變：靜態頁在用戶端第一次 render 時 isReady 已經是 true，兩邊不同就 hydration 失敗
assert.equal(render(<HomeNews />, router('/', {}, true)), homeServer);
assert.ok(render(<HomeNewsList />, router('/')).includes(NEWS_IMPACT_DISCLAIMER));
const top = renderToStaticMarkup(<TopNewsCard symbol="2330" onOpenDetail={() => {}} />);
assert.ok(top.includes(NEWS_IMPACT_DISCLAIMER) && !top.includes('檢索'));
const drawer = render(<StockNewsPanel symbol="2330" />, router('/stock/2330'));
assert.ok(drawer.includes(`${NEWS_IMPACT_DISCLAIMER}事件影響不代表股價預測`));
assert.ok(!drawer.includes('檢索') && !drawer.includes('尚無筆數'));
// P2-032：關聯類型有說明
assert.ok(drawer.includes('新聞提到這檔股票，或 AI 判讀對它有影響。'));

// P1-09：首頁新聞從網址還原已套用的關鍵字
const view = JSON.stringify({ version: 1, page: 2, filters: { keyword: '台積電' } });
assert.ok(render(<HomeNewsList initialView={JSON.parse(view)} />, router(`/?newsView=${encodeURIComponent(view)}`)).includes('value="台積電"'));
console.log('News section disclaimer and home news route state render checks passed.');
