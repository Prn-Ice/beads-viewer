import { cached } from "@/lib/cache";
import { listGhRepos } from "@/lib/github";

const TTL_MS = 60_000;

// List the authenticated user's GitHub repos for the settings picker. gh
// failures are reported as a 200 with an `error` field so the UI can render
// the message inline.
export async function GET() {
  try {
    const repos = await cached("gh|available", TTL_MS, () => listGhRepos());
    return Response.json({ repos });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) });
  }
}
