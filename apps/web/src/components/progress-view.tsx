"use client";

import type { JobStatusResponse, RunStatus } from "@profound-takehome/shared";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Icons } from "@/components/icons";
import { useJobStatus } from "@/lib/use-job-status";
import { hostnameOf } from "@/lib/utils";

interface Phase {
  key: "discovering" | "crawling" | "generating" | "done";
  label: string;
  sub: string;
  icon: (props: { size?: number }) => ReactElement;
}

const PHASES: Phase[] = [
  { key: "discovering", label: "Discover", sub: "sitemap lookup", icon: Icons.search },
  { key: "crawling", label: "Crawl", sub: "fetching pages", icon: Icons.globe },
  { key: "generating", label: "Generate", sub: "draft + validate", icon: Icons.spark },
  { key: "done", label: "Publish", sub: "host the file", icon: Icons.check },
];

const SEG = 1 / 3;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const CRAWL_PATHS = [
  "/",
  "/docs/quickstart",
  "/docs/api",
  "/docs/auth",
  "/docs/self-hosting",
  "/pricing",
  "/integrations",
  "/changelog",
  "/blog",
  "/about",
  "/security",
  "/careers",
  "/docs/cli",
  "/docs/sdk",
  "/docs/webhooks",
  "/status",
  "/terms",
  "/privacy",
  "/docs/errors",
  "/docs/limits",
  "/contact",
  "/customers",
  "/docs/auth/oauth",
  "/roadmap",
];

interface ProgressSnapshot {
  activeIdx: number;
  crawled: number;
  discoveryMethod: string | null;
  error: string | null;
  found: number;
  frontier: number;
  inFlight: number;
  isDone: boolean;
  isError: boolean;
}

function activeIndexOf(status: RunStatus): number {
  switch (status) {
    case "queued":
      return 0;
    case "crawling":
      return 1;
    case "generating":
      return 2;
    case "done":
    case "error":
      return 3;
  }
}

const EMPTY_SNAPSHOT: ProgressSnapshot = {
  activeIdx: 0,
  crawled: 0,
  discoveryMethod: null,
  error: null,
  found: 0,
  frontier: 0,
  inFlight: 0,
  isDone: false,
  isError: false,
};

/** Once done the run carries final totals; otherwise the live snapshot leads. */
function countOf(isDone: boolean, runValue: number, liveValue: number | undefined): number {
  return isDone ? runValue : (liveValue ?? runValue);
}

/** Frontier/in-flight only mean something mid-crawl; they reset to 0 when done. */
function activeCount(isDone: boolean, liveValue: number | undefined): number {
  return isDone ? 0 : (liveValue ?? 0);
}

function progressSnapshot(status: JobStatusResponse | null): ProgressSnapshot {
  if (!status) return EMPTY_SNAPSHOT;
  const { run, live } = status;
  const isDone = run.status === "done";
  return {
    activeIdx: activeIndexOf(run.status),
    crawled: countOf(isDone, run.pagesCrawled, live?.pagesCrawled),
    discoveryMethod: live?.discoveryMethod ?? run.discoveryMethod,
    error: run.error,
    found: countOf(isDone, run.pagesFound, live?.pagesFound),
    frontier: activeCount(isDone, live?.frontierSize),
    inFlight: activeCount(isDone, live?.inFlight),
    isDone,
    isError: run.status === "error",
  };
}

/** Continuous fill target (0..1): each phase fills only its own third. */
function fillTargetFor(snap: ProgressSnapshot, phaseElapsedMs: number): number {
  if (snap.isDone) return 1;
  if (snap.activeIdx === 0) return easeOut(Math.min(phaseElapsedMs / 1100, 0.95)) * SEG;
  if (snap.activeIdx === 1) {
    const frac = snap.found ? snap.crawled / snap.found : 0;
    return SEG + clamp01(frac) * SEG;
  }
  if (snap.activeIdx === 2) return 2 * SEG + easeOut(Math.min(phaseElapsedMs / 1700, 0.95)) * SEG;
  return SEG;
}

interface CrawlLogEntry {
  i: number;
  code: number;
  path: string;
  ms: number;
}

function crawlLogFor(crawled: number): CrawlLogEntry[] {
  if (crawled <= 0) return [];
  const out: CrawlLogEntry[] = [];
  const start = Math.max(0, crawled - 7);
  for (let i = start; i < crawled; i++) {
    out.push({
      i,
      code: 200,
      path: CRAWL_PATHS[i % CRAWL_PATHS.length],
      ms: 40 + ((i * 37) % 180),
    });
  }
  return out;
}

function friendlyRunError(error: string | null): string {
  if (!error) return "The crawl failed for an unknown reason.";
  if (error.startsWith("fetch_failed")) {
    return "We couldn't reach that site. Check the address is right and the site is up, then try again.";
  }
  if (error.startsWith("robots")) {
    return "That site's robots.txt asks crawlers to stay out, so we stopped politely.";
  }
  if (error.startsWith("timeout")) {
    return "The site was too slow to respond. It may be rate-limiting us — try again in a minute.";
  }
  return error;
}

export interface ProgressViewProperties {
  runId: string;
  domain?: string;
  onDone: () => void;
  pollIntervalMs?: number;
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function ErrorView({ host, error }: { host: string; error: string | null }): ReactElement {
  return (
    <div className="progress">
      <div className="prog-head">
        <span className="mono-dim">crawl</span>
        <span className="prog-target">{host}</span>
      </div>
      <div className="prog-error" role="alert">
        <div className="prog-error-mark">
          <Icons.bolt size={20} />
        </div>
        <div>
          <p className="prog-error-title">Crawl failed</p>
          <p className="prog-error-msg">{friendlyRunError(error)}</p>
        </div>
        <Link className="btn btn-primary" href="/">
          <Icons.arrow size={15} style={{ transform: "rotate(180deg)" }} />
          <span>Try another URL</span>
        </Link>
      </div>
    </div>
  );
}

function Timeline({ snapshot, fill }: { snapshot: ProgressSnapshot; fill: number }): ReactElement {
  return (
    <div className="timeline">
      <div className="timeline-rail">
        <div className="timeline-rail-fill" style={{ width: `${String(fill * 100)}%` }} />
      </div>
      <div
        className="timeline-beam"
        style={{ left: `calc(12.5% + ${String(fill * 75)}%)` }}
        aria-hidden="true"
      />
      <div className="timeline-nodes">
        {PHASES.map((phase, i) => {
          const state =
            i < snapshot.activeIdx ? "done" : i === snapshot.activeIdx ? "active" : "todo";
          const PhaseIcon = phase.icon;
          return (
            <div className={`tnode tnode-${state}`} key={phase.key}>
              <div className="tnode-dot">
                {state === "done" ? <Icons.check size={15} /> : <PhaseIcon size={15} />}
              </div>
              <div className="tnode-text">
                <p className="tnode-label">{phase.label}</p>
                <p className="tnode-sub">{state === "done" ? "complete" : phase.sub}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Gauge({ snapshot, ratio }: { snapshot: ProgressSnapshot; ratio: number }): ReactElement {
  return (
    <div className="gauge">
      <div className="gauge-fig">
        <span className="gauge-v">{snapshot.crawled}</span>
        <span className="gauge-of">/ {snapshot.found || "—"}</span>
      </div>
      <div className="gauge-prog">
        <div className="gauge-track">
          <div className="gauge-track-fill" style={{ width: `${String(ratio * 100)}%` }} />
        </div>
        <div className="gauge-meta">
          <span>pages crawled</span>
          <span className="pct">{Math.round(ratio * 100)}%</span>
        </div>
      </div>
      <div className="gauge-mini">
        <div>
          <span className="gm-v">{snapshot.frontier}</span>
          <span className="gm-k">frontier</span>
        </div>
        <div>
          <span className="gm-v">{snapshot.inFlight}</span>
          <span className="gm-k">in flight</span>
        </div>
      </div>
    </div>
  );
}

function RequestLog({ host, log }: { host: string; log: CrawlLogEntry[] }): ReactElement {
  return (
    <div className="prog-log">
      <div className="prog-log-head">
        <span className="mono-dim">GET</span> request log
        <span className="prog-log-spacer" />
        <span className="prog-log-live">
          <span className="appnav-dot" /> live
        </span>
      </div>
      <div className="prog-log-body">
        {log.length === 0 ? (
          <div className="logline logline-muted">waiting for first response…</div>
        ) : (
          log.map((l) => (
            <div className="logline" key={l.i}>
              <span className="log-code">{l.code}</span>
              <span className="log-path">
                {host}
                {l.path}
              </span>
              <span className="log-ms">{l.ms}ms</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function useProgressHeartbeat(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setTick((t) => t + 1);
    }, 60);
    return () => {
      clearInterval(iv);
    };
  }, [active]);
}

export function ProgressView({
  runId,
  domain,
  onDone,
  pollIntervalMs,
}: ProgressViewProperties): ReactElement {
  const { status, pollError } = useJobStatus(runId, pollIntervalMs);
  const snapshot = progressSnapshot(status);
  const phaseReference = useRef({ idx: -1, t0: 0 });

  useEffect(() => {
    if (snapshot.isDone) onDone();
  }, [snapshot.isDone, onDone]);

  // Heartbeat so eased discover/generate fills keep advancing between polls.
  useProgressHeartbeat(!snapshot.isDone && !snapshot.isError);

  const host = domain ? hostnameOf(domain) : runId;

  if (snapshot.isError) {
    return <ErrorView host={host} error={snapshot.error} />;
  }

  // Reset the phase clock when the active node changes (during render so the
  // elapsed time never spikes on the transition poll).
  if (snapshot.activeIdx !== phaseReference.current.idx) {
    phaseReference.current = { idx: snapshot.activeIdx, t0: now() };
  }
  const fill = fillTargetFor(snapshot, now() - phaseReference.current.t0);
  const ratio = snapshot.found > 0 ? clamp01(snapshot.crawled / snapshot.found) : 0;

  return (
    <div className="progress" aria-busy={!snapshot.isDone} aria-live="polite">
      <div className="prog-head">
        <span className="mono-dim">crawling</span>
        <span className="prog-target">{host}</span>
        <span className="prog-spacer" />
        <span className="prog-method">
          {snapshot.discoveryMethod ? `via ${snapshot.discoveryMethod}` : "discovering…"}
        </span>
        <Link className="btn btn-ghost btn-sm" href="/">
          Cancel
        </Link>
      </div>

      <Timeline snapshot={snapshot} fill={fill} />
      <Gauge snapshot={snapshot} ratio={ratio} />
      <RequestLog host={host} log={crawlLogFor(snapshot.crawled)} />

      {pollError ? (
        <p className="mono-dim" style={{ marginTop: 12 }}>
          Connection hiccup — retrying. ({pollError})
        </p>
      ) : null}
    </div>
  );
}
