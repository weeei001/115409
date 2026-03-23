import axios from 'axios';

/** 帶 HTTP 狀態碼的錯誤（僅在收到伺服器回應時設定 status） */
export class ApiRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
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

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      const raw = Array.isArray(data?.detail)
        ? (data.detail[0]?.msg ?? data.detail)
        : (data?.detail ?? `API 錯誤 (${status})`);
      const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return Promise.reject(new ApiRequestError(message, status));
    }
    if (error.request) {
      return Promise.reject(new ApiRequestError('無法連接伺服器，請確認後端服務是否運行中'));
    }
    return Promise.reject(error);
  }
);

export default apiClient;
