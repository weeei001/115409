import type { SimulateParams } from './types';

/** 後端目前只開放 2330（openapi2.json symbol 說明） */
export const DEMO_SYMBOL = '2330';

/** openapi2.json：initial_cash 10,000 ~ 100,000,000 */
export const CASH_MIN = 10_000;
export const CASH_MAX = 100_000_000;

/** openapi2.json：confidence 整數 1（保守）～10（激進） */
export const CONFIDENCE_MIN = 1;
export const CONFIDENCE_MAX = 10;

export interface SimulateFormValues {
  start: string;
  end: string;
  /** 輸入框的文字（含千分位） */
  cash: string;
  confidence: number;
}

/** 預設約一個月；不用後端的 2025-01-01 起預設（沒快取時是 405 次 LLM 呼叫） */
export const DEFAULT_FORM: SimulateFormValues = {
  start: '2026-08-03',
  end: '2026-09-03',
  cash: '1,000,000',
  confidence: 5,
};

/** 初始資金最多幾位數；超過 CASH_MAX 的位數仍保留，交給驗證顯示錯誤 */
const CASH_MAX_DIGITS = 12;

const onlyDigits = (text: string) => text.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, CASH_MAX_DIGITS);

/** 輸入框即時加千分位；非數字字元直接丟掉 */
export function formatCashInput(text: string): string {
  const digits = onlyDigits(text);
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

export function parseCashInput(text: string): number | null {
  const digits = onlyDigits(text);
  return digits ? Number(digits) : null;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidYmd(value: string): boolean {
  const m = YMD.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

export type FormErrors = Partial<Record<'start' | 'end' | 'cash' | 'confidence', string>>;

export type FormValidation = { ok: true; params: SimulateParams } | { ok: false; errors: FormErrors };

/** 前端先擋掉明顯不合法的值；日期的有效範圍只有後端知道，超出時顯示後端的錯誤訊息 */
export function validateForm(values: SimulateFormValues): FormValidation {
  const errors: FormErrors = {};
  if (!isValidYmd(values.start)) errors.start = '請選擇起始日';
  if (!isValidYmd(values.end)) errors.end = '請選擇結束日';
  if (!errors.start && !errors.end && values.start > values.end) errors.end = '結束日不可早於起始日';

  const cash = parseCashInput(values.cash);
  if (cash === null) errors.cash = '請輸入初始資金';
  else if (cash < CASH_MIN || cash > CASH_MAX) errors.cash = `初始資金需介於 ${CASH_MIN.toLocaleString('en-US')}～${CASH_MAX.toLocaleString('en-US')} 元`;

  if (!Number.isInteger(values.confidence) || values.confidence < CONFIDENCE_MIN || values.confidence > CONFIDENCE_MAX) {
    errors.confidence = `風險偏好需為 ${CONFIDENCE_MIN}～${CONFIDENCE_MAX} 的整數`;
  }

  if (Object.keys(errors).length || cash === null) return { ok: false, errors };
  return {
    ok: true,
    params: { symbol: DEMO_SYMBOL, start: values.start, end: values.end, initialCash: cash, confidence: values.confidence },
  };
}
