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
  const [version, setVersion] = useState(0);

  /** Local edit: pushes history and notifies the backend. */
  const apply = useCallback(
    (mutate: (draft: Diagram) => void) => {
      setDiagram((current) => {
        const next = clone(current);
        mutate(next);
        past.current = [...past.current.slice(-49), clone(current)];
        future.current = [];
        setVersion((v) => v + 1);
        onCommit?.(next);
        return next;
      });
    },
    [onCommit],
  );

  /** Remote update: replaces state without polluting the undo stack. */
  const replace = useCallback((next: Diagram) => {
    setDiagram(clone(next));
  }, []);

  const undo = useCallback(() => {
    setDiagram((current) => {
      const prev = past.current.pop();
      if (!prev) return current;
      future.current = [...future.current, clone(current)];
      setVersion((v) => v + 1);
      onCommit?.(prev);
      return prev;
    });
  }, [onCommit]);

  const redo = useCallback(() => {
    setDiagram((current) => {
      const next = future.current.pop();
      if (!next) return current;
      past.current = [...past.current, clone(current)];
      setVersion((v) => v + 1);
      onCommit?.(next);
      return next;
    });
  }, [onCommit]);

  return {
    diagram,
    apply,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    version,
  };
}
