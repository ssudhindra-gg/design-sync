import { CANVAS_COLORS, KIND_META } from "@/lib/diagram-theme";
import type { DiagramNode } from "@/services/api";

function wrap(text: string, perLine: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > perLine) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

export function NodeShape({ node, selected }: { node: DiagramNode; selected: boolean }) {
  const meta = KIND_META[node.kind];
  const { w, h } = node;
  const stroke = selected ? CANVAS_COLORS.selection : meta.accent;
  const strokeWidth = selected ? 2.5 : 1.6;
  const common = {
    fill: node.kind === "note" ? "#2a2519" : CANVAS_COLORS.nodeFill,
    stroke,
    strokeWidth,
  };

  let body: React.ReactNode;
  switch (meta.shape) {
    case "cylinder": {
      const ry = 12;
      body = (
        <>
          <path
            d={`M0,${ry} a${w / 2},${ry} 0 0 1 ${w},0 v${h - ry * 2} a${w / 2},${ry} 0 0 1 -${w},0 z`}
            {...common}
          />
          <path
            d={`M0,${ry} a${w / 2},${ry} 0 0 0 ${w},0`}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={0.7}
          />
        </>
      );
      break;
    }
    case "queue":
      body = (
        <>
          <rect width={w} height={h} rx={6} {...common} />
          {[0.33, 0.66].map((f) => (
            <line
              key={f}
              x1={w * f}
              y1={0}
              x2={w * f}
              y2={h}
              stroke={stroke}
              strokeWidth={1}
              opacity={0.4}
            />
          ))}
        </>
      );
      break;
    case "hex":
      body = (
        <path
          d={`M${h / 3},0 H${w - h / 3} L${w},${h / 2} L${w - h / 3},${h} H${h / 3} L0,${h / 2} Z`}
          {...common}
        />
      );
      break;
    case "note":
      body = (
        <path
          d={`M0,0 H${w} V${h - 18} L${w - 18},${h} H0 Z`}
          {...common}
          strokeDasharray="0"
        />
      );
      break;
    case "plain":
      body = (
        <rect width={w} height={h} rx={4} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray="6 5" />
      );
      break;
    case "round":
      body = <rect width={w} height={h} rx={18} {...common} />;
      break;
    default:
      body = <rect width={w} height={h} rx={4} {...common} />;
  }

  const showKind = node.kind !== "rectangle" && node.kind !== "note";
  const lines = node.kind === "note" ? wrap(node.label, 22) : [node.label];

  return (
    <>
      {body}
      {node.kind === "note" ? (
        <text x={14} y={26} fill={CANVAS_COLORS.nodeText} fontSize={13} fontFamily="IBM Plex Sans, sans-serif">
          {lines.map((l, i) => (
            <tspan key={i} x={14} dy={i === 0 ? 0 : 18}>
              {l}
            </tspan>
          ))}
        </text>
      ) : node.kind === "rectangle" ? (
        <text x={10} y={20} fill={meta.accent} fontSize={12} fontFamily="IBM Plex Sans, sans-serif" letterSpacing="0.08em">
          {node.label.toUpperCase()}
        </text>
      ) : (
        <>
          <text
            x={w / 2}
            y={showKind ? h / 2 + 2 : h / 2 + 5}
            textAnchor="middle"
            fill={CANVAS_COLORS.nodeText}
            fontSize={14}
            fontWeight={600}
            fontFamily="Space Grotesk, sans-serif"
          >
            {node.label}
          </text>
          {showKind && (
            <text
              x={w / 2}
              y={h / 2 + 20}
              textAnchor="middle"
              fill={meta.accent}
              fontSize={10}
              letterSpacing="0.12em"
              fontFamily="IBM Plex Mono, monospace"
            >
              {meta.label.toUpperCase()}
            </text>
          )}
        </>
      )}
      {node.locked && (
        <g transform={`translate(${w - 18},6)`}>
          <rect width={12} height={10} y={4} rx={2} fill={CANVAS_COLORS.lock} />
          <path d="M2,4 a4,4 0 0 1 8,0" fill="none" stroke={CANVAS_COLORS.lock} strokeWidth={1.6} />
        </g>
      )}
    </>
  );
}
