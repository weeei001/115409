/** All frontend APIs are served by the v2 backend. */
const strip = (v: string) => v.replace(/\/+$/, '');
const defaultApiBase = process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8002' : 'http://127.0.0.1:8003';

export const API_BASE = strip(process.env.NEXT_PUBLIC_API_URL || defaultApiBase);
