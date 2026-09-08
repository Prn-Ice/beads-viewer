import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import type { BeadsIssue } from "@/lib/types";

const TTL_MS = 5_000;

function findProjectPath(id: string): string | null {
  const path = decodeURIComponent(id);
  return existsSync(join(path, ".beads")) ? path : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const { id, issueId } = await params;
  const path = findProjectPath(id);
  if (!path) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }

  try {
    const relationships = new URL(request.url).searchParams.get("relationships") === "all";
    const issue = await cached<BeadsIssue>(`show|${path}|${issueId}|${relationships}`, TTL_MS, async () => {
      const args = ["show", issueId];
      if (relationships) args.push("--include-dependents");
      const data = await runBd(args, path);
      const issues = data as BeadsIssue[];
      if (issues.length === 0) throw new Error("not found");
      return issues[0];
    });
    return Response.json(issue);
  } catch {
    return Response.json({ error: "issue not found" }, { status: 404 });
  }
}
