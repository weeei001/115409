import { PLAN_LIMITS, planById } from './plans';

/**
 * 商業模式第 6 節的收入與成本試算。全部是假設值（不是實際營收或實測成本），公式固定，換掉參數就能重算。
 * 後台「方案與營收（展示）」分頁用；測試核對過和文件第 6.3 節的表一致。
 */
export interface RevenueAssumptions {
  /** A1 註冊會員數 */
  members: number;
  /** A2 付費轉換率 */
  conversion: number;
  /** A3 付費者中進階版的比例（其餘是專業版） */
  plusShare: number;
  /** A5 免費會員每月活躍比例 */
  activeFreeShare: number;
  /** A6 每人每月 AI 提問次數 */
  asksPerMonth: { free: number; plus: number; pro: number };
  /** A7 每次 AI 提問的 token */
  askTokens: { input: number; output: number };
  /** A8 每份 AI 摘要的 token */
  briefTokens: { input: number; output: number };
  /** A9 LLM 單價（美元／百萬 tokens） */
  usdPerMillion: { input: number; output: number };
  /** A10 匯率 */
  twdPerUsd: number;
  /** A11 每月交易日 */
  tradingDays: number;
  /** 每日預先產生 AI 摘要的支援股檔數 */
  briefStocks: number;
  /** 新聞事件判讀每輪成本上限（美元）與每月輪數 */
  newsUsdPerRun: number;
  newsRunsPerMonth: number;
}

export const BASE_ASSUMPTIONS: Omit<RevenueAssumptions, 'members' | 'conversion'> = {
  plusShare: 0.8,
  activeFreeShare: 0.3,
  asksPerMonth: { free: 15, plus: 120, pro: 400 },
  askTokens: { input: 20_000, output: 1_500 },
  briefTokens: { input: 30_000, output: 3_000 },
  usdPerMillion: { input: 0.2, output: 1.2 },
  twdPerUsd: 32,
  tradingDays: 22,
  briefStocks: 40,
  newsUsdPerRun: 0.5,
  newsRunsPerMonth: 30,
};

export const REVENUE_SCENARIOS = [
  { id: 'conservative', label: '保守', members: 1_000, conversion: 0.02 },
  { id: 'base', label: '基準', members: 10_000, conversion: 0.03 },
  { id: 'optimistic', label: '樂觀', members: 50_000, conversion: 0.05 },
] as const;

export const scenarioAssumptions = (scenario: (typeof REVENUE_SCENARIOS)[number]): RevenueAssumptions => ({
  ...BASE_ASSUMPTIONS,
  members: scenario.members,
  conversion: scenario.conversion,
});

/** 綠界一般賣家國內信用卡：每筆 max(2.75%, 5 元) 加 5% 營業稅，另收每筆 1 元（商業模式第 5 節） */
export const ecpayFee = (amount: number): number => Math.max(amount * 0.0275, 5) * 1.05 + 1;

const tokenCostTwd = (tokens: { input: number; output: number }, a: RevenueAssumptions): number =>
  ((tokens.input * a.usdPerMillion.input + tokens.output * a.usdPerMillion.output) / 1_000_000) * a.twdPerUsd;

export interface MonthlyRevenue {
  paid: number;
  plus: number;
  pro: number;
  revenue: number;
  fees: number;
  aiFree: number;
  aiPlus: number;
  aiPro: number;
  /** AI 摘要預熱加新聞判讀上限 */
  fixedLlm: number;
  /** 貢獻毛利：還沒扣主機、授權、人力 */
  contribution: number;
  costPerAsk: number;
  /** 扣掉免費會員攤到的 AI 對話成本後，每位付費者每月的淨貢獻 */
  netPerPayer: number;
}

/** 每月試算（全部以月繳計，商業模式假設 A4） */
export function simulateMonthlyRevenue(a: RevenueAssumptions): MonthlyRevenue {
  const paid = Math.round(a.members * a.conversion);
  const plus = Math.round(paid * a.plusShare);
  const pro = paid - plus;
  const plusPrice = planById('plus').price.monthly;
  const proPrice = planById('pro').price.monthly;
  const costPerAsk = tokenCostTwd(a.askTokens, a);
  const revenue = plus * plusPrice + pro * proPrice;
  const fees = plus * ecpayFee(plusPrice) + pro * ecpayFee(proPrice);
  const aiFree = (a.members - paid) * a.activeFreeShare * a.asksPerMonth.free * costPerAsk;
  const aiPlus = plus * a.asksPerMonth.plus * costPerAsk;
  const aiPro = pro * a.asksPerMonth.pro * costPerAsk;
  const fixedLlm = a.briefStocks * a.tradingDays * tokenCostTwd(a.briefTokens, a) + a.newsUsdPerRun * a.newsRunsPerMonth * a.twdPerUsd;
  const contribution = revenue - fees - aiFree - aiPlus - aiPro - fixedLlm;
  return {
    paid, plus, pro, revenue, fees, aiFree, aiPlus, aiPro, fixedLlm, contribution, costPerAsk,
    netPerPayer: paid ? (contribution + fixedLlm) / paid : 0,
  };
}

export interface UnitEconomics {
  planId: 'plus' | 'pro';
  price: number;
  fee: number;
  /** 平均用量（A6）的 LLM 成本 */
  llmCost: number;
  contribution: number;
  /** 用滿方案額度時的貢獻 */
  fullQuotaContribution: number;
  quota: number;
}

/** 每位付費者的單位經濟（月繳） */
export function unitEconomics(a: RevenueAssumptions): UnitEconomics[] {
  const costPerAsk = tokenCostTwd(a.askTokens, a);
  return (['plus', 'pro'] as const).map((planId) => {
    const price = planById(planId).price.monthly;
    const fee = ecpayFee(price);
    const quota = PLAN_LIMITS[planId].ask.member;
    const llmCost = a.asksPerMonth[planId] * costPerAsk;
    return { planId, price, fee, llmCost, contribution: price - fee - llmCost, fullQuotaContribution: price - fee - quota * costPerAsk, quota };
  });
}

/** 打平某個每月固定成本需要幾位付費者（用基準情境的每人淨貢獻） */
export const payersToCover = (monthlyCost: number, netPerPayer: number): number => (netPerPayer > 0 ? Math.ceil(monthlyCost / netPerPayer) : Infinity);
