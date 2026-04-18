import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getRagApiTimeoutMs } from '../../../lib/ragTimeout';

/**
 * 同源代理 RAG API（取代 next.config rewrites 之外部轉發，避免 dev 長連線出現 ECONNRESET / socket hang up）。
 * 上游基底僅允許環境變數設定，避免 repo 內硬編碼測試網域。
 */
function getRagBase(): string | null {
  const a = process.env.NEXT_PUBLIC_RAG_API_BASE_URL?.trim().replace(/\/$/, '');
  const b = process.env.RAG_API_BASE_URL?.trim().replace(/\/$/, '');
  return a || b || null;
}

/** 僅允許轉發至上游的固定端點，避免任意路徑被當開放代理濫用 */
const ALLOWED_UPSTREAM_PATHS = new Set(['api/ask']);

/**
 * 驗證並正規化 catch-all path；拒絕 ..、反斜線、空段與非白名單路徑。
 */
function normalizeAndValidateProxyPath(raw: string): string | null {
  const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
  if (decoded.includes('//') || decoded.startsWith('/')) return null;
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '..' || s === '.')) return null;
  const joined = segments.join('/');
  const normalized = joined.replace(/\/+$/, '');
  if (!ALLOWED_UPSTREAM_PATHS.has(normalized)) return null;
  return normalized;
}

const timeoutMs = getRagApiTimeoutMs();
/**
 * Next.js 16 建置會靜態分析並提取 `export const config`；不可使用執行期運算或非常數識別（否則 hadUnsupportedValue → 建置失敗）。
 * 與 NEXT_PUBLIC_RAG_API_TIMEOUT_MS 上限對齊（預設 120s，若設 300000ms 則改為 300）。
 * 實際執行仍以下方 `timeoutMs` 為準。
 */
export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

function copyHopByHopSafeHeaders(upstream: Response, res: NextApiResponse): void {
  const ct = upstream.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  const cc = upstream.headers.get('cache-control');
  if (cc) res.setHeader('Cache-Control', cc);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = req.query.path;
  const pathStr = Array.isArray(segments) ? segments.join('/') : segments || '';
  if (!pathStr) {
    res.status(400).json({ detail: '缺少路徑' });
    return;
  }

  const safePath = normalizeAndValidateProxyPath(pathStr);
  if (!safePath) {
    res.status(400).json({ detail: '不允許的代理路徑' });
    return;
  }

  const base = getRagBase();
  if (!base) {
    res.status(503).json({
      detail: [
        {
          type: 'config_error',
          msg: '未設定 RAG 上游基底 URL：請設定 NEXT_PUBLIC_RAG_API_BASE_URL 或 RAG_API_BASE_URL',
        },
      ],
    });
    return;
  }

  const rawUrl = req.url ?? '';
  const qIdx = rawUrl.indexOf('?');
  const qs = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  const targetUrl = `${base}/${safePath}${qs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: (req.headers.accept as string) || 'application/json',
  };

  const init: RequestInit = {
    method: req.method,
    signal: controller.signal,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['Content-Type'] =
      (req.headers['content-type'] as string) || 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(targetUrl, init);

    res.status(upstream.status);
    copyHopByHopSafeHeaders(upstream, res);
    /** 盡量避免反向代理把 chunked response 緩衝成整包（須蓋過上游可能帶的 Cache-Control） */
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    if (upstream.body) {
      type ResWithFlush = NextApiResponse & { flushHeaders?: () => void };
      const rw = res as ResWithFlush;
      if (typeof rw.flushHeaders === 'function') {
        rw.flushHeaders();
      }
      const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
      await pipeline(nodeStream, res);
      return;
    }

    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rag-proxy]', targetUrl, err);
    if (!res.headersSent) {
      res.status(502).json({
        detail: [{ type: 'proxy_error', msg: `RAG 代理失敗：${message}` }],
      });
    } else {
      res.destroy(err instanceof Error ? err : new Error(message));
    }
  } finally {
    clearTimeout(timer);
  }
}
