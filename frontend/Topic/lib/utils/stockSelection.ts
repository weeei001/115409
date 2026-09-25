/** 一次貼上多個代號時的分隔符：空白、逗號、分號、直線 */
const BULK_DELIMITER_REGEX = /[\s,，;；|]+/;

export interface BulkSelectResult {
  added: string[];
  duplicates: string[];
  invalid: string[];
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

export function hasBulkDelimiter(text: string): boolean {
  return /[\s,，;；|]/.test(text);
}

export function parseBulkSymbolInput(input: string): string[] {
  if (!input.trim()) return [];
  return input
    .split(BULK_DELIMITER_REGEX)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

/** 多股比較：把貼上的代號加進已選清單，並分類成新增／重複／無效 */
export function applyBulkSelection({ input, currentSelected, allSymbols }: {
  input: string;
  currentSelected: string[];
  allSymbols: string[];
}): {
  nextSelected: string[];
  result: BulkSelectResult;
} {
  const known = new Set(allSymbols.map((symbol) => symbol.toUpperCase()));
  const nextSelected = [...currentSelected];
  const selected = new Set(currentSelected.map((symbol) => symbol.toUpperCase()));
  const seen = new Set<string>();
  const result: BulkSelectResult = { added: [], duplicates: [], invalid: [] };

  for (const symbol of parseBulkSymbolInput(input)) {
    if (seen.has(symbol)) {
      pushUnique(result.duplicates, symbol);
      continue;
    }
    seen.add(symbol);
    if (!known.has(symbol)) {
      pushUnique(result.invalid, symbol);
      continue;
    }
    if (selected.has(symbol)) {
      pushUnique(result.duplicates, symbol);
      continue;
    }
    selected.add(symbol);
    nextSelected.push(symbol);
    result.added.push(symbol);
  }

  return { nextSelected, result };
}
