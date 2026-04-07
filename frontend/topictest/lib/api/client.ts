import axios from 'axios';
import { clearAuth, getToken } from '../auth/storage';
import { pickDetailMessage } from './errorDetail';

/** 帶 HTTP 狀態碼的錯誤（僅在收到伺服器回應時設定 status） */
export class ApiRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiRequestError';
    this.status = status;
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }
}

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      const errConfig = error.config;
      if (status === 401 && typeof window !== 'undefined' && errConfig?.headers?.Authorization) {
        clearAuth();
      }
      const message =
        data !== undefined && data !== null && typeof data === 'object'
          ? pickDetailMessage(data, status)
          : `API 錯誤 (${status})`;
      return Promise.reject(
        new ApiRequestError(message, status, { cause: error })
      );
    }
    if (error.request) {
      return Promise.reject(
        new ApiRequestError('無法連接伺服器，請確認後端服務是否運行中', undefined, {
          cause: error,
        })
      );
    }
    return Promise.reject(error);
  }
);

export default apiClient;
