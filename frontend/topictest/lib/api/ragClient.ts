import axios from 'axios';
import { ApiRequestError } from './client';
import { pickDetailMessage } from './errorDetail';
import { getRagApiTimeoutMs } from '../ragTimeout';

function attachRagErrorInterceptor(instance: ReturnType<typeof axios.create>) {
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        const { status, data } = error.response;
        const message =
          data !== undefined && data !== null && typeof data === 'object'
            ? pickDetailMessage(data, status)
            : `RAG API 錯誤 (${status})`;
        return Promise.reject(new ApiRequestError(message, status, { cause: error }));
      }
      if (error.request) {
        return Promise.reject(
          new ApiRequestError('無法連接 RAG 服務，請稍後再試', undefined, { cause: error })
        );
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
