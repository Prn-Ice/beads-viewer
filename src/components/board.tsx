"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { IssueCard } from "@/components/issue-card";
import { IssueList } from "@/components/issue-list";
import { NeedsAttention } from "@/components/needs-attention";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bucketIssues, type BoardColumns } from "@/lib/buckets";
import { SORT_COLUMNS, nextSort, type SortDir, type SortKey } from "@/lib/list-sort";
import type { BeadsIssue } from "@/lib/types";

interface BoardProps {
  issues: BeadsIssue[];
  readyIds: string[];
  includeClosed: boolean;
  onSelect: (id: string) => void;
}

type ViewMode = "board" | "list";

export function Board({ issues, readyIds, includeClosed, onSelect }: BoardProps) {
  const [view, setView] = useState<ViewMode>("board");
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const columns = bucketIssues(issues, readyIds);
  // In Open scope the board simply omits the closed column; the list must
  // exclude closed issues explicitly so both views agree on scope.
  const listIssues = includeClosed ? issues : issues.filter((i) => i.status !== "closed");
  const visible: { key: keyof BoardColumns; label: string }[] = [
    { key: "ready", label: "Ready" },
    { key: "in_progress", label: "In Progress" },
    { key: "blocked", label: "Blocked" },
    { key: "backlog", label: "Backlog" },
  ];
  if (includeClosed) {
    visible.push({ key: "closed", label: "Closed" });
  }

  function handleSort(key: SortKey, dir: SortDir) {
    setSortKey(key);
    setSortDir(dir);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1.5">
        <div className="flex items-center gap-1 rounded-lg border p-0.5" role="group" aria-label="Board view">
          <button
            type="button"
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
              view === "board" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGridIcon className="hidden size-3.5 md:inline" aria-hidden="true" />
            Board
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
              view === "list" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListIcon className="hidden size-3.5 md:inline" aria-hidden="true" />
            List
          </button>
        </div>
        <span className="text-xs whitespace-nowrap text-muted-foreground">{listIssues.length} issues</span>
        <div className="ml-auto flex shrink-0 items-center gap-2 md:hidden">
          {view === "list" && (
            <>
              <Select value={sortKey} onValueChange={(value) => handleSort(value as SortKey, sortDir)}>
                <SelectTrigger size="sm" className="w-24 min-w-0 text-xs" aria-label="Sort issues by">
                  <SelectValue>{SORT_COLUMNS.find((column) => column.key === sortKey)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SORT_COLUMNS.map(({ key, label }) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSort(sortKey, nextSort(sortKey, sortKey, sortDir))}
                aria-label={`Sort ${sortDir === "asc" ? "descending" : "ascending"}`}
              >
                {sortDir === "asc" ? (
                  <ArrowUpIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDownIcon className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
      <NeedsAttention issues={issues} onSelect={onSelect} />
      {view === "list" ? (
        <IssueList
          issues={listIssues}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onSelect={onSelect}
        />
      ) : (
        <div role="region" aria-label="Issue board" className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max gap-4 p-4">
            {visible.map(({ key, label }) => (
              <section key={key} className="flex w-72 flex-col gap-2">
                <header className="flex items-center gap-2 px-1">
                  <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {columns[key].length}
                  </span>
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-2">
                  {columns[key].length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Nothing here
                    </div>
                  )}
                  {columns[key].map((issue) => (
                    <IssueCard key={issue.id} issue={issue} onSelect={onSelect} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
