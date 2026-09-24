import apiClient from './client';
import type {
  AvailableLotsResponse,
  SimulatedOrderCategoryProfitResponse,
  SimulatedOrderCreate,
  SimulatedOrderListResponse,
  SimulatedOrderResponse,
} from '../types/api';

/** openapi: POST /simulated-orders/ */
export async function createSimulatedOrder(body: SimulatedOrderCreate): Promise<SimulatedOrderResponse> {
  const { data } = await apiClient.post<SimulatedOrderResponse>('/simulated-orders/', body);
  return data;
}

/** openapi: GET /simulated-orders/（limit 最大 200） */
export async function fetchSimulatedOrders(user_id: string, limit?: number): Promise<SimulatedOrderListResponse> {
  const { data } = await apiClient.get<SimulatedOrderListResponse>('/simulated-orders/', {
    params: { user_id, ...(limit != null ? { limit } : {}) },
  });
  return data;
}

/** openapi: GET /simulated-orders/profit-by-category */
export async function fetchSimulatedProfitByCategory(user_id: string): Promise<SimulatedOrderCategoryProfitResponse> {
  const { data } = await apiClient.get<SimulatedOrderCategoryProfitResponse>('/simulated-orders/profit-by-category', { params: { user_id } });
  return data;
}

/** openapi: GET /simulated-orders/available-lots */
export async function fetchAvailableLots(user_id: string, symbol: string): Promise<AvailableLotsResponse> {
  const { data } = await apiClient.get<AvailableLotsResponse>('/simulated-orders/available-lots', { params: { user_id, symbol } });
  return data;
}
