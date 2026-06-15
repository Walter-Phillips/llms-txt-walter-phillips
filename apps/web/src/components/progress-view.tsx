"use client";

import type { JobStatusResponse, RunStatus } from "@profound-takehome/shared";
import Link from "next/link";
import { useEffect } from "react";
import { useJobStatus } from "@/lib/use-job-status";

const STEPS = [
  { key: "discovering", label: "Discovering" },
  { key: "crawling", label: "Crawling" },
  { key: "generating", label: "Generating" },
  { key: "done", label: "Done" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function activeStep(status: RunStatus): StepKey {
  switch (status) {
    case "queued":
      return "discovering";
    case "crawling":
      return "crawling";
    case "generating":
      return "generating";
    default:
      return "done";
  }
}

function discoveryLabel(job: JobStatusResponse): string | null {
  const method = job.live?.discoveryMethod ?? job.run.discoveryMethod;
  if (!method) return null;
  if (method === "sitemap") return "Found sitemap";
  if (method === "rendered") return "Rendering pages — no static sitemap";
  return "No sitemap — crawling links";
}

export function friendlyRunError(error: string | null): string {
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

export interface ProgressViewProps {
  runId: string;
  domain?: string;
  onDone: () => void;
  pollIntervalMs?: number;
}

export function ProgressView({ runId, domain, onDone, pollIntervalMs }: ProgressViewProps) {
  const { status, pollError } = useJobStatus(runId, pollIntervalMs);
  const run = status?.run ?? null;
  const isDone = run?.status === "done";

  useEffect(() => {
    if (isDone) onDone();
  }, [isDone, onDone]);

  const current: StepKey = run ? activeStep(run.status) : "discovering";
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  const pagesFound = status?.live?.pagesFound ?? run?.pagesFound ?? 0;
  const pagesCrawled = status?.live?.pagesCrawled ?? run?.pagesCrawled ?? 0;
  const discovery = status ? discoveryLabel(status) : null;

  if (run?.status === "error") {
    return (
      <div className="plate p-8" role="alert">
        <p className="text-xs uppercase tracking-[0.25em] text-accent">press stopped</p>
        <h2 className="mt-3 font-display text-3xl">The crawl hit a snag.</h2>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-soft">
          {friendlyRunError(run.error)}
        </p>
        <p className="mt-6 text-sm">
          <Link
            href="/"
            className="underline decoration-dotted underline-offset-4 hover:text-accent"
          >
            ← Try another URL
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="plate p-8" aria-busy={!isDone} aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">
          job ticket · {domain ?? runId}
        </p>
        <span className="cursor-blink text-accent" aria-hidden>
          ▌
        </span>
      </div>

      <ol className="mt-8 space-y-0">
        {STEPS.map((step, idx) => {
          const state =
            idx < currentIdx || isDone ? "done" : idx === currentIdx ? "active" : "todo";
          return (
            <li
              key={step.key}
              className={`flex items-baseline gap-4 border-l-2 py-3 pl-5 ${
                state === "active"
                  ? "border-accent"
                  : state === "done"
                    ? "border-moss"
                    : "border-rule"
              }`}
            >
              <span
                className={`w-6 text-xs ${
                  state === "done"
                    ? "text-moss"
                    : state === "active"
                      ? "text-accent"
                      : "text-ink-soft/50"
                }`}
                aria-hidden
              >
                {state === "done" ? "■" : state === "active" ? "▶" : "□"}
              </span>
              <span
                className={`font-display text-2xl ${
                  state === "todo" ? "text-ink-soft/50" : "text-ink"
                }`}
              >
                {step.label}
              </span>
              <span className="ml-auto text-xs text-ink-soft">
                {step.key === "discovering" && state !== "todo" && discovery ? discovery : null}
                {step.key === "crawling" && state !== "todo" && pagesFound > 0
                  ? `${pagesCrawled}/${pagesFound} pages`
                  : null}
                {step.key === "generating" && state === "active" ? "drafting llms.txt…" : null}
                {step.key === "done" && isDone ? "file pressed" : null}
              </span>
            </li>
          );
        })}
      </ol>

      {pollError ? (
        <p className="mt-6 text-xs text-accent">Connection hiccup — retrying. ({pollError})</p>
      ) : null}
    </div>
  );
}
