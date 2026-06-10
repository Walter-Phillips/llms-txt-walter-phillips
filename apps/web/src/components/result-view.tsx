"use client";

import type { Site } from "@profound-takehome/shared";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { LlmsText } from "@/components/llms-text";
import { PageInventory } from "@/components/page-inventory";
import { api, hostedFileUrl } from "@/lib/api";
import { formatCadence, formatDateTime } from "@/lib/format";

export function ResultView({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [versionAt, setVersionAt] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { site: s, latestVersion } = await api.getSite(siteId);
        if (cancelled) return;
        setSite(s);
        setVersion(latestVersion?.version ?? null);
        setVersionAt(latestVersion?.createdAt ?? null);
        const text = await api.getLlmsTxt(s.domain);
        if (!cancelled) setContent(text);
      } catch {
        if (!cancelled) setError("Couldn't load the generated file. Try refreshing.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const toggleMonitoring = useCallback(async () => {
    if (!site || toggling) return;
    setToggling(true);
    const enabled = site.monitoring !== 1;
    try {
      const res = await api.setMonitoring(site.id, enabled);
      setSite(res.site);
    } catch {
      setError("Couldn't update monitoring. Try again.");
    } finally {
      setToggling(false);
    }
  }, [site, toggling]);

  if (error) {
    return (
      <p role="alert" className="border-l-2 border-accent pl-3 text-sm text-accent">
        {error}
      </p>
    );
  }
  if (!site || content === null) {
    return <p className="py-12 text-sm text-ink-soft">Loading the pressed file…</p>;
  }

  const hosted = hostedFileUrl(site.domain);
  const monitoringOn = site.monitoring === 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <article className="plate">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
            {site.domain}/llms.txt
            {version != null ? <span className="text-accent"> · v{version}</span> : null}
          </p>
          <div className="flex gap-2">
            <CopyButton text={content} />
            <Button
              type="button"
              variant="outline"
              className="rounded-none border-rule bg-paper font-mono text-xs uppercase tracking-wider hover:border-ink"
              onClick={() => {
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "llms.txt";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Download
            </Button>
          </div>
        </div>
        <div className="px-5 py-4">
          <LlmsText content={content} />
        </div>
        <div className="px-5">
          <PageInventory siteId={site.id} />
        </div>
      </article>

      <aside className="space-y-6">
        <section className="plate p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">hosted at</p>
          <a
            href={hosted}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block break-all text-sm font-medium text-accent underline decoration-dotted underline-offset-4"
          >
            {hosted}
          </a>
          <div className="mt-3">
            <CopyButton text={hosted} label="Copy link" />
          </div>
          {versionAt != null ? (
            <p className="mt-4 text-xs text-ink-soft">last pressed {formatDateTime(versionAt)}</p>
          ) : null}
        </section>

        <section className="plate p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">monitoring</p>
              <p className="mt-1 text-sm font-medium">Keep this updated</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={monitoringOn}
              aria-label="Keep this updated"
              disabled={toggling}
              onClick={() => void toggleMonitoring()}
              className={`relative h-6 w-11 shrink-0 border transition-colors ${
                monitoringOn ? "border-moss bg-moss" : "border-rule bg-paper-deep"
              } ${toggling ? "opacity-60" : ""}`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 h-[18px] w-[18px] bg-paper transition-all ${
                  monitoringOn ? "left-[22px]" : "left-0.5 border border-rule"
                }`}
              />
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-soft">
            {monitoringOn
              ? `Checking ${formatCadence(site.checkIntervalS)}. When the site changes, we re-press the file and keep the old versions.`
              : `Off. Turn on to re-check ${formatCadence(site.checkIntervalS)} and republish when the site changes.`}
          </p>
          {monitoringOn && site.nextCheckAt != null ? (
            <p className="mt-2 text-xs text-moss">next check {formatDateTime(site.nextCheckAt)}</p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
