import { clearCache } from "@/lib/cache";
import { forceSyncGithubRepos } from "@/lib/github";

export async function POST() {
  clearCache();
  // Fire-and-forget the forced re-sync; don't block the refresh on git fetches.
  // Subsequent per-repo requests join these in-flight syncs via the inflight map.
  void forceSyncGithubRepos();
  return Response.json({ ok: true });
}
