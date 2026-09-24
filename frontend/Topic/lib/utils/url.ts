/** 只接受有主機名、不含帳密與空白／角括號的 http(s) 網址；其餘回 null */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password || /[\s<>]/.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}
