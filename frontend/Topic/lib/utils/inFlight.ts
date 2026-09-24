const inFlight = new Map<string, Promise<unknown>>();

/**
 * Collapse concurrent identical requests (e.g. React Strict Mode double mount).
 * Optional cacheMs keeps a short-lived result for read-heavy endpoints like symbol lists.
 */
export function dedupeFetch<T>(key: string, fn: () => Promise<T>, cacheMs = 0): Promise<T> {
  if (cacheMs > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) {
      return Promise.resolve(hit.data as T);
    }
  }

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn()
    .then((data) => {
      if (cacheMs > 0) cache.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

const cache = new Map<string, { data: unknown; at: number }>();
