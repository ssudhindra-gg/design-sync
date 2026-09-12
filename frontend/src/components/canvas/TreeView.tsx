import { KIND_META } from "@/lib/diagram-theme";
import type { Diagram } from "@/services/api";
import { cn } from "@/lib/utils";

/** Accessible, keyboard-navigable equivalent of the canvas. */
export function TreeView({
  diagram,
  selectedNodeIds,
  selectedEdgeId,
  onSelect,
}: {
  diagram: Diagram;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  onSelect: (nodeIds: string[], edgeId: string | null) => void;
}) {
  const nameOf = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? "unknown";

  return (
    <div className="h-full overflow-auto rounded-lg border border-border bg-card p-4">
      <h2 className="font-display text-sm font-semibold">Diagram structure</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {diagram.nodes.length} components · {diagram.edges.length} connections
      </p>

      <ul className="mt-4 space-y-1" role="tree" aria-label="Diagram components">
        {diagram.nodes.map((node) => {
          const outgoing = diagram.edges.filter((e) => e.from === node.id);
          const selected = selectedNodeIds.includes(node.id);
          return (
            <li key={node.id} role="treeitem" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect([node.id], null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  selected ? "bg-secondary text-foreground" : "hover:bg-secondary/60",
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: KIND_META[node.kind].accent }}
                />
                <span className="font-medium">{node.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {KIND_META[node.kind].label}
                </span>
                {node.locked && <span className="text-[10px] text-warning">locked</span>}
              </button>
              {outgoing.length > 0 && (
                <ul className="ml-5 border-l border-border pl-3" role="group">
                  {outgoing.map((edge) => (
                    <li key={edge.id} role="treeitem" aria-selected={selectedEdgeId === edge.id}>
                      <button
                        type="button"
                        onClick={() => onSelect([], edge.id)}
                        className={cn(
                          "w-full rounded px-2 py-1 text-left text-xs text-muted-foreground",
                          selectedEdgeId === edge.id ? "bg-secondary text-foreground" : "hover:bg-secondary/60",
                        )}
                      >
                        → {nameOf(edge.to)}
                        {edge.label ? ` · ${edge.label}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {diagram.nodes.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing on the board yet. Add a component from the palette.
        </p>
      )}
    </div>
  );
}
