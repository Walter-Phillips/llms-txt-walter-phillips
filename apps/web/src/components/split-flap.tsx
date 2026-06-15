"use client";

/**
 * Solari / split-flap display that rotates through common LLM names. Two-leaf
 * fold per cell with a staggered left→right cascade. The board sizes to the
 * current word — extra cells collapse to zero width so there are never trailing
 * empty boxes. Ordered by length so the tile count changes by at most one
 * between consecutive names (the only 2-tile shift is the loop reset).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

const SF_NAMES = ["Claude", "ChatGPT", "Copilot", "Mistral", "Gemini", "Llama", "Grok"];
const SF_LEN = Math.max(...SF_NAMES.map((n) => n.length));
const SF_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Flap({
  target,
  index,
  active,
}: {
  target: string;
  index: number;
  active: boolean;
}): ReactElement {
  const [current, setCurrent] = useState(target || " ");
  const [next, setNext] = useState(target || " ");
  const [flip, setFlip] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!active) return;
    const goal = target || " ";
    if (goal === current) return;

    if (prefersReducedMotion()) {
      setCurrent(goal);
      setNext(goal);
      return;
    }

    const steps = 3 + index + Math.floor(Math.random() * 2);
    const seq: string[] = [];
    for (let k = 0; k < steps; k++) {
      seq.push(SF_CHARSET[Math.floor(Math.random() * SF_CHARSET.length)]);
    }
    seq.push(goal);

    let from = current;
    let k = 0;
    timers.current.forEach(clearTimeout);
    timers.current = [];

    function tick(): void {
      const to = seq[k];
      setCurrent(from);
      setNext(to);
      setFlip((f) => f + 1);
      const t = setTimeout(() => {
        from = to;
        setCurrent(to);
        k += 1;
        if (k < seq.length) timers.current.push(setTimeout(tick, 12));
      }, 115);
      timers.current.push(t);
    }
    tick();

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active]);

  const anim = flip > 0 ? "sf-anim" : "";
  return (
    <span className={`sf-cell ${active ? "sf-on" : "sf-off"}`} aria-hidden="true">
      <span className="sf-card sf-upper">
        <b>{next}</b>
      </span>
      <span className="sf-card sf-lower">
        <b>{current}</b>
      </span>
      <span className={`sf-leaf sf-leaf-top ${anim}`} key={`t${String(flip)}`}>
        <b>{current}</b>
      </span>
      <span className={`sf-leaf sf-leaf-bottom ${anim}`} key={`b${String(flip)}`}>
        <b>{next}</b>
      </span>
    </span>
  );
}

export function SplitFlapBoard(): ReactElement {
  const [wi, setWi] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setWi((w) => (w + 1) % SF_NAMES.length);
    }, 2800);
    return () => {
      clearInterval(id);
    };
  }, []);
  const word = SF_NAMES[wi];
  return (
    <span className="sf-board" role="text" aria-label={word}>
      {Array.from({ length: SF_LEN }).map((_, i) => (
        <Flap key={i} index={i} active={i < word.length} target={word[i] || ""} />
      ))}
    </span>
  );
}
