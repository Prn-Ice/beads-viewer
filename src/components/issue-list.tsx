"use client";

import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { PriorityBadge, StatusBadge, TypeBadge } from "@/components/badges";
import { relativeTime } from "@/lib/format";
import {
  SORT_COLUMNS,
  nextSort,
  sortIssuesByKey,
  type SortDir,
  type SortKey,
} from "@/lib/list-sort";
import type { BeadsIssue } from "@/lib/types";

interface IssueListProps {
  issues: BeadsIssue[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey, dir: SortDir) => void;
  onSelect: (id: string) => void;
}

function DirectionIcon({ dir }: { dir: SortDir }) {
  return dir === "asc" ? (
    <ArrowUpIcon className="size-3.5" aria-hidden="true" />
  ) : (
    <ArrowDownIcon className="size-3.5" aria-hidden="true" />
  );
}

export function IssueList({ issues, sortKey, sortDir, onSort, onSelect }: IssueListProps) {
  const sorted = sortIssuesByKey(issues, sortKey, sortDir);

  return (
    <div role="region" aria-label="Issue list" className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="hidden w-full min-w-max border-collapse text-sm md:table">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b">
              {SORT_COLUMNS.map(({ key, label }) => {
                const active = key === sortKey;
                const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={ariaSort}
                    className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => onSort(key, nextSort(key, sortKey, sortDir))}
                      className={`inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                        active ? "text-foreground" : ""
                      }`}
                    >
                      {label}
                      {active ? (
                        <DirectionIcon dir={sortDir} />
                      ) : (
                        <ArrowUpDownIcon className="size-3.5 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={SORT_COLUMNS.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No issues match
                </td>
              </tr>
            )}
            {sorted.map((issue) => (
              <tr key={issue.id} className="border-b transition-colors hover:bg-accent/40">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {issue.id}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                     onClick={() => onSelect(issue.id)}
                     title={issue.title}
                    className="max-w-72 truncate text-left font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {issue.title}
                  </button>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <PriorityBadge priority={issue.priority} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusBadge status={issue.status} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <TypeBadge issueType={issue.issue_type} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {issue.assignee || "unassigned"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {issue.created_at && Number.isFinite(Date.parse(issue.created_at)) ? relativeTime(issue.created_at) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      <ul className="md:hidden">
        {sorted.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">No issues match</li>
        )}
        {sorted.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              onClick={() => onSelect(issue.id)}
              className="block w-full px-4 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <span className="line-clamp-2 text-sm leading-snug font-medium [overflow-wrap:anywhere]">{issue.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono break-all">{issue.id}</span>
                <PriorityBadge priority={issue.priority} />
                <StatusBadge status={issue.status} />
                {issue.created_at && Number.isFinite(Date.parse(issue.created_at)) && (
                  <span className="ml-auto whitespace-nowrap">{relativeTime(issue.created_at)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
