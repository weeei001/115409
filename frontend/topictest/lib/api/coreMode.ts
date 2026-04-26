import apiClient from './client';
import type {
  CoreModeDecisionRequest,
  CoreModeDecisionResponse,
  CoreModePresetSaveRequest,
  CoreModePresetsResponse,
  CoreModeRunRequest,
  CoreModeRunResponse,
  CoreModeSchemaResponse,
} from '../types/coreMode';

export async function fetchCoreModeSchema(): Promise<CoreModeSchemaResponse> {
  const { data } = await apiClient.get<CoreModeSchemaResponse>('/api/backtest/core-mode/schema');
  return data;
}

export async function fetchCoreModePresets(): Promise<CoreModePresetsResponse> {
  const { data } = await apiClient.get<CoreModePresetsResponse>('/core-mode/presets');
  return data;
}

export async function saveCoreModePreset(req: CoreModePresetSaveRequest): Promise<CoreModePresetsResponse> {
  const { data } = await apiClient.post<CoreModePresetsResponse>('/api/backtest/presets', req);
  return data;
}

export async function activateCoreModePreset(presetId: string): Promise<CoreModePresetsResponse> {
  const { data } = await apiClient.post<CoreModePresetsResponse>(
    `/core-mode/presets/${encodeURIComponent(presetId)}/activate`,
    {}
  );
  return data;
}

export async function runCoreModeBacktest(req: CoreModeRunRequest): Promise<CoreModeRunResponse> {
  const { data } = await apiClient.post<CoreModeRunResponse>('/api/backtest/core-mode/run', req, {
    timeout: 240000,
  });
  return data;
}

export async function fetchCoreModeDecision(req: CoreModeDecisionRequest): Promise<CoreModeDecisionResponse> {
  const payload: CoreModeDecisionRequest = {
    use_active_preset: true,
    ...req,
    symbol: req.symbol.trim().toUpperCase(),
  };
  const { data } = await apiClient.post<CoreModeDecisionResponse>('/core-mode/decision', payload, {
    timeout: 15000,
  });
  return data;
}
