import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchEyeState = "idle" | "searching" | "found" | "no-results" | "error";

const COLS = 30;
const ROWS = 10;
const LEFT = 9; // eye centers (col)
const RIGHT = 20;

type Pattern = Set<number>;
const key = (c: number, r: number) => r * COLS + c;

function stamp(set: Pattern, cx: number, rows: string[], top: number) {
  rows.forEach((line, r) => {
    const w = line.length;
    const x0 = cx - Math.floor(w / 2);
    [...line].forEach((ch, c) => {
      if (ch === "#") {
        const x = x0 + c;
        const y = top + r;
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) set.add(key(x, y));
      }
    });
  });
}

function both(rows: string[], top: number, dx = 0, dy = 0): Pattern {
  const s: Pattern = new Set();
  stamp(s, LEFT + dx, rows, top + dy);
  stamp(s, RIGHT + dx, rows, top + dy);
  return s;
}

const OPEN = [".####.", "######", "######", "######", ".####."];
const HALF = ["######", "######", ".####."];
const CLOSED = [".####."];
const SQUINT = [".####.", "##..##"];
const HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
const SAD_L = ["##....", ".###..", "..####"];
const SAD_R = ["....##", "..###.", "####.."];
const X = ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"];

function sad(): Pattern {
  const s: Pattern = new Set();
  stamp(s, LEFT, SAD_L, 4);
  stamp(s, RIGHT, SAD_R, 4);
  return s;
}

type Frame = { p: Pattern; color: string };

/**
 * Rectangular dot-matrix LED "eyes" that sit above the search bar.
 * Purely presentational: state is driven by the real search lifecycle.
 */
export function SearchEyes({ state }: { state: SearchEyeState }) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [lookOffset, setLookOffset] = useState({ dx: 0, dy: 0 });
  const [tick, setTick] = useState(0);
  const [idleVariant, setIdleVariant] = useState<"open" | "half" | "closed" | "squint">("open");
  const [pulse, setPulse] = useState(false);

  // Track cursor position across the app window to orient the eyes
  useEffect(() => {
    if (state !== "idle" || reduce) {
      setLookOffset({ dx: 0, dy: 0 });
      return undefined;
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const relX = e.clientX - centerX;
      const relY = e.clientY - centerY;

      // Sensitivity: reach full extent at ~350px horizontal, ~220px vertical
      const normX = Math.max(-1, Math.min(1, relX / 350));
      const normY = Math.max(-1, Math.min(1, relY / 220));

      const dx = Math.round(normX * 3);
      const dy = Math.round(normY * 1);

      setLookOffset((prev) => {
        if (prev.dx === dx && prev.dy === dy) return prev;
        return { dx, dy };
      });
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [state, reduce]);

  // Idle blink loop
  useEffect(() => {
    if (state !== "idle" || reduce) {
      setIdleVariant("open");
      return undefined;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = () => {
      const t = setTimeout(() => {
        const r = Math.random();
        const seq: [typeof idleVariant, number][] =
          r < 0.15
            ? [["squint", 0], ["open", 900]]
            : r < 0.25
              ? [["half", 0], ["closed", 220], ["half", 520], ["open", 640]]
              : [["half", 0], ["closed", 70], ["half", 190], ["open", 260]];
        seq.forEach(([v, d]) => timers.push(setTimeout(() => setIdleVariant(v), d)));
        schedule();
      }, 2800 + Math.random() * 2600);
      timers.push(t);
    };
    schedule();
    return () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
  }, [state, reduce]);

  // Scanning frames
  useEffect(() => {
    if (state !== "searching" || reduce) return undefined;
    setTick(0);
    const t = setInterval(() => setTick((i) => i + 1), 85);
    return () => clearInterval(t);
  }, [state, reduce]);

  // Heart pulse
  useEffect(() => {
    if (state !== "found" || reduce) return undefined;
    const ts = [250, 450, 750, 950].map((d, i) => setTimeout(() => setPulse(i % 2 === 0), d));
    return () => {
      ts.forEach(clearTimeout);
      setPulse(false);
    };
  }, [state, reduce]);

  const frame: Frame = useMemo(() => {
    switch (state) {
      case "searching": {
        // ping-pong sweep: eyes narrow to bars that travel across the panel
        const span = 12;
        const period = span * 2;
        const t = tick % period;
        const dx = (t < span ? t : period - t) - span / 2;
        const s = both(["###", "###", "###", "###"], 3, dx);
        // faint trailing pixels
        return { p: s, color: "var(--led-search)" };
      }
      case "found":
        return { p: both(HEART, 2), color: "var(--led-found)" };
      case "no-results":
        return { p: sad(), color: "var(--led-sad)" };
      case "error":
        return { p: both(X, 2), color: "var(--led-error)" };
      default: {
        const map = { open: [OPEN, 2], half: [HALF, 4], closed: [CLOSED, 5], squint: [SQUINT, 4] } as const;
        const [rows, top] = map[idleVariant];
        const curDx = idleVariant === "closed" ? 0 : lookOffset.dx;
        const curDy = idleVariant === "closed" ? 0 : lookOffset.dy;
        return { p: both([...rows], top + curDy, curDx), color: "var(--led-idle)" };
      }
    }
  }, [state, tick, idleVariant, lookOffset]);

  const cells = useMemo(() => Array.from({ length: COLS * ROWS }, (_, i) => i), []);

  return (
    <motion.div
      ref={containerRef}
      role="img"
      aria-label={`Nexus status: ${state}`}
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: pulse ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="mx-auto w-[min(56vw,220px)] rounded-2xl border border-border p-2.5 sm:w-[240px]"
      style={{
        background: "var(--led-panel)",
        boxShadow: `inset 0 1px 0 color-mix(in oklab, white 5%, transparent), 0 10px 40px -18px color-mix(in oklab, ${frame.color} 45%, transparent)`,
        transition: "box-shadow 500ms ease",
      }}
    >
      <div
        className="grid gap-[1.5px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {cells.map((i) => {
          const on = frame.p.has(i);
          return (
            <span
              key={i}
              className="aspect-square rounded-[1.5px]"
              style={{
                background: on ? frame.color : "var(--led-off)",
                opacity: on ? 1 : 0.35,
                boxShadow: on ? `0 0 4px ${frame.color}` : "none",
                transition:
                  state === "searching"
                    ? "background 60ms linear, opacity 180ms ease-out, box-shadow 180ms"
                    : "background 140ms ease, opacity 140ms ease, box-shadow 140ms ease",
              }}
            />
          );
        })}
      </div>
    </motion.div>
  );
}
