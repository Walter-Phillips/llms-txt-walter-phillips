"use client";

/**
 * Ambient, monochrome ASCII pipe automaton rendered to a full-bleed canvas
 * behind the home hero. Pipes grow from seeds along box-drawing connections,
 * then fade over time so the network perpetually crawls — a nod to the crawler
 * spidering through a site. Home page only; pauses when the tab is hidden.
 */
import { useEffect, useRef, type ReactElement } from "react";

const PF_ROADS = "┃━┏┓┗┛┣┫┳┻╋";
const FONT = 16;
const GROW_P = 0.085;
const DECAY = 0.005;
const MAX_A = 0.11;

interface PipeField {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  chars: string[];
  life: Float32Array;
}

function pfChoose(list: string): string {
  return list.charAt(Math.floor(Math.random() * list.length));
}

function newField(): PipeField {
  return {
    cols: 0,
    rows: 0,
    cw: FONT * 0.6,
    ch: FONT * 1.16,
    chars: [],
    life: new Float32Array(0),
  };
}

function pfRender(field: PipeField, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < field.rows; y++) {
    for (let x = 0; x < field.cols; x++) {
      const i = y * field.cols + x;
      const c = field.chars[i];
      if (c === " ") continue;
      const a = Math.min(field.life[i], 1) * MAX_A;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillText(c, x * field.cw, y * field.ch);
    }
  }
}

function pfResize(field: PipeField, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.font = `${String(FONT)}px "Geist Mono", ui-monospace, monospace`;
  ctx.textBaseline = "top";
  field.cw = ctx.measureText("┃").width || FONT * 0.6;
  field.ch = FONT * 1.16;
  field.cols = Math.ceil(w / field.cw) + 1;
  field.rows = Math.ceil(h / field.ch) + 1;
  field.chars = new Array<string>(field.cols * field.rows).fill(" ");
  field.life = new Float32Array(field.cols * field.rows);
  for (let i = 0; i < field.cols * field.rows; i++) {
    if (Math.random() < 0.0016) {
      field.chars[i] = pfChoose(PF_ROADS);
      field.life[i] = 1;
    }
  }
}

interface FieldSnapshot {
  chars: string[];
  life: Float32Array;
}

/** Decide the box-drawing glyph that should grow into an empty cell, if any. */
function grownChar(field: PipeField, snap: FieldSnapshot, x: number, y: number): string {
  const get = (dx: number, dy: number): { c: string; alive: boolean } => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= field.cols || ny < 0 || ny >= field.rows) return { c: " ", alive: false };
    const i = ny * field.cols + nx;
    return { c: snap.chars[i], alive: snap.life[i] > 0.5 };
  };
  const top = get(0, -1);
  const bottom = get(0, 1);
  const left = get(-1, 0);
  const right = get(1, 0);
  if (top.alive && "┃┫┣╋┏┓┳".includes(top.c)) return pfChoose("┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┗┫┣┻╋");
  if (bottom.alive && "┃┗┛┣┫┻╋".includes(bottom.c)) return pfChoose("┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┏┓┣┫┳╋");
  if (left.alive && "━┏┗┣┳┻╋".includes(left.c)) return pfChoose("━━━━━━━━━━━━━━━━━━━━┓┛┫┳┻╋");
  if (right.alive && "━┓┛┫┳┻╋".includes(right.c)) return pfChoose("━━━━━━━━━━━━━━━━━━━━┏┗┣┳┻╋");
  return " ";
}

function pfStep(field: PipeField): void {
  const previous = field.chars.slice();
  const previousLife = field.life.slice();
  for (let y = 0; y < field.rows; y++) {
    for (let x = 0; x < field.cols; x++) {
      const i = y * field.cols + x;
      if (previous[i] !== " ") {
        field.life[i] = previousLife[i] - DECAY;
        if (field.life[i] <= 0) {
          field.chars[i] = " ";
          field.life[i] = 0;
        }
        continue;
      }
      if (Math.random() > GROW_P) continue;
      const c = grownChar(field, { chars: previous, life: previousLife }, x, y);
      if (c !== " ") {
        field.chars[i] = c;
        field.life[i] = 1;
      }
    }
  }
  const seeds = 1 + Math.floor(Math.random() * 2);
  for (let s = 0; s < seeds; s++) {
    const i = Math.floor(Math.random() * field.cols * field.rows);
    if (field.chars[i] === " ") {
      field.chars[i] = pfChoose(PF_ROADS);
      field.life[i] = 1;
    }
  }
}

export function HomePathfinder(): ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const field = newField();

    const sync = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pfResize(field, ctx, w, h);
      pfRender(field, ctx, canvas.width, canvas.height);
    };
    sync();

    const TICK = 1000 / 14;
    let raf = 0;
    let running = true;
    let accumulator = 0;
    let lastT = performance.now();
    const loop = (nowT: number): void => {
      if (!running) return;
      accumulator += nowT - lastT;
      lastT = nowT;
      let did = false;
      while (accumulator >= TICK) {
        pfStep(field);
        accumulator -= TICK;
        did = true;
      }
      if (did) pfRender(field, ctx, canvas.width, canvas.height);
      raf = requestAnimationFrame(loop);
    };
    if (!reduce) raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    const onVisibility = (): void => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && !reduce) {
        running = true;
        lastT = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="pathfinder-canvas" aria-hidden="true" />;
}
