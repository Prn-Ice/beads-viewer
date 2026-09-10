"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Board } from "@/components/board";
import {
  DashboardHeader,
} from "@/components/dashboard-header";
import {
  DashboardSidebar,
  githubEntryFromResponse,
  type GithubRepoEntry,
} from "@/components/dashboard-sidebar";
import { observeSession, resetSession, type ObservedSession } from "@/lib/session-changes";
import { readDeepLink, withDeepLink } from "@/lib/navigation";
import { IssueDrawer } from "@/components/issue-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  applyFilters,
  applyViewToParams,
  facetChoices,
  parseViewState,
  type FilterState,
  type Scope,
  type ViewState,
} from "@/lib/filters";
import type { IssueListResponse, Project } from "@/lib/types";

const POLL_MS = 3_000;

interface LoadedBoard {
  projectId: string;
  data: IssueListResponse;
}

export function Dashboard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [githubRepos, setGithubRepos] = useState<GithubRepoEntry[]>([]);
  // True once the first full GitHub sweep finished, so a deep link to a
  // not-yet-loaded remote project does not flash the "not found" banner.
  const [githubLoaded, setGithubLoaded] = useState(false);
  const [board, setBoard] = useState<LoadedBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessions, setSessions] = useState<Record<string, ObservedSession>>({});
  // Drawer Back trail: stack of issue ids reached by relationship navigation in
  // the current project. Tracked per project so a stale trail can never bleed
  // across projects (browser Back/Forward included); card/attention opens,
  // closes, and direct loads all start without a trail.
  const [trailProject, setTrailProject] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  // Kept here so in-drawer navigation (relationship links, Back) does not reset
  // the active tab when the drawer content remounts per issue.
  const [drawerTab, setDrawerTab] = useState("overview");
  const drawerReturnFocus = useRef<HTMLElement | null>(null);

  // Search, scope, and the facet filters live in the URL (see lib/filters.ts),
  // so the view state is derived from the query string on every render.
  const view = parseViewState(searchParams);

  // One history entry per search edit, not per keystroke.
  const searchSessionRef = useRef(false);

  useEffect(() => {
    function resetDrawerSession() {
      searchSessionRef.current = false;
      setTrail([]);
      setTrailProject(null);
      setDrawerTab("overview");
    }
    window.addEventListener("popstate", resetDrawerSession);
    return () => window.removeEventListener("popstate", resetDrawerSession);
  }, []);

  const { project: urlProject, issue: urlIssue } = readDeepLink(searchParams);

  const githubProjects = githubRepos.flatMap((entry) =>
    entry.state === "ok" && entry.project ? [entry.project] : [],
  );
  const allProjects = [...(projects ?? []), ...githubProjects];

  // Derive selection from the URL deep-link params so Back/Forward and direct
  // loads synchronize automatically. The default (or invalid) project is
  // selected without writing to the URL so it does not flood history; an
  // invalid project normalizes to the default without leaking the issue into it.
  // While GitHub repos may still be loading, an unmatched link selects nothing
  // yet rather than briefly falling back to the wrong project.
  const validProject =
    urlProject && allProjects.some((project) => project.path === urlProject) ? urlProject : null;
  const awaitingLink =
    urlProject != null && validProject === null && (projects === null || !githubLoaded);
  const selectedId = awaitingLink
    ? null
    : (validProject ?? projects?.[0]?.path ?? githubProjects[0]?.path ?? null);
  const drawerIssueId = validProject ? urlIssue : null;
  const trailActive = trailProject === selectedId;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Project[]) => {
        if (!cancelled) setProjects(data);
      })
      .catch(() => {
        if (!cancelled) setProjects((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // GitHub repos load one at a time so they stream into the sidebar as each
  // clone syncs, and never block the local projects above. Poll ticks skip a
  // sweep already in flight (`running` survives re-renders); `dead` is reset
  // when a sweep starts because React StrictMode unmounts and remounts the
  // component in dev, and the ref would otherwise stay dead forever.
  const githubSweep = useRef({ running: false, dead: false });
  useEffect(() => {
    const sweep = githubSweep.current;
    return () => {
      sweep.dead = true;
    };
  }, []);

  useEffect(() => {
    const sweep = githubSweep.current;
    if (sweep.running) return;
    sweep.running = true;
    sweep.dead = false;
    (async () => {
      try {
        const listRes = await fetch("/api/github/repos");
        if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
        const refs = (await listRes.json()) as { slug: string }[];
        if (sweep.dead) return;
        // Keep existing entries (no spinner flicker on refresh); new repos
        // enter as loading, removed repos drop out.
        setGithubRepos((current) =>
          refs.map(
            (ref) =>
              current.find((entry) => entry.slug === ref.slug) ?? {
                slug: ref.slug,
                state: "loading" as const,
              },
          ),
        );
        for (const ref of refs) {
          let entry: GithubRepoEntry;
          try {
            const res = await fetch(`/api/github/repos/${encodeURIComponent(ref.slug)}`);
            entry = githubEntryFromResponse(ref.slug, res, await res.json());
          } catch {
            entry = { slug: ref.slug, state: "error", message: "couldn't fetch" };
          }
          if (sweep.dead) return;
          setGithubRepos((current) => current.map((e) => (e.slug === ref.slug ? entry : e)));
        }
      } catch {
        // The repo list itself failed; keep previous entries and retry next tick.
      } finally {
        sweep.running = false;
        if (!sweep.dead) setGithubLoaded(true);
      }
    })();
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(selectedId)}/issues?scope=${view.scope}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load issues (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: IssueListResponse) => {
        if (!cancelled) {
          setBoard({ projectId: selectedId, data });
          setBoardError(null);
          const now = Date.now();
          setSessions((current) => ({ ...current, [selectedId]: observeSession(current[selectedId], data.issues, now) }));
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setBoardError(err.message);
          setBoard(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, view.scope, reloadKey]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    function updatePolling() {
      clearInterval(timer);
      if (document.visibilityState === "visible") {
        timer = setInterval(() => setReloadKey((k) => k + 1), POLL_MS);
      }
    }
    function onVisibilityChange() {
      updatePolling();
      if (document.visibilityState === "visible") {
        setReloadKey((k) => k + 1);
      }
    }
    updatePolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function refresh() {
    await fetch("/api/refresh", { method: "POST" }).catch(() => {});
    setReloadKey((k) => k + 1);
  }

  // After the settings panel saves a new repo selection, drop the current
  // entries and re-run the sweep so removed repos disappear and new ones
  // stream in as loading rows.
  function onGithubSaved() {
    setGithubRepos([]);
    setReloadKey((k) => k + 1);
  }

  // Reads the live query string instead of the hook's searchParams so rapid
  // changes (typing, filter toggles) never build a URL from a stale snapshot.
  function liveParams(): URLSearchParams {
    return new URLSearchParams(window.location.search);
  }

  function urlWithView(nextView: ViewState): string {
    const next = applyViewToParams(liveParams(), nextView);
    const query = next.toString();
    return `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  }

  function selectScope(scope: Scope) {
    if (scope === view.scope) return;
    window.history.pushState(null, "", urlWithView({ ...parseViewState(liveParams()), scope }));
  }

  function toggleFilter(partial: Partial<FilterState>) {
    const current = parseViewState(liveParams());
    window.history.pushState(null, "", urlWithView({ ...current, filters: { ...current.filters, ...partial } }));
  }

  function onSearchChange(value: string) {
    const url = urlWithView({ ...parseViewState(liveParams()), search: value });
    // Native history updates are synchronous and integrate with useSearchParams.
    if (searchSessionRef.current) {
      window.history.replaceState(null, "", url);
    } else {
      searchSessionRef.current = true;
      window.history.pushState(null, "", url);
    }
  }

  function onSearchBlur() {
    searchSessionRef.current = false;
  }

  function selectProject(path: string) {
    setTrail([]);
    setTrailProject(null);
    setDrawerTab("overview");
    const next = withDeepLink(pathname, liveParams(), { project: path, issue: null });
    const current = `${pathname}${liveParams().size ? `?${liveParams().toString()}` : ""}`;
    if (next !== current) router.push(`${next}${window.location.hash}`, { scroll: false });
  }

  // Opening a card from the board or the attention list starts a fresh trail.
  function openIssue(id: string, projectPath = selectedId) {
    drawerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawerTab("overview");
    setTrailProject(projectPath);
    setTrail([]);
    router.push(`${withDeepLink(pathname, liveParams(), { project: projectPath, issue: id })}${window.location.hash}`, { scroll: false });
  }

  // Relationship links (dependencies, parents, children) extend the trail so the
  // drawer Back button can walk back. Use replace so the browser history keeps
  // only project/card-level entries; the trail is app-managed, never stale.
  function openIssueFromRelationship(id: string) {
    if (id === drawerIssueId) return; // self-link: nothing to step back to
    setTrailProject(selectedId);
    setTrail((current) =>
      trailActive && drawerIssueId ? [...current, drawerIssueId] : drawerIssueId ? [drawerIssueId] : [],
    );
    router.replace(`${withDeepLink(pathname, liveParams(), { project: selectedId, issue: id })}${window.location.hash}`, { scroll: false });
  }

  function goBackInTrail() {
    if (!trailActive || trail.length === 0) return;
    const previous = trail[trail.length - 1];
    setTrail(trail.slice(0, -1));
    router.replace(`${withDeepLink(pathname, liveParams(), { project: selectedId, issue: previous })}${window.location.hash}`, { scroll: false });
  }

  function closeIssue() {
    setTrailProject(selectedId);
    setTrail([]);
    router.push(`${withDeepLink(pathname, liveParams(), { project: selectedId, issue: null })}${window.location.hash}`, { scroll: false });
  }

  const selectedProject = allProjects.find((project) => project.path === selectedId) ?? null;
  const boardMatches = board !== null && board.projectId === selectedId;
  const visibleIssues = boardMatches ? applyFilters(board.data.issues, view) : [];
  // Facet choices come from the unfiltered scope issues plus any selected
  // tokens, so options never vanish just because the current result set
  // excludes them.
  const choices = boardMatches
    ? facetChoices(board.data.issues, view.filters)
    : { types: [], labels: [], assignees: [] };

  return (
    <SidebarProvider className="flex h-dvh min-h-0 w-full">
      <DashboardSidebar
        projects={projects}
        githubRepos={githubRepos}
        selectedId={selectedId}
        session={selectedId ? sessions[selectedId] : undefined}
        onSelect={selectProject}
        onGithubSaved={onGithubSaved}
        onNeedsYouSelect={(path, id) => openIssue(id, path)}
        onSessionSelect={openIssue}
        onSessionReset={() => {
          if (!selectedId) return;
          const now = Date.now();
          setSessions((current) => current[selectedId] ? { ...current, [selectedId]: resetSession(current[selectedId], now) } : current);
        }}
      />
      <SidebarInset className="flex min-h-0 min-w-0 flex-col gap-0">
        <DashboardHeader
          projectName={selectedProject?.name ?? null}
          view={view}
          choices={choices}
          onSearchChange={onSearchChange}
          onSearchBlur={onSearchBlur}
          onScopeSelect={selectScope}
          onFilterChange={toggleFilter}
          onRefresh={refresh}
        />
        {projects !== null && githubLoaded && urlProject && !validProject && (
          <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
            Linked project was not found. Select a project from the sidebar.
          </p>
        )}
        {boardError && (
          <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {boardError}
          </div>
        )}
        {boardMatches && (
          <Board
            issues={visibleIssues}
            readyIds={board.data.readyIds}
            childCounts={board.data.childCounts}
            includeClosed={view.scope === "all"}
            onSelect={openIssue}
          />
        )}
        {selectedId && !boardMatches && !boardError && (
          <div className="flex flex-1 gap-4 overflow-x-auto p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex w-72 flex-col gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ))}
          </div>
        )}
        <IssueDrawer
          key={`${selectedId ?? ""}:${drawerIssueId ?? "closed"}`}
          projectId={encodeURIComponent(selectedId ?? "")}
          projectPath={selectedProject?.path ?? ""}
          issueId={drawerIssueId}
          onClose={closeIssue}
          onSelectIssue={openIssueFromRelationship}
          canGoBack={trailActive && trail.length > 0}
          onBack={goBackInTrail}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          returnFocus={drawerReturnFocus}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
