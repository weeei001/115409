import axios from 'axios';
import { ApiRequestError } from './client';
import { getRagApiTimeoutMs } from '../ragTimeout';

function attachRagErrorInterceptor(instance: ReturnType<typeof axios.create>) {
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        const { status, data } = error.response;
        const raw = Array.isArray(data?.detail)
          ? (data.detail[0]?.msg ?? data.detail)
          : (data?.detail ?? `RAG API 錯誤 (${status})`);
        const message = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return Promise.reject(new ApiRequestError(message, status));
      }
      if (error.request) {
        return Promise.reject(new ApiRequestError('無法連接 RAG 服務，請稍後再試'));
      }
      return Promise.reject(error);
    }
  );
}

const ragClient = axios.create({
  timeout: getRagApiTimeoutMs(),
  headers: { 'Content-Type': 'application/json' },
});

attachRagErrorInterceptor(ragClient);

export default ragClient;
