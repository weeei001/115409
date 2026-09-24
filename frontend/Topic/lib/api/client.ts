import axios from 'axios';
import { API_BASE } from '../apiBase';
import { clearAuth, getToken } from '../auth/storage';
import { pickDetailMessage } from './errorDetail';

/** 帶 HTTP 狀態碼的錯誤（只有收到伺服器回應時才有 status） */
export class ApiRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiRequestError';
    this.status = status;
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }
}

/** 一般 GET 的逾時；AI 與長區間請求在呼叫端另設 */
export const API_DEFAULT_TIMEOUT_MS = 30_000;

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: API_DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

/** 沒收到回應時的訊息；「逾時」兩字 formatAdvisorError 會用來判斷 */
function messageForRequestError(error: { code?: string }): string {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return '連線逾時，請稍後再試；長區間圖表可以縮短日期區間。';
  }
  return '目前無法連線到伺服器，請稍後再試。';
}

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 401 && typeof window !== 'undefined' && error.config?.headers?.Authorization) {
        clearAuth();
      }
      return Promise.reject(new ApiRequestError(pickDetailMessage(data, status), status, { cause: error }));
    }
    if (error.request) {
      return Promise.reject(new ApiRequestError(messageForRequestError(error), undefined, { cause: error }));
    }
    return Promise.reject(error);
  },
);

export default apiClient;
