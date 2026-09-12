import type { NodeKind } from "@/services/api";

export type Shape = "rect" | "round" | "cylinder" | "queue" | "hex" | "note" | "plain";

export interface KindMeta {
  label: string;
  shape: Shape;
  accent: string;
  w: number;
  h: number;
  hint: string;
}

/**
 * Canvas palette. These are literal colors on purpose: the SVG is serialized
 * verbatim for SVG/PNG export, where CSS variables would not resolve.
 */
export const CANVAS_COLORS = {
  bg: "#141a24",
  grid: "#1e2734",
  gridStrong: "#26313f",
  nodeFill: "#1c2532",
  nodeText: "#e8eef6",
  subText: "#9aa9bc",
  edge: "#7b8ea6",
  selection: "#5ee0cd",
  lock: "#f0b23a",
};

export const KIND_META: Record<NodeKind, KindMeta> = {
  service: {
    label: "Service",
    shape: "round",
    accent: "#5ee0cd",
    w: 160,
    h: 76,
    hint: "Stateless application service",
  },
  llm: {
    label: "LLM",
    shape: "hex",
    accent: "#b98cf5",
    w: 160,
    h: 84,
    hint: "Model / inference endpoint",
  },
  database: {
    label: "Database",
    shape: "cylinder",
    accent: "#69b7ff",
    w: 150,
    h: 96,
    hint: "Persistent store",
  },
  queue: {
    label: "Queue",
    shape: "queue",
    accent: "#f2a15c",
    w: 168,
    h: 68,
    hint: "Async message broker",
  },
  cache: {
    label: "Cache",
    shape: "round",
    accent: "#f5d76e",
    w: 140,
    h: 68,
    hint: "In-memory fast path",
  },
  client: {
    label: "Client",
    shape: "rect",
    accent: "#8fe38a",
    w: 140,
    h: 72,
    hint: "Browser, mobile or CLI",
  },
  external: {
    label: "External System",
    shape: "rect",
    accent: "#f57f9a",
    w: 176,
    h: 76,
    hint: "Third-party dependency",
  },
  rectangle: {
    label: "Rectangle",
    shape: "plain",
    accent: "#8ea0b8",
    w: 220,
    h: 140,
    hint: "Grouping box",
  },
  note: {
    label: "Note",
    shape: "note",
    accent: "#f0c96b",
    w: 180,
    h: 110,
    hint: "Free text annotation",
  },
};
