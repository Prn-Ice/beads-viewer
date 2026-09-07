import { Badge } from "@/components/ui/badge";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "outline",
  in_progress: "default",
  blocked: "destructive",
  closed: "secondary",
  deferred: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "outline"} className="capitalize">
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

const PRIORITY_COLORS: Record<number, string> = {
  0: "border-red-500/40 bg-red-500/10 text-red-400",
  1: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  2: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  3: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  4: "border-muted bg-muted/30 text-muted-foreground",
};

export function PriorityBadge({ priority }: { priority?: number }) {
  if (priority === undefined) return null;
  return (
    <Badge variant="outline" className={PRIORITY_COLORS[priority] ?? PRIORITY_COLORS[4]}>
      P{priority}
    </Badge>
  );
}

export function TypeBadge({ issueType }: { issueType?: string }) {
  if (!issueType) return null;
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      {issueType}
    </Badge>
  );
}

export function LabelBadge({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      {label}
    </Badge>
  );
}
