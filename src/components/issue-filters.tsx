"use client";

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PRIORITY_OPTIONS,
  countActiveFilters,
  type FacetChoices,
  type FilterState,
} from "@/lib/filters";

interface IssueFiltersProps {
  filters: FilterState;
  choices: FacetChoices;
  onChange: (partial: Partial<FilterState>) => void;
}

function toggleValue(list: string[], value: string, on: boolean): string[] {
  return on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value);
}

function CheckboxRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50 focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-ring">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
}

function FacetFieldset({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mb-4 last:mb-0">
      <legend className="mb-1 px-1 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="flex flex-col gap-0.5 rounded-lg border p-1">{children}</div>
    </fieldset>
  );
}

export function IssueFilters({ filters, choices, onChange }: IssueFiltersProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  function clearFilters() {
    onChange({ priorities: [], types: [], labels: [], assignees: [], unassigned: false });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={activeCount > 0 ? `Filters (${activeCount} active)` : "Filters"}
        onClick={() => setOpen(true)}
        className="shrink-0"
      >
        <SlidersHorizontalIcon className="size-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Filters</span>
        {activeCount > 0 && (
          <span
            aria-hidden="true"
            className="rounded-full bg-primary px-1.5 text-xs leading-4 text-primary-foreground"
          >
            {activeCount}
          </span>
        )}
      </Button>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-sm"
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Narrow the board by priority, type, label, and assignee. Choices combine with search
            and Open/All scope.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <FacetFieldset legend="Priority">
            {PRIORITY_OPTIONS.map((priority) => (
              <CheckboxRow
                key={priority}
                label={`P${priority}`}
                checked={filters.priorities.includes(priority)}
                onCheckedChange={(checked) =>
                  onChange({
                    priorities: checked
                      ? [...filters.priorities, priority]
                      : filters.priorities.filter((value) => value !== priority),
                  })
                }
              />
            ))}
          </FacetFieldset>
          <FacetFieldset legend="Type">
            {choices.types.map((type) => (
              <CheckboxRow
                key={type}
                label={type}
                checked={filters.types.includes(type)}
                onCheckedChange={(checked) => onChange({ types: toggleValue(filters.types, type, checked) })}
              />
            ))}
          </FacetFieldset>
          <FacetFieldset legend="Label">
            {choices.labels.map((label) => (
              <CheckboxRow
                key={label}
                label={label}
                checked={filters.labels.includes(label)}
                onCheckedChange={(checked) => onChange({ labels: toggleValue(filters.labels, label, checked) })}
              />
            ))}
          </FacetFieldset>
          <FacetFieldset legend="Assignee">
            <CheckboxRow
              label="Unassigned"
              checked={filters.unassigned}
              onCheckedChange={(checked) => onChange({ unassigned: checked })}
            />
            {choices.assignees.map((assignee) => (
              <CheckboxRow
                key={assignee}
                label={assignee}
                checked={filters.assignees.includes(assignee)}
                onCheckedChange={(checked) =>
                  onChange({ assignees: toggleValue(filters.assignees, assignee, checked) })
                }
              />
            ))}
          </FacetFieldset>
        </div>
        <SheetFooter className="border-t">
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
