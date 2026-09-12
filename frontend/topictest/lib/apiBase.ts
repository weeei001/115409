/** All frontend APIs are served by the v2 backend. */
const strip = (v: string) => v.replace(/\/+$/, '');

export const API_BASE = strip(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8003');
