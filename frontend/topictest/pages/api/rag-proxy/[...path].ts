import type { NextApiRequest, NextApiResponse } from 'next';
import { getRagApiTimeoutMs } from '../../../lib/ragTimeout';

/**
 * 同源代理 RAG API（取代 next.config rewrites 之外部轉發，避免 dev 長連線出現 ECONNRESET / socket hang up）。
 */
const RAG_BASE =
  process.env.NEXT_PUBLIC_RAG_API_BASE_URL?.replace(/\/$/, '') ||
  process.env.RAG_API_BASE_URL?.replace(/\/$/, '') ||
  'https://ragggggggg.bobhsu.dpdns.org/X9k2mR_rag';

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
/** 秒；與 getRagApiTimeoutMs() 對齊（部署至 Vercel 等 Serverless 時避免函式先於上游被砍）。本機若見約 60s 的 504，多為上游／Nginx／CDN 逾時。 */
const maxDurationSec = Math.ceil(timeoutMs / 1000);

export const config = {
  maxDuration: maxDurationSec,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

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

  const rawUrl = req.url ?? '';
  const qIdx = rawUrl.indexOf('?');
  const qs = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  const targetUrl = `${RAG_BASE}/${safePath}${qs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

    const upstream = await fetch(targetUrl, init);
    clearTimeout(timer);

    const ct = upstream.headers.get('content-type');
    if (ct) {
      res.setHeader('Content-Type', ct);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buf);
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rag-proxy]', targetUrl, err);
    res.status(502).json({
      detail: [{ type: 'proxy_error', msg: `RAG 代理失敗：${message}` }],
    });
  }
}
