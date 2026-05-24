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

/** 一般 GET（股價、法人等）；AI rag/ai 在 stockBehaviorAnalyze 另設 90s/120s */
export const API_DEFAULT_TIMEOUT_MS = 30_000;

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  timeout: API_DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

function messageForRequestError(error: {
  code?: string;
  message?: string;
  config?: { timeout?: number; url?: string };
}): string {
  const timeoutMs = error.config?.timeout ?? API_DEFAULT_TIMEOUT_MS;
  const timeoutSec = Math.round(timeoutMs / 1000);
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return `請求逾時（已等待約 ${timeoutSec} 秒）。後端可能仍在處理（尤其 AI 分析或長區間圖表），請稍後再試或縮短日期區間。`;
  }
  if (error.message === 'Network Error') {
    return '網路錯誤（常見為 CORS、連線中斷或代理阻擋）。請確認 API 網址為根路徑（不含 /docs），且後端允許此網域跨域存取。';
  }
  return '無法連接伺服器，請確認後端服務是否運行中';
}

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
        new ApiRequestError(messageForRequestError(error), undefined, {
          cause: error,
        })
      );
    }
    return Promise.reject(error);
  }
);

export default apiClient;
