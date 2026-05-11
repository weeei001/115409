import React, { useMemo } from 'react';

import { CORE_MODE_PARAM_LABELS } from '../../lib/coreModeLabels';
import type { CoreModeParams, CoreModeWeightStrategyKey } from '../../lib/types/coreMode';

export const WEIGHT_STRATEGY_OPTIONS: Array<{ key: CoreModeWeightStrategyKey; label: string }> = [
  { key: 'balanced', label: '平衡型' },
  { key: 'technical_first', label: '技術優先' },
  { key: 'institutional_first', label: '法人籌碼優先' },
  { key: 'momentum_first', label: '動能優先' },
  { key: 'technical_institutional_balance', label: '技術 + 法人平衡' },
  { key: 'low_news', label: '低新聞權重' },
  { key: 'custom', label: '自訂' },
];

export const WEIGHT_GROUPS: Array<{ title: string; keys: Array<keyof CoreModeParams>; labels: Record<string, string> }> = [
  {
    title: '技術分數權重',
    keys: ['technical_ma_weight', 'technical_macd_weight', 'technical_rsi_weight', 'technical_kd_weight'],
    labels: {
      technical_ma_weight: CORE_MODE_PARAM_LABELS.technical_ma_weight,
      technical_macd_weight: CORE_MODE_PARAM_LABELS.technical_macd_weight,
      technical_rsi_weight: CORE_MODE_PARAM_LABELS.technical_rsi_weight,
      technical_kd_weight: CORE_MODE_PARAM_LABELS.technical_kd_weight,
    },
  },
  {
    title: '加權分數權重',
    keys: ['weighted_technical_weight', 'weighted_institutional_weight', 'weighted_news_weight', 'weighted_momentum_weight'],
    labels: {
      weighted_technical_weight: CORE_MODE_PARAM_LABELS.weighted_technical_weight,
      weighted_institutional_weight: CORE_MODE_PARAM_LABELS.weighted_institutional_weight,
      weighted_news_weight: CORE_MODE_PARAM_LABELS.weighted_news_weight,
      weighted_momentum_weight: CORE_MODE_PARAM_LABELS.weighted_momentum_weight,
    },
  },
  {
    title: '狀態分數權重',
    keys: ['state_weighted_score_weight', 'state_momentum_weight', 'state_institutional_weight'],
    labels: {
      state_weighted_score_weight: CORE_MODE_PARAM_LABELS.state_weighted_score_weight,
      state_momentum_weight: CORE_MODE_PARAM_LABELS.state_momentum_weight,
      state_institutional_weight: CORE_MODE_PARAM_LABELS.state_institutional_weight,
    },
  },
  {
    title: '綜合趨勢分數權重',
    keys: ['trend_state_weight', 'trend_shape_weight', 'trend_breakout_weight'],
    labels: {
      trend_state_weight: CORE_MODE_PARAM_LABELS.trend_state_weight,
      trend_shape_weight: CORE_MODE_PARAM_LABELS.trend_shape_weight,
      trend_breakout_weight: CORE_MODE_PARAM_LABELS.trend_breakout_weight,
    },
  },
  {
    title: '型態分數權重',
    keys: ['shape_breakout_weight', 'shape_slope_weight', 'shape_efficiency_weight', 'shape_pullback_weight'],
    labels: {
      shape_breakout_weight: CORE_MODE_PARAM_LABELS.shape_breakout_weight,
      shape_slope_weight: CORE_MODE_PARAM_LABELS.shape_slope_weight,
      shape_efficiency_weight: CORE_MODE_PARAM_LABELS.shape_efficiency_weight,
      shape_pullback_weight: CORE_MODE_PARAM_LABELS.shape_pullback_weight,
    },
  },
];

export function normalizePreview(
  params: CoreModeParams,
  keys: Array<keyof CoreModeParams>
): Array<{ key: keyof CoreModeParams; value: number }> {
  const total = keys.reduce((acc, key) => acc + Number(params[key] ?? 0), 0);
  if (total <= 0) {
    return keys.map((key) => ({ key, value: 0 }));
  }
  return keys.map((key) => ({ key, value: Number(params[key] ?? 0) / total }));
}

interface Props {
  params: CoreModeParams;
  strategy: CoreModeWeightStrategyKey;
  showAdvanced: boolean;
  onStrategyChange: (strategy: CoreModeWeightStrategyKey) => void;
  onWeightChange: (key: keyof CoreModeParams, value: number) => void;
  onToggleAdvanced: () => void;
}

export const CoreModeWeightPanel: React.FC<Props> = ({
  params,
  strategy,
  showAdvanced,
  onStrategyChange,
  onWeightChange,
  onToggleAdvanced,
}) => {
  const previews = useMemo(() => {
    return WEIGHT_GROUPS.map((group) => ({
      title: group.title,
      values: normalizePreview(params, group.keys),
      labels: group.labels,
    }));
  }, [params]);

  return (
    <section className="bento-cell p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">權重策略</h2>
          <p className="text-xs text-[var(--color-text-muted)]">調整技術、籌碼、動能、型態等分數在規則模型中的占比。</p>
        </div>
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
        >
          {showAdvanced ? '收合進階模式' : '打開進階模式'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">權重策略</span>
          <select
            value={strategy}
            onChange={(e) => onStrategyChange(e.target.value as CoreModeWeightStrategyKey)}
            className="ui-input"
          >
            {WEIGHT_STRATEGY_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm text-[var(--color-text-secondary)]">
          目前策略：
          <span className="ml-1 font-semibold text-[var(--color-text-primary)]">
            {WEIGHT_STRATEGY_OPTIONS.find((option) => option.key === strategy)?.label ?? '自訂'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {previews.map((group) => (
          <div key={group.title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
            <p className="text-sm font-semibold">{group.title}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
              {group.values.map((item) => (
                <span key={String(item.key)} className="rounded-full border border-[var(--color-border)] px-2 py-1">
                  {group.labels[String(item.key)]}: {(item.value * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAdvanced ? (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {WEIGHT_GROUPS.map((group) => (
            <div key={group.title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
              <p className="text-sm font-semibold">{group.title}</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.keys.map((key) => (
                  <label key={String(key)} className="text-sm">
                    <span className="mb-1 block text-xs text-[var(--color-text-muted)]">{group.labels[String(key)]}</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={Number(params[key]).toFixed(2)}
                      onChange={(e) => onWeightChange(key, Number(e.target.value))}
                      className="ui-input"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};
