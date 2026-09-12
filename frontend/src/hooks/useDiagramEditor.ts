import { useCallback, useRef, useState } from "react";
import type { Diagram } from "@/services/api";

const EMPTY: Diagram = { nodes: [], edges: [] };

function clone(d: Diagram): Diagram {
  return JSON.parse(JSON.stringify(d)) as Diagram;
}

export function useDiagramEditor(onCommit?: (d: Diagram) => void) {
  const [diagram, setDiagram] = useState<Diagram>(EMPTY);
  const past = useRef<Diagram[]>([]);
  const future = useRef<Diagram[]>([]);
  const transientBase = useRef<Diagram | null>(null);
  const [, bump] = useState(0);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  /** Discrete edit: one history entry, saved immediately. */
  const apply = useCallback((mutate: (draft: Diagram) => void) => {
    setDiagram((current) => {
      const next = clone(current);
      mutate(next);
      past.current = [...past.current.slice(-59), clone(current)];
      future.current = [];
      commitRef.current?.(next);
      bump((v) => v + 1);
      return next;
    });
  }, []);

  /** Start of a drag/resize gesture: remembers one undo point. */
  const beginGesture = useCallback(() => {
    setDiagram((current) => {
      transientBase.current = clone(current);
      return current;
    });
  }, []);

  /** During a gesture: no history entry, no network write. */
  const applyLive = useCallback((mutate: (draft: Diagram) => void) => {
    setDiagram((current) => {
      const next = clone(current);
      mutate(next);
      return next;
    });
  }, []);

  const endGesture = useCallback(() => {
    setDiagram((current) => {
      if (transientBase.current) {
        past.current = [...past.current.slice(-59), transientBase.current];
        future.current = [];
        transientBase.current = null;
        commitRef.current?.(current);
        bump((v) => v + 1);
      }
      return current;
    });
  }, []);

  /** Remote update: replaces state without polluting the undo stack. */
  const replace = useCallback((next: Diagram) => {
    setDiagram(clone(next));
  }, []);

  const undo = useCallback(() => {
    setDiagram((current) => {
      const prev = past.current.pop();
      if (!prev) return current;
      future.current = [...future.current, clone(current)];
      commitRef.current?.(prev);
      bump((v) => v + 1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setDiagram((current) => {
      const next = future.current.pop();
      if (!next) return current;
      past.current = [...past.current, clone(current)];
      commitRef.current?.(next);
      bump((v) => v + 1);
      return next;
    });
  }, []);

  return {
    diagram,
    apply,
    applyLive,
    beginGesture,
    endGesture,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
