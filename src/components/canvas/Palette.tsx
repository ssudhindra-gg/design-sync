import { KIND_META } from "@/lib/diagram-theme";
import { NODE_KINDS, type NodeKind } from "@/services/api";
import { cn } from "@/lib/utils";

export function Palette({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (kind: NodeKind) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Components
      </p>
      {NODE_KINDS.map((kind) => {
        const meta = KIND_META[kind];
        return (
          <button
            key={kind}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            onDragStart={(e) => e.dataTransfer.setData("application/x-node-kind", kind)}
            onClick={() => onAdd(kind)}
            title={meta.hint}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors",
              disabled
                ? "cursor-not-allowed opacity-40"
                : "cursor-grab hover:border-border hover:bg-secondary active:cursor-grabbing",
            )}
          >
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: meta.accent }}
            />
            <span className="truncate">{meta.label}</span>
          </button>
        );
      })}
      <p className="px-1 pt-2 text-[11px] leading-snug text-muted-foreground">
        Drag onto the canvas, or click to drop one in the middle.
      </p>
    </div>
  );
}
