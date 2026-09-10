import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import type { BeadsIssue } from "@/lib/types";
import {
  analyzeUnblocks,
  parseReadyExplain,
  unblockCandidates,
  type ReadyExplain,
  type UnblocksAnalysis,
} from "@/lib/unblocks";

const TTL_MS = 5_000;

// Read-only, on-demand: the Dependencies tab disclosure calls this only when
// the user opens it. No polling, no mutations — completing the root issue is
// never simulated, only the observed snapshot is explained.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const { id, issueId } = await params;
  const path = decodeURIComponent(id);
  if (!existsSync(join(path, ".beads"))) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }

  // The root record reuses the same bd call (and cache entry) as the drawer's
  // relationships=all load: hydrated dependents carry the edge types.
  let root: BeadsIssue;
  try {
    root = await cached<BeadsIssue>(`show|${path}|${issueId}|all`, TTL_MS, async () => {
      const data = await runBd(["show", issueId, "--include-dependents"], path);
      const issues = data as BeadsIssue[];
      if (issues.length === 0) throw new Error("not found");
      return issues[0];
    });
  } catch {
    return Response.json({ error: "issue not found" }, { status: 404 });
  }

  // The project readiness snapshot. Errors and shape drift are reported
  // explicitly as project-level verification instead of failing the request.
  let explain: ReadyExplain | null = null;
  let explainNote: string | undefined;
  try {
    const raw = await cached(`unblocks-explain|${path}`, TTL_MS, async () =>
      runBd(["ready", "--explain", "--limit", "0"], path),
    );
    const parsed = parseReadyExplain(raw);
    if (parsed) {
      explain = parsed;
    } else {
      explainNote = "Readiness data came back in an unexpected format; estimates need a manual check.";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    explainNote = `Couldn't load readiness data (${message}); estimates need a manual check.`;
  }

  // Full candidate records in one batch show (bd 1.2.2 accepts multiple ids
  // and returns found records, printing only stderr hints for missing ones).
  // Partial failures stay per-candidate: unloadable records become
  // verification results, never false positives.
  const records = new Map<string, BeadsIssue>();
  const { list } = unblockCandidates(root);
  const ids = list.map((dep) => dep.id);
  if (ids.length > 0) {
    try {
      const key = `show-batch|${path}|${[...ids].sort().join(",")}`;
      const raw = await cached<unknown>(key, TTL_MS, async () => runBd(["show", ...ids], path));
      for (const entry of raw as BeadsIssue[]) {
        if (entry && typeof entry.id === "string") records.set(entry.id, entry);
      }
    } catch {
      // records stays empty: every candidate is reported as needing verification.
    }
  }

  const analysis: UnblocksAnalysis = analyzeUnblocks(root, explain, records, Date.now(), explainNote);
  return Response.json({ fetchedAt: Date.now(), ...analysis });
}