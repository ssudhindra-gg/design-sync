import { useCallback, useEffect, useRef, useState } from "react";
import { CANVAS_COLORS, KIND_META } from "@/lib/diagram-theme";
import { edgeGeometry, nodeCenter } from "@/lib/diagram-utils";
import type { Diagram, NodeKind } from "@/services/api";
import { NodeShape } from "./NodeShape";

export type Tool = "select" | "connect";

interface Props {
  diagram: Diagram;
  canEdit: boolean;
  tool: Tool;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  onSelect: (nodeIds: string[], edgeId: string | null) => void;
  onApply: (mutate: (d: Diagram) => void) => void;
  onApplyLive: (mutate: (d: Diagram) => void) => void;
  onBeginGesture: () => void;
  onEndGesture: () => void;
  onAddNode: (kind: NodeKind, x: number, y: number) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Drag =
  | { mode: "move"; ids: string[]; startX: number; startY: number; origin: Record<string, { x: number; y: number }> }
  | { mode: "resize"; id: string; startX: number; startY: number; w: number; h: number }
  | { mode: "pan"; startX: number; startY: number; vb: Box };

export function DiagramCanvas({
  diagram,
  canEdit,
  tool,
  selectedNodeIds,
  selectedEdgeId,
  onSelect,
  onApply,
  onApplyLive,
  onBeginGesture,
  onEndGesture,
  onAddNode,
  svgRef,
}: Props) {
  const [vb, setVb] = useState<Box>({ x: -100, y: -80, w: 1400, h: 900 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
        y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
      };
    },
    [svgRef, vb],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      if (drag.mode === "pan") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = ((e.clientX - drag.startX) / rect.width) * drag.vb.w;
        const dy = ((e.clientY - drag.startY) / rect.height) * drag.vb.h;
        setVb({ ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy });
        return;
      }
      if (drag.mode === "move") {
        const dx = p.x - drag.startX;
        const dy = p.y - drag.startY;
        onApplyLive((d) => {
          for (const id of drag.ids) {
            const n = d.nodes.find((x) => x.id === id);
            const o = drag.origin[id];
            if (n && o) {
              n.x = Math.round((o.x + dx) / 8) * 8;
              n.y = Math.round((o.y + dy) / 8) * 8;
            }
          }
        });
        return;
      }
      onApplyLive((d) => {
        const n = d.nodes.find((x) => x.id === drag.id);
        if (!n) return;
        n.w = Math.max(80, Math.round((drag.w + (p.x - drag.startX)) / 8) * 8);
        n.h = Math.max(48, Math.round((drag.h + (p.y - drag.startY)) / 8) * 8);
      });
    };
    const up = () => {
      if (drag.mode !== "pan") onEndGesture();
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onApplyLive, onEndGesture, svgRef, toWorld]);

  const zoom = (factor: number) => {
    setVb((v) => ({
      x: v.x + (v.w - v.w * factor) / 2,
      y: v.y + (v.h - v.h * factor) / 2,
      w: v.w * factor,
      h: v.h * factor,
    }));
  };

  const startNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const node = diagram.nodes.find((n) => n.id === id);
    if (!node) return;

    if (tool === "connect" && canEdit) {
      if (!pendingFrom) {
        setPendingFrom(id);
      } else if (pendingFrom !== id) {
        onApply((d) => {
          d.edges.push({
            id: `e_${Math.random().toString(36).slice(2, 9)}`,
            from: pendingFrom,
            to: id,
            label: "",
          });
        });
        setPendingFrom(null);
      }
      return;
    }

    const additive = e.shiftKey;
    const ids = additive
      ? selectedNodeIds.includes(id)
        ? selectedNodeIds
        : [...selectedNodeIds, id]
      : selectedNodeIds.includes(id)
        ? selectedNodeIds
        : [id];
    onSelect(ids, null);
    if (!canEdit || node.locked) return;
    const p = toWorld(e.clientX, e.clientY);
    const origin: Record<string, { x: number; y: number }> = {};
    for (const nid of ids) {
      const n = diagram.nodes.find((x) => x.id === nid);
      if (n && !n.locked) origin[nid] = { x: n.x, y: n.y };
    }
    onBeginGesture();
    setDrag({ mode: "move", ids: Object.keys(origin), startX: p.x, startY: p.y, origin });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-lg border border-border">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={(e) => {
          onSelect([], null);
          setPendingFrom(null);
          setDrag({ mode: "pan", startX: e.clientX, startY: e.clientY, vb });
        }}
        onPointerMove={(e) => tool === "connect" && setCursor(toWorld(e.clientX, e.clientY))}
        onDragOver={(e) => {
          if (canEdit) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const kind = e.dataTransfer.getData("application/x-node-kind") as NodeKind;
          if (!kind || !canEdit) return;
          const p = toWorld(e.clientX, e.clientY);
          const meta = KIND_META[kind];
          onAddNode(kind, Math.round((p.x - meta.w / 2) / 8) * 8, Math.round((p.y - meta.h / 2) / 8) * 8);
        }}
      >
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke={CANVAS_COLORS.grid} strokeWidth="1" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={CANVAS_COLORS.edge} />
          </marker>
          <marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={CANVAS_COLORS.selection} />
          </marker>
        </defs>

        <rect x={-100000} y={-100000} width={200000} height={200000} fill={CANVAS_COLORS.bg} />
        <rect
          data-export="false"
          x={-100000}
          y={-100000}
          width={200000}
          height={200000}
          fill="url(#grid)"
        />

        {diagram.edges.map((edge) => {
          const g = edgeGeometry(diagram, edge.from, edge.to);
          if (!g) return null;
          const sel = selectedEdgeId === edge.id;
          return (
            <g key={edge.id} className="cursor-pointer">
              <line
                x1={g.a.x}
                y1={g.a.y}
                x2={g.b.x}
                y2={g.b.y}
                stroke={sel ? CANVAS_COLORS.selection : CANVAS_COLORS.edge}
                strokeWidth={sel ? 2.4 : 1.6}
                markerEnd={`url(#${sel ? "arrow-sel" : "arrow"})`}
              />
              <line
                data-export="false"
                x1={g.a.x}
                y1={g.a.y}
                x2={g.b.x}
                y2={g.b.y}
                stroke="transparent"
                strokeWidth={14}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect([], edge.id);
                }}
              />
              {edge.label && (
                <>
                  <rect
                    x={g.mid.x - edge.label.length * 3.6 - 6}
                    y={g.mid.y - 11}
                    width={edge.label.length * 7.2 + 12}
                    height={20}
                    rx={5}
                    fill={CANVAS_COLORS.bg}
                    stroke={sel ? CANVAS_COLORS.selection : CANVAS_COLORS.grid}
                  />
                  <text
                    x={g.mid.x}
                    y={g.mid.y + 3}
                    textAnchor="middle"
                    fontSize={11}
                    fill={CANVAS_COLORS.subText}
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {edge.label}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {pendingFrom && cursor && (
          <line
            data-export="false"
            x1={nodeCenter(diagram.nodes.find((n) => n.id === pendingFrom)!).x}
            y1={nodeCenter(diagram.nodes.find((n) => n.id === pendingFrom)!).y}
            x2={cursor.x}
            y2={cursor.y}
            stroke={CANVAS_COLORS.selection}
            strokeDasharray="6 4"
            strokeWidth={1.6}
          />
        )}

        {diagram.nodes.map((node) => {
          const selected = selectedNodeIds.includes(node.id);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              onPointerDown={(e) => startNode(e, node.id)}
              style={{ cursor: tool === "connect" ? "crosshair" : canEdit && !node.locked ? "move" : "default" }}
            >
              <NodeShape node={node} selected={selected} />
              {selected && canEdit && !node.locked && (
                <rect
                  data-export="false"
                  x={node.w - 7}
                  y={node.h - 7}
                  width={14}
                  height={14}
                  rx={3}
                  fill={CANVAS_COLORS.selection}
                  style={{ cursor: "nwse-resize" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const p = toWorld(e.clientX, e.clientY);
                    onBeginGesture();
                    setDrag({ mode: "resize", id: node.id, startX: p.x, startY: p.y, w: node.w, h: node.h });
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-auto absolute bottom-3 right-3 flex gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoom(0.85)}
          className="h-7 w-7 rounded text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoom(1.18)}
          className="h-7 w-7 rounded text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Reset view"
          onClick={() => setVb({ x: -100, y: -80, w: 1400, h: 900 })}
          className="h-7 rounded px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Fit
        </button>
      </div>

      {tool === "connect" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-primary/40 bg-card/90 px-3 py-1 text-xs text-primary backdrop-blur">
          {pendingFrom ? "Now click the target component" : "Click the source component"}
        </div>
      )}
    </div>
  );
}
