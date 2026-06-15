"use client";

import { useCallback, useEffect, useState } from "react";
import { HistoryView } from "@/components/history-view";
import { ProgressView } from "@/components/progress-view";
import { ResultView } from "@/components/result-view";
import { api } from "@/lib/api";

type Tab = "file" | "history";

export interface SiteScreenProps {
  siteId: string;
  /** Present when arriving from a fresh submission — shows live progress first. */
  runId?: string;
}

export function SiteScreen({ siteId, runId }: SiteScreenProps) {
  const [showProgress, setShowProgress] = useState(Boolean(runId));
  const [tab, setTab] = useState<Tab>("file");
  const [domain, setDomain] = useState<string | undefined>(undefined);
  // Remount the result view after a run finishes so it refetches fresh data.
  const [resultEpoch, setResultEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getSite(siteId)
      .then((res) => {
        if (!cancelled) setDomain(res.site.domain);
      })
      .catch(() => {
        // Non-fatal; the result view surfaces load errors itself.
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const handleDone = useCallback(() => {
    setShowProgress(false);
    setResultEpoch((n) => n + 1);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl tracking-tight">
          {domain ?? "…"}
          <span className="text-accent">/llms.txt</span>
        </h1>
        {!showProgress ? (
          <nav className="flex gap-0 text-xs uppercase tracking-[0.2em]" aria-label="Site views">
            {(
              [
                ["file", "File"],
                ["history", "History"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={tab === key ? "page" : undefined}
                className={`border px-4 py-2 ${
                  tab === key
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      {showProgress && runId ? (
        <ProgressView runId={runId} domain={domain} onDone={handleDone} />
      ) : tab === "file" ? (
        <ResultView key={resultEpoch} siteId={siteId} />
      ) : (
        <HistoryView siteId={siteId} />
      )}
    </main>
  );
}
