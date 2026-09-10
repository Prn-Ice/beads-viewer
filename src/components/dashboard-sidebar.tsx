"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { GitBranchIcon, GitGraphIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { GithubSettings } from "@/components/github-settings";
import { NeedsYou } from "@/components/needs-you";
import { SessionChanges } from "@/components/session-changes";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { ObservedSession } from "@/lib/session-changes";
import type { GithubRepoResponse, Project } from "@/lib/types";

// One entry per configured GitHub repo. Starts as "loading" and resolves to
// "ok" (has beads), "empty" (no beads — hidden), or "error" (sync failed).
export interface GithubRepoEntry {
  slug: string;
  state: "loading" | "ok" | "empty" | "error";
  project?: Project;
  message?: string;
}

// Desktop sidebar width while the Needs You panel is open, so issue rows get
// room without widening the sidebar for everyone all the time.
const NEEDS_YOU_SIDEBAR_WIDTH = "24rem";

export function githubEntryFromResponse(slug: string, res: Response, data: unknown): GithubRepoEntry {
  if (!res.ok) {
    return { slug, state: "error", message: `HTTP ${res.status}` };
  }
  const body = data as GithubRepoResponse;
  if (body.state === "ok") return { slug, state: "ok", project: body.project };
  if (body.state === "empty") return { slug, state: "empty" };
  return { slug, state: "error", message: body.message };
}

// One sidebar row for a selectable project: name plus open-issue count ("?"
// when the count is unavailable). Used by the Projects and Worktrees groups;
// the Broken and GitHub groups have their own rows.
function ProjectRow({
  project,
  selectedId,
  onSelect,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={project.path === selectedId}
        title={project.name}
        onClick={() => onSelect(project.path)}
      >
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <SidebarMenuBadge className="static shrink-0">
          {project.summary?.open_issues ?? "?"}
        </SidebarMenuBadge>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// Sidebar group for GitHub repos: spinner rows while a repo syncs, a warning
// row when it fails, and a normal project row once its beads project is ready.
// Repos without beads ("empty") are not shown.
function GithubRepoGroup({
  repos,
  selectedId,
  onSelect,
  onSaved,
}: {
  repos: GithubRepoEntry[];
  selectedId: string | null;
  onSelect: (path: string) => void;
  onSaved: () => void;
}) {
  const visible = repos.filter((entry) => entry.state !== "empty");
  const syncing = repos.some((entry) => entry.state === "loading");
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-1.5 pr-8">
        <GitGraphIcon className="size-3.5 text-muted-foreground" aria-hidden />
        GitHub
        {syncing && (
          <LoaderCircleIcon className="size-3 animate-spin text-muted-foreground" aria-hidden />
        )}
      </SidebarGroupLabel>
      <GithubSettings onSaved={onSaved} />
      {visible.length > 0 && (
        <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((entry) => {
            if (entry.state === "loading") {
              return (
                <SidebarMenuItem key={entry.slug}>
                  <div
                    role="status"
                    aria-label={`Syncing ${entry.slug} from GitHub`}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                  >
                    <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{entry.slug}</span>
                  </div>
                </SidebarMenuItem>
              );
            }
            if (entry.state === "error" || !entry.project) {
              return (
                <SidebarMenuItem key={entry.slug}>
                  <div
                    role="status"
                    title={entry.message ?? "sync failed"}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                  >
                    <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{entry.slug}</span>
                    <span className="sr-only"> sync failed: {entry.message ?? "unknown error"}</span>
                  </div>
                </SidebarMenuItem>
              );
            }
            const project = entry.project;
            return (
              <SidebarMenuItem key={entry.slug}>
                <SidebarMenuButton
                  isActive={project.path === selectedId}
                  title={project.name}
                  onClick={() => onSelect(project.path)}
                >
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <SidebarMenuBadge className="static shrink-0">
                    {project.summary?.open_issues ?? "?"}
                  </SidebarMenuBadge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

interface DashboardSidebarProps {
  projects: Project[] | null;
  githubRepos: GithubRepoEntry[];
  selectedId: string | null;
  session: ObservedSession | undefined;
  onSelect: (path: string) => void;
  onGithubSaved: () => void;
  onNeedsYouSelect: (projectPath: string, issueId: string) => void;
  onSessionSelect: (id: string) => void;
  onSessionReset: () => void;
}

export function DashboardSidebar({
  projects,
  githubRepos,
  selectedId,
  session,
  onSelect,
  onGithubSaved,
  onNeedsYouSelect,
  onSessionSelect,
  onSessionReset,
}: DashboardSidebarProps) {
  // Local projects split into three sidebar groups: healthy ones under
  // Projects, linked git worktrees under Worktrees, and ones whose `bd status`
  // fails (stale/broken .beads) under Broken so they stop looking selectable.
  const broken = (projects ?? []).filter((project) => project.summary === null);
  const worktrees = (projects ?? []).filter((project) => project.worktree && project.summary !== null);
  const healthy = (projects ?? []).filter((project) => !project.worktree && project.summary !== null);
  const [needsYouOpen, setNeedsYouOpen] = useState(false);

  return (
    <Sidebar
      style={
        needsYouOpen
          ? ({ "--sidebar-width": NEEDS_YOU_SIDEBAR_WIDTH } as CSSProperties)
          : undefined
      }
    >
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
              {projects?.length === 0 && githubRepos.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No projects found. Run <code className="font-mono">bd init</code> in a
                  project directory or set{" "}
                  <code className="font-mono">BEADS_PROJECT_ROOTS</code>.
                </p>
              )}
              {healthy.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {worktrees.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="gap-1.5">
              <GitBranchIcon className="size-3.5 text-muted-foreground" aria-hidden />
              Worktrees
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {worktrees.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selectedId={selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {broken.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="gap-1.5">
              <TriangleAlertIcon className="size-3.5 text-muted-foreground" aria-hidden />
              Broken
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {broken.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={project.path === selectedId}
                      title={`${project.name} — bd could not read this project`}
                      onClick={() => onSelect(project.path)}
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {project.name}
                      </span>
                      <TriangleAlertIcon
                        className="size-3.5 shrink-0 text-destructive"
                        aria-label="bd could not read this project"
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <GithubRepoGroup
          repos={githubRepos}
          selectedId={selectedId}
          onSelect={onSelect}
          onSaved={onGithubSaved}
        />
      </SidebarContent>
      <SidebarFooter className="max-h-[65vh] overflow-y-auto border-t p-4">
        <NeedsYou onSelect={onNeedsYouSelect} onOpenChange={setNeedsYouOpen} />
        <SessionChanges
          session={session}
          onSelect={onSessionSelect}
          onReset={onSessionReset}
        />
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
  );
}
