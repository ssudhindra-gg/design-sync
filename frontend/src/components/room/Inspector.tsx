import { Lock, LockOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KIND_META } from "@/lib/diagram-theme";
import type { Diagram } from "@/services/api";

export function Inspector({
  diagram,
  selectedNodeIds,
  selectedEdgeId,
  canEdit,
  isInterviewer,
  onApply,
  onToggleLock,
}: {
  diagram: Diagram;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  canEdit: boolean;
  isInterviewer: boolean;
  onApply: (mutate: (d: Diagram) => void) => void;
  onToggleLock: (nodeId: string, locked: boolean) => void;
}) {
  const node = selectedNodeIds.length === 1 ? diagram.nodes.find((n) => n.id === selectedNodeIds[0]) : undefined;
  const edge = selectedEdgeId ? diagram.edges.find((e) => e.id === selectedEdgeId) : undefined;

  if (!node && !edge) {
    return (
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">
        Select a component or arrow to rename, lock or delete it.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {node ? KIND_META[node.kind].label : "Connection"}
      </p>

      {node && (
        <>
          <div className="space-y-1">
            <Label htmlFor="node-label" className="text-xs">
              Label
            </Label>
            <Input
              id="node-label"
              value={node.label}
              disabled={!canEdit || node.locked}
              onChange={(e) =>
                onApply((d) => {
                  const n = d.nodes.find((x) => x.id === node.id);
                  if (n) n.label = e.target.value;
                })
              }
            />
          </div>
          <div className="flex gap-2">
            {isInterviewer && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onToggleLock(node.id, !node.locked)}
              >
                {node.locked ? <LockOpen className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
                {node.locked ? "Unlock" : "Lock"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit || node.locked}
              onClick={() =>
                onApply((d) => {
                  d.nodes = d.nodes.filter((x) => x.id !== node.id);
                  d.edges = d.edges.filter((e) => e.from !== node.id && e.to !== node.id);
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">Delete component</span>
            </Button>
          </div>
        </>
      )}

      {edge && (
        <>
          <div className="space-y-1">
            <Label htmlFor="edge-label" className="text-xs">
              Arrow label
            </Label>
            <Input
              id="edge-label"
              value={edge.label}
              placeholder="e.g. writes, 10k rps"
              disabled={!canEdit}
              onChange={(e) =>
                onApply((d) => {
                  const x = d.edges.find((y) => y.id === edge.id);
                  if (x) x.label = e.target.value;
                })
              }
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canEdit}
            onClick={() => onApply((d) => (d.edges = d.edges.filter((x) => x.id !== edge.id)))}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete arrow
          </Button>
        </>
      )}
    </div>
  );
}
