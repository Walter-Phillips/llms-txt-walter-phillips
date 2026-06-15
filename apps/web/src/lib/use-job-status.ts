"use client";

import type { JobStatusResponse } from "@profound-takehome/shared";
import { useEffect, useState } from "react";
import { api, ApiRequestError } from "./api";

export const JOB_POLL_INTERVAL_MS = 1500;

export interface JobStatusState {
  status: JobStatusResponse | null;
  /** Transport-level failure (the run itself reports errors via run.status). */
  pollError: string | null;
}

/**
 * Polls GET /api/jobs/:runId until the run reaches a terminal state.
 * @param runId Crawl run identifier to poll.
 * @param intervalMs Delay between poll attempts in milliseconds.
 * @returns Latest job status and any transport-level polling error.
 */
export function useJobStatus(
  runId: string,
  intervalMs: number = JOB_POLL_INTERVAL_MS,
): JobStatusState {
  const [state, setState] = useState<JobStatusState>({ status: null, pollError: null });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextTick = (): void => {
      timer = setTimeout(() => {
        void tick();
      }, intervalMs);
    };

    const tick = async (): Promise<void> => {
      try {
        const next = await api.getJob(runId);
        if (cancelled) return;
        setState({ status: next, pollError: null });
        if (next.run.status !== "done" && next.run.status !== "error") {
          scheduleNextTick();
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof ApiRequestError ? err.message : "Lost contact with the API.";
        setState((previous) => ({ ...previous, pollError: message }));
        // Keep polling through transient failures.
        scheduleNextTick();
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, intervalMs]);

  return state;
}
