"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCwIcon, SearchIcon } from "lucide-react";
import { Board } from "@/components/board";
import { readDeepLink, withDeepLink } from "@/lib/navigation";
import { IssueDrawer } from "@/components/issue-drawer";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { BeadsIssue, IssueListResponse, Project } from "@/lib/types";

const POLL_MS = 3_000;

interface LoadedBoard {
  projectId: string;
  data: IssueListResponse;
}

function matchesSearch(issue: BeadsIssue, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    issue.id.toLowerCase().includes(q) ||
    issue.title.toLowerCase().includes(q) ||
    (issue.labels ?? []).some((label) => label.toLowerCase().includes(q))
  );
}

export function Dashboard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [scope, setScope] = useState<"open" | "all">("open");
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState<LoadedBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { project: urlProject, issue: urlIssue } = readDeepLink(searchParams);

  // Derive selection from the URL deep-link params so Back/Forward and direct
  // loads synchronize automatically. The default (or invalid) project is
  // selected without writing to the URL so it does not flood history; an
  // invalid project normalizes to the default without leaking the issue into it.
  const validProject =
    urlProject && projects?.some((project) => project.path === urlProject) ? urlProject : null;
  const selectedId = validProject ?? projects?.[0]?.path ?? null;
  const drawerIssueId = validProject ? urlIssue : null;

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

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(selectedId)}/issues?scope=${scope}`)
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load issues (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: IssueListResponse) => {
        if (!cancelled) {
          setBoard({ projectId: selectedId, data });
          setBoardError(null);
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
  }, [selectedId, scope, reloadKey]);

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

  function selectProject(path: string) {
    const next = withDeepLink(pathname, searchParams, { project: path, issue: null });
    const current = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
    if (next !== current) router.push(`${next}${window.location.hash}`, { scroll: false });
  }

  function openIssue(id: string) {
    router.push(`${withDeepLink(pathname, searchParams, { project: selectedId, issue: id })}${window.location.hash}`, { scroll: false });
  }

  function closeIssue() {
    router.push(`${withDeepLink(pathname, searchParams, { project: selectedId, issue: null })}${window.location.hash}`, { scroll: false });
  }

  const selectedProject = projects?.find((project) => project.path === selectedId) ?? null;
  const boardMatches = board !== null && board.projectId === selectedId;
  const visibleIssues = boardMatches
    ? board.data.issues.filter((issue) => matchesSearch(issue, search))
    : [];

  return (
    <SidebarProvider className="flex h-dvh min-h-0 w-full">
      <Sidebar>
        <SidebarHeader className="gap-2 border-b p-4">
          <Image src="/brand/beads.svg" alt="Beads" width={28} height={28} unoptimized className="shrink-0 self-start" />
          <span className="text-xs text-muted-foreground">Local issue dashboard</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects === null &&
                  [0, 1, 2].map((i) => (
                    <SidebarMenuItem key={i}>
                      <Skeleton className="mx-2 h-8 rounded-md" />
                    </SidebarMenuItem>
                  ))}
                {projects?.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No projects found. Run <code className="font-mono">bd init</code> in a
                    project directory or set{" "}
                    <code className="font-mono">BEADS_PROJECT_ROOTS</code>.
                  </p>
                )}
                {projects?.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={project.path === selectedId}
                      title={project.name}
                      onClick={() => selectProject(project.path)}
                    >
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <SidebarMenuBadge className="static shrink-0">
                        {project.summary?.open_issues ?? "?"}
                      </SidebarMenuBadge>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t p-4">
          <a
            href="https://beads.gascity.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Beads documentation<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="flex min-h-0 min-w-0 flex-col gap-0">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 lg:gap-3">
          <SidebarTrigger />
          <Image src="/brand/beads.svg" alt="Beads" width={24} height={24} unoptimized className="md:hidden" />
          <h1 className="min-w-0 flex-1 basis-[calc(100%-5rem)] truncate text-xl font-semibold tracking-tight lg:basis-0">
            {selectedProject?.name ?? "View Beads"}
          </h1>
          <div className="relative order-last w-full lg:order-none lg:ml-auto lg:w-64">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, id, label..."
              aria-label="Search issues"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <Button
              variant={scope === "open" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={scope === "open"}
              onClick={() => setScope("open")}
            >
              Open
            </Button>
            <Button
              variant={scope === "all" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All
            </Button>
          </div>
          <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh">
            <RotateCwIcon className="size-4" />
          </Button>
          <ThemeSwitcher />
        </header>
        {projects !== null && urlProject && !validProject && (
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
            includeClosed={scope === "all"}
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
          onSelectIssue={openIssue}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
