/**
 * 驗證登入後導向路徑，僅允許站內相對路徑，避免 open redirect。
 */
export function safeReturnUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.includes('://')) return null;
  return trimmed;
}
