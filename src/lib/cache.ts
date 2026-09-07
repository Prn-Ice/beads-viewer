const store = new Map<string, { value: unknown; expires: number }>();
const pending = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry && entry.expires > Date.now()) return entry.value as T;

  const inflight = pending.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = load().then(
    (value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    },
    (err) => {
      throw err;
    },
  );
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}

export function clearCache(): void {
  store.clear();
}
