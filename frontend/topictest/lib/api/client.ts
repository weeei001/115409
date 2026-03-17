import axios from 'axios';

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
      const message =
        data?.detail?.[0]?.msg || data?.detail || `API 錯誤 (${status})`;
      return Promise.reject(new Error(message));
    }
    if (error.request) {
      return Promise.reject(new Error('無法連接伺服器，請確認後端服務是否運行中'));
    }
    return Promise.reject(error);
  }
);

export default apiClient;
