import { ListTreeIcon, MessageCircleIcon } from "lucide-react";
import { LabelBadge, PriorityBadge, TypeBadge } from "@/components/badges";
import { ParentLink } from "@/components/parent-link";
import type { BeadsIssue } from "@/lib/types";
import { relativeTime } from "@/lib/format";

interface IssueCardProps {
  issue: BeadsIssue;
  childCount: number;
  onSelect: (id: string) => void;
}

export function IssueCard({ issue, childCount, onSelect }: IssueCardProps) {
  return (
    <div className="group flex flex-col rounded-lg border bg-card transition-colors hover:border-accent hover:bg-accent/40">
      <button
        type="button"
        onClick={() => onSelect(issue.id)}
        className="flex w-full flex-col gap-2 p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
          <PriorityBadge priority={issue.priority} />
        </div>
        <span className="line-clamp-3 text-sm font-medium">{issue.title}</span>
        <div className="flex flex-wrap items-center gap-1">
          <TypeBadge issueType={issue.issue_type} />
          {issue.labels?.slice(0, 3).map((label) => (
            <LabelBadge key={label} label={label} />
          ))}
          {childCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ListTreeIcon className="size-3" aria-hidden="true" />
              {childCount} {childCount === 1 ? "child" : "children"}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{issue.assignee ?? "unassigned"}</span>
          <span className="flex items-center gap-2">
            {issue.comment_count > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageCircleIcon className="size-3" />
                {issue.comment_count}
              </span>
            )}
            <span className="group-hover:hidden">{relativeTime(issue.updated_at)}</span>
          </span>
        </div>
      </button>
      {issue.parent && (
        <div className="flex flex-wrap items-center gap-1 border-t px-3 py-1.5">
          <ParentLink parentId={issue.parent} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
