"use client";

import type { JobStatusResponse, RunStatus } from "@profound-takehome/shared";
import Link from "next/link";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { useJobStatus } from "@/lib/use-job-status";

const STEPS = [
  { key: "discovering", label: "Discovering" },
  { key: "crawling", label: "Crawling" },
  { key: "generating", label: "Generating" },
  { key: "done", label: "Done" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
type StepState = "active" | "done" | "todo";

interface ProgressSnapshot {
  current: StepKey;
  discovery: string | null;
  error: string | null;
  isDone: boolean;
  isError: boolean;
  pagesCrawled: number;
  pagesFound: number;
}

function activeStep(status: RunStatus): StepKey {
  switch (status) {
    case "queued":
      return "discovering";
    case "crawling":
      return "crawling";
    case "generating":
      return "generating";
    case "done":
    case "error":
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

function progressSnapshot(status: JobStatusResponse | null): ProgressSnapshot {
  if (!status) {
    return {
      current: "discovering",
      discovery: null,
      error: null,
      isDone: false,
      isError: false,
      pagesCrawled: 0,
      pagesFound: 0,
    };
  }

  return {
    current: activeStep(status.run.status),
    discovery: discoveryLabel(status),
    error: status.run.error,
    isDone: status.run.status === "done",
    isError: status.run.status === "error",
    pagesCrawled: status.live?.pagesCrawled ?? status.run.pagesCrawled,
    pagesFound: status.live?.pagesFound ?? status.run.pagesFound,
  };
}

export interface ProgressViewProperties {
  runId: string;
  domain?: string;
  onDone: () => void;
  pollIntervalMs?: number;
}

interface ProgressStepItemProperties {
  currentIndex: number;
  discovery: string | null;
  index: number;
  isDone: boolean;
  pagesCrawled: number;
  pagesFound: number;
  step: (typeof STEPS)[number];
}

interface ProgressStepsProperties {
  currentIndex: number;
  discovery: string | null;
  isDone: boolean;
  pagesCrawled: number;
  pagesFound: number;
}

interface StepDetailProperties {
  discovery: string | null;
  isDone: boolean;
  pagesCrawled: number;
  pagesFound: number;
  state: StepState;
  step: StepKey;
}

function stepState(index: number, currentIndex: number, isDone: boolean): StepState {
  if (index < currentIndex || isDone) return "done";
  if (index === currentIndex) return "active";
  return "todo";
}

function stepBorderClassName(state: StepState): string {
  if (state === "active") return "border-accent";
  if (state === "done") return "border-moss";
  return "border-rule";
}

function stepMarkerClassName(state: StepState): string {
  if (state === "done") return "text-moss";
  if (state === "active") return "text-accent";
  return "text-ink-soft/50";
}

function stepMarker(state: StepState): ReactNode {
  if (state === "done") return "■";
  if (state === "active") return "▶";
  return "□";
}

function crawlingDetail(state: StepState, pagesCrawled: number, pagesFound: number): ReactNode {
  if (state === "todo" || pagesFound === 0) return null;
  return `${String(pagesCrawled)}/${String(pagesFound)} pages`;
}

function stepDetail({
  discovery,
  isDone,
  pagesCrawled,
  pagesFound,
  state,
  step,
}: StepDetailProperties): ReactNode {
  if (step === "discovering" && state !== "todo") return discovery;
  if (step === "crawling") {
    return crawlingDetail(state, pagesCrawled, pagesFound);
  }
  if (step === "generating" && state === "active") return "drafting llms.txt…";
  if (step === "done" && isDone) return "file pressed";
  return null;
}

function ErrorProgressView({ error }: { error: string | null }): ReactElement {
  return (
    <div className="plate p-8" role="alert">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">press stopped</p>
      <h2 className="mt-3 font-display text-3xl">The crawl hit a snag.</h2>
      <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-soft">
        {friendlyRunError(error)}
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="underline decoration-dotted underline-offset-4 hover:text-accent">
          ← Try another URL
        </Link>
      </p>
    </div>
  );
}

function ProgressStepItem({
  currentIndex,
  discovery,
  index,
  isDone,
  pagesCrawled,
  pagesFound,
  step,
}: ProgressStepItemProperties): ReactElement {
  const state = stepState(index, currentIndex, isDone);
  const labelClassName = state === "todo" ? "text-ink-soft/50" : "text-ink";

  return (
    <li className={`flex items-baseline gap-4 border-l-2 py-3 pl-5 ${stepBorderClassName(state)}`}>
      <span className={`w-6 text-xs ${stepMarkerClassName(state)}`} aria-hidden>
        {stepMarker(state)}
      </span>
      <span className={`font-display text-2xl ${labelClassName}`}>{step.label}</span>
      <span className="ml-auto text-xs text-ink-soft">
        {stepDetail({
          discovery,
          isDone,
          pagesCrawled,
          pagesFound,
          state,
          step: step.key,
        })}
      </span>
    </li>
  );
}

function ProgressSteps({
  currentIndex,
  discovery,
  isDone,
  pagesCrawled,
  pagesFound,
}: ProgressStepsProperties): ReactElement {
  return (
    <ol className="mt-8 space-y-0">
      {STEPS.map((step, index) => (
        <ProgressStepItem
          key={step.key}
          currentIndex={currentIndex}
          discovery={discovery}
          index={index}
          isDone={isDone}
          pagesCrawled={pagesCrawled}
          pagesFound={pagesFound}
          step={step}
        />
      ))}
    </ol>
  );
}

export function ProgressView({
  runId,
  domain,
  onDone,
  pollIntervalMs,
}: ProgressViewProperties): ReactElement {
  const { status, pollError } = useJobStatus(runId, pollIntervalMs);
  const snapshot = progressSnapshot(status);

  useEffect(() => {
    if (snapshot.isDone) onDone();
  }, [snapshot.isDone, onDone]);

  const currentIndex = STEPS.findIndex((step) => step.key === snapshot.current);

  if (snapshot.isError) {
    return <ErrorProgressView error={snapshot.error} />;
  }

  return (
    <div className="plate p-8" aria-busy={!snapshot.isDone} aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">
          job ticket · {domain ?? runId}
        </p>
        <span className="cursor-blink text-accent" aria-hidden>
          ▌
        </span>
      </div>

      <ProgressSteps
        currentIndex={currentIndex}
        discovery={snapshot.discovery}
        isDone={snapshot.isDone}
        pagesCrawled={snapshot.pagesCrawled}
        pagesFound={snapshot.pagesFound}
      />

      {pollError ? (
        <p className="mt-6 text-xs text-accent">Connection hiccup — retrying. ({pollError})</p>
      ) : null}
    </div>
  );
}
