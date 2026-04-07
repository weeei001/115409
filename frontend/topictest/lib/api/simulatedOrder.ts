import apiClient from './client';
import type {
  SimulatedOrderCreate,
  SimulatedOrderResponse,
  SimulatedOrderListResponse,
  SimulatedOrderCategoryProfitResponse,
} from '../types';

export async function createSimulatedOrder(body: SimulatedOrderCreate): Promise<SimulatedOrderResponse> {
  const { data } = await apiClient.post<SimulatedOrderResponse>('/simulated-orders/', body);
  return data;
}

export async function fetchSimulatedOrders(
  user_id: string,
  limit?: number
): Promise<SimulatedOrderListResponse> {
  const { data } = await apiClient.get<SimulatedOrderListResponse>('/simulated-orders/', {
    params: { user_id, ...(limit != null ? { limit } : {}) },
  });
  return data;
}

export async function fetchSimulatedProfitByCategory(
  user_id: string
): Promise<SimulatedOrderCategoryProfitResponse> {
  const { data } = await apiClient.get<SimulatedOrderCategoryProfitResponse>(
    '/simulated-orders/profit-by-category',
    { params: { user_id } }
  );
  return data;
}
