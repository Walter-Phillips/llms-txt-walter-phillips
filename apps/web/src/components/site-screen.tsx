"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { ProgressView } from "@/components/progress-view";
import { ResultView } from "@/components/result-view";
import { api } from "@/lib/api";

export interface SiteScreenProperties {
  siteId: string;
  /** Present when arriving from a fresh submission — shows live progress first. */
  runId?: string;
}

export function SiteScreen({ siteId, runId }: SiteScreenProperties): JSX.Element {
  const [showProgress, setShowProgress] = useState(Boolean(runId));
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

  if (showProgress && runId) {
    return <ProgressView runId={runId} domain={domain} onDone={handleDone} />;
  }
  return <ResultView key={resultEpoch} siteId={siteId} />;
}
