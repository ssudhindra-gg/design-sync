import type { Diagram, DiagramNode } from "@/services/api";

export interface Point {
  x: number;
  y: number;
}

export function nodeCenter(n: DiagramNode): Point {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** Intersection of the line center->target with the node's bounding box. */
export function borderPoint(n: DiagramNode, toward: Point): Point {
  const c = nodeCenter(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = n.w / 2 + 6;
  const hh = n.h / 2 + 6;
  const scale = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export function edgeGeometry(diagram: Diagram, fromId: string, toId: string) {
  const from = diagram.nodes.find((n) => n.id === fromId);
  const to = diagram.nodes.find((n) => n.id === toId);
  if (!from || !to) return null;
  const a = borderPoint(from, nodeCenter(to));
  const b = borderPoint(to, nodeCenter(from));
  return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

export function diagramBounds(diagram: Diagram, pad = 60) {
  if (diagram.nodes.length === 0) return { x: 0, y: 0, w: 900, h: 600 };
  const xs = diagram.nodes.flatMap((n) => [n.x, n.x + n.w]);
  const ys = diagram.nodes.flatMap((n) => [n.y, n.y + n.h]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX + pad,
    h: Math.max(...ys) - minY + pad,
  };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportJson(diagram: Diagram, name: string) {
  download(
    new Blob([JSON.stringify(diagram, null, 2)], { type: "application/json" }),
    `${name}.json`,
  );
}

/** Clones the live canvas, strips interactive-only chrome and reframes it. */
export function buildExportSvg(svg: SVGSVGElement, diagram: Diagram): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export="false"]').forEach((el) => el.remove());
  const b = diagramBounds(diagram);
  clone.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  clone.setAttribute("width", String(Math.round(b.w)));
  clone.setAttribute("height", String(Math.round(b.h)));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.style.removeProperty("touch-action");
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svg: SVGSVGElement, diagram: Diagram, name: string) {
  download(new Blob([buildExportSvg(svg, diagram)], { type: "image/svg+xml" }), `${name}.svg`);
}

export async function exportPng(svg: SVGSVGElement, diagram: Diagram, name: string) {
  const source = buildExportSvg(svg, diagram);
  const b = diagramBounds(diagram);
  const scale = 2;
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not rasterize diagram"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(b.w * scale);
  canvas.height = Math.round(b.h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${name}.png`);
      resolve();
    }, "image/png"),
  );
}
