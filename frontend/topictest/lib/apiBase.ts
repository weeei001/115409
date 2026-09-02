/**
 * 三個服務同網域不同路徑（見 deploy/nginx.conf）：
 *   /        前端
 *   /backend 主後端 API
 *   /rag     RAG 服務
 * 沒設環境變數時退回本機各自的埠。
 */
const strip = (v: string) => v.replace(/\/+$/, '');

export const API_BASE = strip(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');
export const RAG_BASE = strip(process.env.NEXT_PUBLIC_RAG_API_URL || 'http://localhost:8001');
