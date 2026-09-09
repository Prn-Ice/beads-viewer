"use client";

import { useState } from "react";
import { LoaderCircleIcon, SettingsIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SidebarGroupAction } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

interface AvailableRepo {
  slug: string;
  private: boolean;
}

interface ConfigResponse {
  repos: string[];
  source: "env" | "file" | "none";
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      repos: AvailableRepo[];
      configured: string[];
      envManaged: boolean;
    };

// Row list: configured slugs first (so stale entries not present in the gh
// list stay reachable for unchecking), then remaining available repos.
function buildRows(
  configured: string[],
  repos: AvailableRepo[],
): { slug: string; private: boolean; inGh: boolean }[] {
  const bySlug = new Map(repos.map((repo) => [repo.slug, repo]));
  const rows: { slug: string; private: boolean; inGh: boolean }[] = [];
  const seen = new Set<string>();
  for (const slug of configured) {
    rows.push({ slug, private: bySlug.get(slug)?.private ?? false, inGh: bySlug.has(slug) });
    seen.add(slug);
  }
  for (const repo of repos) {
    if (seen.has(repo.slug)) continue;
    rows.push({ slug: repo.slug, private: repo.private, inGh: true });
  }
  return rows;
}

function toggle(list: string[], slug: string, on: boolean): string[] {
  return on ? (list.includes(slug) ? list : [...list, slug]) : list.filter((s) => s !== slug);
}

export function GithubSettings({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setState({ status: "loading" });
    setError(null);
    (async () => {
      try {
        const [availRes, configRes] = await Promise.all([
          fetch("/api/github/available"),
          fetch("/api/github/config"),
        ]);
        const avail = (await availRes.json()) as { repos?: AvailableRepo[]; error?: string };
        const config = (await configRes.json()) as ConfigResponse;
        if (!availRes.ok || avail.error) {
          setState({ status: "error", message: avail.error ?? `HTTP ${availRes.status}` });
          return;
        }
        setState({
          status: "ready",
          repos: avail.repos ?? [],
          configured: config.repos,
          envManaged: config.source === "env",
        });
        setSelected(config.repos);
      } catch {
        setState({ status: "error", message: "failed to load settings" });
      }
    })();
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
  }

  const ready = state.status === "ready";
  const dirty =
    ready &&
    !state.envManaged &&
    (state.configured.length !== selected.length ||
      state.configured.some((slug) => !selected.includes(slug)));

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/github/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: selected }),
      });
      const body = (await res.json().catch(() => null)) as ConfigResponse & { error?: string } | null;
      if (res.status === 409) {
        // The env var took over (or was set meanwhile): show the notice.
        setState({ status: "ready", repos: state.repos, configured: selected, envManaged: true });
        return;
      }
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
      setOpen(false);
    } catch {
      setError("failed to save");
    } finally {
      setSaving(false);
    }
  }

  const rows = ready ? buildRows(state.configured, state.repos) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SidebarGroupAction
        type="button"
        aria-label="GitHub repo settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <SettingsIcon aria-hidden />
      </SidebarGroupAction>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-sm"
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle>GitHub repositories</SheetTitle>
          <SheetDescription>
            Pick which GitHub repos to mirror as beads projects. Changes apply without restarting.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {state.status === "loading" && (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading GitHub repos">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
          )}
          {state.status === "error" && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{state.message}</span>
              <Button variant="ghost" size="xs" onClick={load}>
                Retry
              </Button>
            </div>
          )}
          {state.status === "ready" && state.envManaged && (
            <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Repos are set by <code className="font-mono">BEADS_GITHUB_REPOS</code> — edit your
              environment to change them.
            </p>
          )}
          {state.status === "ready" && rows.length === 0 && !state.envManaged && (
            <p className="text-sm text-muted-foreground">
              No GitHub repos found. Run <code className="font-mono">gh auth login</code> to list
              your repos.
            </p>
          )}
          {state.status === "ready" && rows.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {rows.map((row) => (
                <li key={row.slug}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50 focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-ring">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.slug)}
                      disabled={state.envManaged}
                      onChange={(event) =>
                        setSelected((current) => toggle(current, row.slug, event.target.checked))
                      }
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {row.slug}
                      {row.private && <span className="text-muted-foreground"> (private)</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <SheetFooter className="border-t">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            onClick={save}
            disabled={saving || !ready || state.envManaged || !dirty}
          >
            {saving ? (
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            ) : (
              "Save"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
