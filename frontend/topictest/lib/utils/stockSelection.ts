import type { BulkSelectResult } from '../types';

interface ApplyBulkSelectionInput {
  input: string;
  currentSelected: string[];
  allSymbols: string[];
  maxSelection: number;
}

export interface ApplyBulkSelectionOutput {
  nextSelected: string[];
  result: BulkSelectResult;
}

const BULK_DELIMITER_REGEX = /[\s,，;；|]+/;

function pushUnique(target: string[], value: string): void {
  if (!value) return;
  if (!target.includes(value)) target.push(value);
}

export function parseBulkSymbolInput(input: string): string[] {
  if (!input.trim()) return [];
  return input
    .split(BULK_DELIMITER_REGEX)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

export function applyBulkSelection({
  input,
  currentSelected,
  allSymbols,
  maxSelection,
}: ApplyBulkSelectionInput): ApplyBulkSelectionOutput {
  const parsed = parseBulkSymbolInput(input);
  const knownSymbols = new Set(allSymbols.map((symbol) => symbol.toUpperCase()));
  const nextSelected = [...currentSelected];
  const selectedSet = new Set(currentSelected.map((symbol) => symbol.toUpperCase()));
  const seenInInput = new Set<string>();

  const result: BulkSelectResult = {
    added: [],
    duplicates: [],
    invalid: [],
    overflow: [],
  };

  for (const symbol of parsed) {
    if (seenInInput.has(symbol)) {
      pushUnique(result.duplicates, symbol);
      continue;
    }
    seenInInput.add(symbol);

    if (!knownSymbols.has(symbol)) {
      pushUnique(result.invalid, symbol);
      continue;
    }

    if (selectedSet.has(symbol)) {
      pushUnique(result.duplicates, symbol);
      continue;
    }

    if (nextSelected.length >= maxSelection) {
      pushUnique(result.overflow, symbol);
      continue;
    }

    selectedSet.add(symbol);
    nextSelected.push(symbol);
    result.added.push(symbol);
  }

  return { nextSelected, result };
}
