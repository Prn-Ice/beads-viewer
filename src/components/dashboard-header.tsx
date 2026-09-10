"use client";

import Image from "next/image";
import { ChevronDownIcon, RotateCwIcon, SearchIcon } from "lucide-react";
import { IssueFilters } from "@/components/issue-filters";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { FacetChoices, FilterState, Scope, ViewState } from "@/lib/filters";

// Mobile-only replacement for the desktop SidebarTrigger + heading: one button
// (logo, truncated project name, chevron) that opens the mobile sidebar sheet.
// Must stay inside SidebarProvider, so it lives here rather than in ui/.
function ProjectPickerButton({ name }: { name: string | null }) {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="lg"
      className="min-w-0 flex-1 justify-start gap-2 px-0 md:hidden"
      aria-haspopup="dialog"
      aria-expanded={openMobile}
      aria-label={`Choose project: ${name ?? "View Beads"}`}
      onClick={() => setOpenMobile(true)}
    >
      <Image
        src="/brand/beads.svg"
        alt="Beads"
        width={24}
        height={24}
        unoptimized
        className="shrink-0"
      />
      <span className="min-w-0 truncate text-base font-semibold tracking-tight">
        {name ?? "View Beads"}
      </span>
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  );
}

function SearchInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="relative flex-1">
      <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder="Search issues..."
        aria-label="Search issues"
        className="pl-8"
      />
    </div>
  );
}

function ScopeToggle({
  scope,
  onSelect,
}: {
  scope: Scope;
  onSelect: (scope: Scope) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg border p-0.5">
      <Button
        variant={scope === "open" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={scope === "open"}
        onClick={() => onSelect("open")}
      >
        Open
      </Button>
      <Button
        variant={scope === "all" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={scope === "all"}
        onClick={() => onSelect("all")}
      >
        All
      </Button>
    </div>
  );
}

interface DashboardHeaderProps {
  projectName: string | null;
  view: ViewState;
  choices: FacetChoices;
  onSearchChange: (value: string) => void;
  onSearchBlur: () => void;
  onScopeSelect: (scope: Scope) => void;
  onFilterChange: (partial: Partial<FilterState>) => void;
  onRefresh: () => void;
}

export function DashboardHeader({
  projectName,
  view,
  choices,
  onSearchChange,
  onSearchBlur,
  onScopeSelect,
  onFilterChange,
  onRefresh,
}: DashboardHeaderProps) {
  return (
    <header className="flex shrink-0 flex-col border-b px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="hidden md:inline-flex" />
        <ProjectPickerButton name={projectName} />
        <h1 className="max-md:sr-only min-w-0 flex-1 truncate text-base font-semibold tracking-tight lg:text-lg">
          {projectName ?? "View Beads"}
        </h1>
        <div className="ml-auto hidden w-64 lg:block">
          <SearchInput
            value={view.search}
            onChange={onSearchChange}
            onBlur={onSearchBlur}
          />
        </div>
        <div className="hidden lg:flex">
          <ScopeToggle scope={view.scope} onSelect={onScopeSelect} />
        </div>
        <IssueFilters filters={view.filters} choices={choices} onChange={onFilterChange} />
        <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Refresh">
          <RotateCwIcon className="size-4" />
        </Button>
        <ThemeSwitcher />
      </div>
      <div className="mt-1 flex items-center gap-2 lg:hidden">
        <SearchInput
          value={view.search}
          onChange={onSearchChange}
          onBlur={onSearchBlur}
        />
        <ScopeToggle scope={view.scope} onSelect={onScopeSelect} />
      </div>
    </header>
  );
}
