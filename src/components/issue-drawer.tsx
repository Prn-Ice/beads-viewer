"use client";

import { useEffect, useState } from "react";
import { RotateCwIcon } from "lucide-react";
import { LabelBadge, PriorityBadge, StatusBadge, TypeBadge } from "@/components/badges";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, relativeTime } from "@/lib/format";
import type { BeadsIssue, Comment, DependencyRef } from "@/lib/types";

interface IssueDrawerProps {
  projectId: string;
  issueId: string | null;
  onClose: () => void;
  onSelectIssue: (id: string) => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function DependencyList({
  title,
  items,
  onSelectIssue,
}: {
  title: string;
  items: DependencyRef[];
  onSelectIssue: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <div className="flex flex-col gap-1">
        {items.map((dep, index) => {
          const id = dep.id ?? dep.issue_id ?? dep.depends_on_id ?? `dep-${index}`;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectIssue(id)}
              className="flex items-center gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent/40"
            >
              <span className="font-mono text-xs text-muted-foreground">{id}</span>
              <span className="flex-1 truncate">{dep.title ?? "—"}</span>
              {dep.status && <StatusBadge status={dep.status} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Section({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <section>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <Markdown>{body}</Markdown>
    </section>
  );
}

export function IssueDrawer({ projectId, issueId, onClose, onSelectIssue }: IssueDrawerProps) {
  const [issue, setIssue] = useState<BeadsIssue | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;

    const issueUrl = `/api/projects/${projectId}/issues/${encodeURIComponent(issueId)}`;
    const commentsUrl = `${issueUrl}/comments`;

    fetch(issueUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load issue (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: BeadsIssue) => {
        if (!cancelled) setIssue(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    fetch(commentsUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load comments (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: Comment[]) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, issueId, reloadKey]);

  const dependencies = issue?.dependencies ?? [];
  const dependents = issue?.dependents ?? [];

  return (
    <Sheet open={issueId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              <RotateCwIcon className="size-4" />
              Retry
            </Button>
          </div>
        )}
        {!error && !issue && (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {issue && (
          <>
            <SheetHeader className="border-b p-6">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
                <StatusBadge status={issue.status} />
                <PriorityBadge priority={issue.priority} />
              </div>
              <SheetTitle>{issue.title}</SheetTitle>
              <SheetDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  <TypeBadge issueType={issue.issue_type} />
                  {issue.labels?.map((label) => (
                    <LabelBadge key={label} label={label} />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetaRow label="Assignee" value={issue.assignee ?? "unassigned"} />
                  <MetaRow label="Created" value={formatDate(issue.created_at)} />
                  <MetaRow label="Updated" value={relativeTime(issue.updated_at)} />
                  <MetaRow label="Started" value={formatDate(issue.started_at) || "—"} />
                  <MetaRow label="Closed" value={formatDate(issue.closed_at) || "—"} />
                  <MetaRow label="Owner" value={issue.owner ?? "—"} />
                </div>
              </SheetDescription>
            </SheetHeader>
            <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col gap-0 p-6">
              <TabsList className="max-w-full flex-wrap group-data-horizontal/tabs:h-auto [&_[data-slot=tabs-trigger]]:h-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="comments">Comments ({comments?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="dependencies">
                  Dependencies ({dependencies.length + dependents.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="flex flex-col gap-6 pt-4">
                <Section title="Description" body={issue.description} />
                <Section title="Acceptance Criteria" body={issue.acceptance_criteria} />
                <Section title="Notes" body={issue.notes} />
                {!issue.description && !issue.acceptance_criteria && !issue.notes && (
                  <p className="text-sm text-muted-foreground">No description yet.</p>
                )}
                {issue.close_reason && (
                  <Section title="Close Reason" body={issue.close_reason} />
                )}
              </TabsContent>
              <TabsContent value="comments" className="flex flex-col gap-3 pt-4">
                {comments === null && <Skeleton className="h-16 w-full" />}
                {comments !== null && comments.length === 0 && (
                  <p className="text-sm text-muted-foreground">No comments yet.</p>
                )}
                {comments?.map((comment) => (
                  <article key={comment.id} className="rounded-md border p-3">
                    <header className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{comment.author}</span>
                      <span>{relativeTime(comment.created_at)}</span>
                    </header>
                    <Markdown>{comment.text}</Markdown>
                  </article>
                ))}
              </TabsContent>
              <TabsContent value="dependencies" className="flex flex-col gap-6 pt-4">
                <DependencyList title="Depends on" items={dependencies} onSelectIssue={onSelectIssue} />
                <DependencyList title="Required by" items={dependents} onSelectIssue={onSelectIssue} />
                {dependencies.length === 0 && dependents.length === 0 && (
                  <p className="text-sm text-muted-foreground">No dependencies.</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
