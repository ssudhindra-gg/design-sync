import { describe, expect, it } from "vitest";

import type { Diagram, DiagramNode } from "@/services/api";

import { borderPoint, diagramBounds, edgeGeometry, nodeCenter } from "./diagram-utils";

function node(id: string, x: number, y: number, w = 100, h = 50): DiagramNode {
  return { id, kind: "service", label: id, x, y, w, h };
}

describe("nodeCenter", () => {
  it("is the middle of the node's box", () => {
    expect(nodeCenter(node("a", 10, 20))).toEqual({ x: 60, y: 45 });
  });
});

describe("borderPoint", () => {
  const a = node("a", 10, 20); // center (60, 45), 6px gap outside the border

  it("leaves through the right edge toward a point to the right", () => {
    expect(borderPoint(a, { x: 500, y: 45 })).toEqual({ x: 116, y: 45 });
  });

  it("leaves through the bottom edge toward a point below", () => {
    expect(borderPoint(a, { x: 60, y: 500 })).toEqual({ x: 60, y: 76 });
  });

  it("returns the center when the target is the center", () => {
    expect(borderPoint(a, { x: 60, y: 45 })).toEqual({ x: 60, y: 45 });
  });
});

describe("edgeGeometry", () => {
  const diagram: Diagram = { nodes: [node("a", 0, 0), node("b", 300, 0)], edges: [] };

  it("runs border to border with the midpoint between", () => {
    expect(edgeGeometry(diagram, "a", "b")).toEqual({
      a: { x: 106, y: 25 },
      b: { x: 294, y: 25 },
      mid: { x: 200, y: 25 },
    });
  });

  it("is null when an end is missing", () => {
    expect(edgeGeometry(diagram, "a", "missing")).toBeNull();
  });
});

describe("diagramBounds", () => {
  it("has a default frame for an empty diagram", () => {
    expect(diagramBounds({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0, w: 900, h: 600 });
  });

  it("pads around the nodes", () => {
    expect(diagramBounds({ nodes: [node("a", 10, 20)], edges: [] })).toEqual({
      x: -50,
      y: -40,
      w: 220,
      h: 170,
    });
  });
});
