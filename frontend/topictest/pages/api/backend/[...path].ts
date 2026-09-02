import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * 同源代理主後端 API（/auth、/stocks、/news、/simulated-orders、/analyze…）。
 * 部署環境只對外開放一個埠（Next 3000，由 ngrok 轉發）時，瀏覽器改打 /api/backend/*，
 * 由 Next server 在內網轉發到後端，避免跨網域與第二個對外埠。
 * 上游基底僅由環境變數決定，不在 repo 內硬編碼網域。
 */
function getBackendBase(): string | null {
  return process.env.BACKEND_API_URL?.trim().replace(/\/$/, '') || null;
}

/** 後端第一層路徑白名單，避免任意路徑被當開放代理濫用 */
const ALLOWED_ROOT_SEGMENTS = new Set([
  'auth',
  'news',
  'stocks',
  'simulated-orders',
  'analyze',
  'health',
]);

/** 驗證並正規化 catch-all path；拒絕 ..、反斜線、空段與非白名單根路徑 */
function normalizeAndValidateProxyPath(raw: string): string | null {
  const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
  if (decoded.includes('//') || decoded.startsWith('/')) return null;
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '..' || s === '.')) return null;
  if (!ALLOWED_ROOT_SEGMENTS.has(segments[0])) return null;
  return segments.join('/');
}

const DEFAULT_TIMEOUT_MS = 600_000;

function getTimeoutMs(): number {
  const raw = process.env.BACKEND_API_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Next.js 16 建置會靜態分析並提取 `export const config`，只能用常數。
 * 600s 對齊前端 AI_TIMEOUT_MS（stockBehaviorAnalyze）。
 */
export const config = {
  maxDuration: 600,
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

/** 只複製安全的回應標頭（略過 hop-by-hop 與 content-length，改由串流決定） */
function copyResponseHeaders(upstream: Response, res: NextApiResponse): void {
  const ct = upstream.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  const cd = upstream.headers.get('content-disposition');
  if (cd) res.setHeader('Content-Disposition', cd);
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

  const base = getBackendBase();
  if (!base) {
    res.status(503).json({
      detail: [
        {
          type: 'config_error',
          msg: '未設定後端上游基底 URL：請設定 BACKEND_API_URL',
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
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  const headers: Record<string, string> = {
    Accept: (req.headers.accept as string) || 'application/json',
  };
  /** 前端以 localStorage token 走 Bearer，必須原樣帶到後端 */
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth) headers.Authorization = auth;

  const init: RequestInit = {
    method: req.method,
    signal: controller.signal,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['Content-Type'] = (req.headers['content-type'] as string) || 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(targetUrl, init);

    res.status(upstream.status);
    copyResponseHeaders(upstream, res);
    /** 避免中間層（ngrok／反向代理）把回應整包緩衝 */
    res.setHeader('X-Accel-Buffering', 'no');

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
    console.error('[backend-proxy]', targetUrl, err);
    if (!res.headersSent) {
      res.status(502).json({
        detail: [{ type: 'proxy_error', msg: `後端代理失敗：${message}` }],
      });
    } else {
      res.destroy(err instanceof Error ? err : new Error(message));
    }
  } finally {
    clearTimeout(timer);
  }
}
