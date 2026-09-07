import { MessageCircleIcon } from "lucide-react";
import { LabelBadge, PriorityBadge, TypeBadge } from "@/components/badges";
import type { BeadsIssue } from "@/lib/types";
import { relativeTime } from "@/lib/format";

interface IssueCardProps {
  issue: BeadsIssue;
  onSelect: (id: string) => void;
}

export function IssueCard({ issue, onSelect }: IssueCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(issue.id)}
      className="group flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-accent hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
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
  );
}
