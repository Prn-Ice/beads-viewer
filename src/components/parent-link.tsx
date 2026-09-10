import { ArrowUpRightIcon } from "lucide-react";

interface ParentLinkProps {
  parentId: string;
  /** When omitted the chip renders as plain text (e.g. inside a row button). */
  onSelect?: (id: string) => void;
}

const CHIP_CLASSES =
  "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground";

export function ParentLink({ parentId, onSelect }: ParentLinkProps) {
  const content = (
    <>
      <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Child of <span className="font-mono">{parentId}</span>
      </span>
    </>
  );
  if (!onSelect) {
    return <span className={CHIP_CLASSES}>{content}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(parentId)}
      aria-label={`Open parent issue ${parentId}`}
      className={`${CHIP_CLASSES} transition-colors hover:border-accent hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none`}
    >
      {content}
    </button>
  );
}
