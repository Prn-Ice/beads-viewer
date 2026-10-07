const store = new Map<string, { value: unknown; expires: number }>();
const pending = new Map<string, Promise<unknown>>();
// Bumped by clearProject so a load that started before a change never stores
// its (possibly stale) result.
const generations = new Map<string, number>();

// Keys look like `kind|<project path>|...`; the second segment names the project.
function projectOf(key: string): string {
  return key.split("|")[1] ?? "";
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry && entry.expires > Date.now()) return entry.value as T;

  const inflight = pending.get(key);
  if (inflight) return inflight as Promise<T>;

  const project = projectOf(key);
  const generation = generations.get(project) ?? 0;
  const promise = load().then(
    (value) => {
      if ((generations.get(project) ?? 0) === generation) {
        store.set(key, { value, expires: Date.now() + ttlMs });
      }
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
    if (pending.get(key) === promise) pending.delete(key);
  }
}

// Drops every cached and in-flight entry for one project.
export function clearProject(path: string): void {
  generations.set(path, (generations.get(path) ?? 0) + 1);
  for (const key of [...store.keys()]) {
    if (projectOf(key) === path) store.delete(key);
  }
  for (const key of [...pending.keys()]) {
    if (projectOf(key) === path) pending.delete(key);
  }
}

export function clearCache(): void {
  store.clear();
}
