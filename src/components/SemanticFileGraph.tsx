import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import type { SearchPhase } from "@/components/SemanticSearchAnimation";

type Kind = "doc" | "folder" | "diamond" | "circle";
interface GNode {
  id: number;
  x: number;
  y: number;
  kind: Kind;
  s: number;
  drift: boolean;
}

const W = 1600;
const H = 1000;
const MATCH_ID = 7;

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function rand(seed: number) {
  const v = Math.sin(seed * 127.1 + 11.7) * 43758.5453;
  return Math.round((v - Math.floor(v)) * 1000) / 1000;
}

function buildNodes(): GNode[] {
  const nodes: GNode[] = [];
  // clustered distribution around a few semantic centers + scatter
  const clusters = [
    [260, 250],
    [1340, 230],
    [1260, 720],
    [330, 760],
    [800, 120],
  ];
  for (let i = 0; i < 66; i++) {
    const c = clusters[i % clusters.length]!;
    const scatter = i % 3 === 0;
    const x = scatter ? 40 + rand(i + 1) * (W - 80) : c[0]! + (rand(i + 2) - 0.5) * 420;
    const y = scatter ? 40 + rand(i + 3) * (H - 80) : c[1]! + (rand(i + 4) - 0.5) * 330;
    const r = rand(i + 5);
    const kind: Kind = r < 0.55 ? "doc" : r < 0.72 ? "folder" : r < 0.86 ? "diamond" : "circle";
    nodes.push({
      id: i,
      x: round(Math.min(W - 30, Math.max(30, x))),
      y: round(Math.min(H - 30, Math.max(30, y))),
      kind,
      s: round(0.8 + rand(i + 6) * 0.5),
      drift: rand(i + 7) > 0.8,
    });
  }
  // keep the central search column quieter
  return nodes.filter((n) => !(n.x > 560 && n.x < 1040 && n.y > 180 && n.y < 560) || n.id === MATCH_ID);
}

function Glyph({ n, active, match }: { n: GNode; active: boolean; match: boolean }) {
  const stroke = active || match ? "var(--brand)" : "var(--graph)";
  const sw = match ? 1.6 : 1.1;
  const common = { fill: "none", stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  switch (n.kind) {
    case "doc":
      return (
        <g {...common}>
          <path d="M-8 -11 H4 L9 -6 V11 H-8 Z" />
          <path d="M4 -11 V-6 H9" />
          <path d="M-4 -1 H5 M-4 3 H5 M-4 7 H2" strokeWidth={0.8} />
        </g>
      );
    case "folder":
      return <path {...common} d="M-11 -7 H-3 L0 -4 H11 V8 H-11 Z" />;
    case "diamond":
      return <path {...common} d="M0 -5 L5 0 L0 5 L-5 0 Z" />;
    default:
      return <circle {...common} r={3.5} />;
  }
}

/**
 * Background "indexed filesystem": muted file/folder glyphs linked by thin
 * semantic edges. Mostly static; a few nodes drift. During search, clusters
 * light up in the accent colour; on results the matched node glows.
 */
export function SemanticFileGraph({
  phase,
  found,
}: {
  phase: SearchPhase;
  found: boolean | null;
}) {
  const nodes = useMemo(buildNodes, []);
  const links = useMemo(() => {
    const out: Array<[GNode, GNode]> = [];
    nodes.forEach((a, i) => {
      const near = nodes
        .slice(i + 1)
        .map((b) => ({ b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((o) => o.d < 230)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      near.forEach(({ b }) => out.push([a, b]));
    });
    return out;
  }, [nodes]);

  const [activeSet, setActiveSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (phase !== "searching") {
      setActiveSet(new Set());
      return;
    }
    let tick = 0;
    const pick = () => {
      const s = new Set<number>();
      const pivot = nodes[(tick * 7 + 3) % nodes.length]!;
      nodes
        .map((n) => ({ n, d: Math.hypot(n.x - pivot.x, n.y - pivot.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5)
        .forEach(({ n }) => s.add(n.id));
      setActiveSet(s);
      tick += 1;
    };
    pick();
    const t = setInterval(pick, 700);
    return () => clearInterval(t);
  }, [phase, nodes]);

  const showMatch = phase === "results" && found === true;
  const engaged = phase !== "idle";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: engaged ? 1 : 0.8 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      >
        <g>
          {links.map(([a, b], i) => {
            const hot =
              (activeSet.has(a.id) && activeSet.has(b.id)) ||
              (showMatch && (a.id === MATCH_ID || b.id === MATCH_ID));
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={hot ? 1.1 : 0.7}
                stroke={hot ? "var(--brand)" : "var(--graph)"}
                opacity={hot ? 0.7 : 0.16}
                className="transition-all duration-300"
              />
            );
          })}
        </g>

        {nodes.map((n) => {
          const active = activeSet.has(n.id);
          const match = showMatch && n.id === MATCH_ID;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y}) scale(${match ? 1.4 * n.s : active ? 1.15 * n.s : n.s})`}
              className="transition-all duration-300 ease-out"
              style={{
                opacity: match ? 1 : active ? 0.85 : 0.18,
              }}
            >
              <Glyph n={n} active={active} match={match} />
              {(active || match) && (
                <circle
                  r={16}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth={0.8}
                  strokeDasharray={match ? "0" : "2 4"}
                  className="animate-pulse"
                />
              )}
            </g>
          );
        })}
      </motion.svg>
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 42%, transparent 30%, var(--background) 100%)",
        }}
      />
    </div>
  );
}
