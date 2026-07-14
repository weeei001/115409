import type { NextConfig } from "next";

/** RAG 同源代理改由 pages/api/rag-proxy/[...path].ts 處理（避免 rewrites 外連長請求 ECONNRESET） */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
