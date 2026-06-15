"use client";

import type { CapReason, GeneratedBy, Site } from "@profound-takehome/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { LlmsText } from "@/components/llms-text";
import { PageInventory } from "@/components/page-inventory";
import { api, hostedFileUrl } from "@/lib/api";
import { formatCadence, formatDateTime } from "@/lib/format";

interface ResultData {
  capReason: CapReason | null;
  content: string;
  generatedBy: GeneratedBy | null;
  site: Site;
  version: number | null;
  versionAt: number | null;
}

interface ResultArticleProperties {
  capReason: CapReason | null;
  content: string;
  generatedBy: GeneratedBy | null;
  site: Site;
  version: number | null;
}

interface ResultSidebarProperties {
  hosted: string;
  monitoringOn: boolean;
  onToggleMonitoring: () => void;
  site: Site;
  toggling: boolean;
  versionAt: number | null;
}

interface ResultSetters {
  setCapReason: (capReason: CapReason | null) => void;
  setContent: (content: string) => void;
  setGeneratedBy: (generatedBy: GeneratedBy | null) => void;
  setSite: (site: Site) => void;
  setVersion: (version: number | null) => void;
  setVersionAt: (versionAt: number | null) => void;
}

async function loadCapReason(runId: string | null): Promise<CapReason | null> {
  if (runId === null) return null;
  try {
    const job = await api.getJob(runId);
    return job.run.capReason ?? null;
  } catch {
    return null;
  }
}

async function loadResultData(siteId: string): Promise<ResultData> {
  const { site, latestVersion } = await api.getSite(siteId);
  const [capReason, content] = await Promise.all([
    loadCapReason(latestVersion?.runId ?? null),
    api.getLlmsTxt(site.domain),
  ]);

  return {
    capReason,
    content,
    generatedBy: latestVersion?.generatedBy ?? null,
    site,
    version: latestVersion?.version ?? null,
    versionAt: latestVersion?.createdAt ?? null,
  };
}

function applyResultData(
  data: ResultData,
  { setCapReason, setContent, setGeneratedBy, setSite, setVersion, setVersionAt }: ResultSetters,
): void {
  setSite(data.site);
  setVersion(data.version);
  setVersionAt(data.versionAt);
  setGeneratedBy(data.generatedBy);
  setCapReason(data.capReason);
  setContent(data.content);
}

function generatedByLabel(generatedBy: GeneratedBy | null): string | null {
  if (generatedBy === "llm-refined") return "AI-refined";
  if (generatedBy === "heuristic") return "Heuristic";
  return null;
}

function downloadTextFile(content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "llms.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function DownloadButton({ content }: { content: string }): ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      className="rounded-none border-rule bg-paper font-mono text-xs uppercase tracking-wider hover:border-ink"
      onClick={() => {
        downloadTextFile(content);
      }}
    >
      Download
    </Button>
  );
}

function ResultHeader({
  content,
  domain,
  generatedBy,
  version,
}: {
  content: string;
  domain: string;
  generatedBy: GeneratedBy | null;
  version: number | null;
}): ReactElement {
  const label = generatedByLabel(generatedBy);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
        {domain}/llms.txt
        {version !== null ? <span className="text-accent"> · v{version}</span> : null}
      </p>
      {label ? (
        <span className="border border-rule px-2 py-1 text-xs font-medium text-ink-soft">
          {label}
        </span>
      ) : null}
      <div className="flex gap-2">
        <CopyButton text={content} />
        <DownloadButton content={content} />
      </div>
    </div>
  );
}

function ResultArticle({
  capReason,
  content,
  generatedBy,
  site,
  version,
}: ResultArticleProperties): ReactElement {
  return (
    <article className="plate">
      <ResultHeader
        content={content}
        domain={site.domain}
        generatedBy={generatedBy}
        version={version}
      />
      <div className="px-5 py-4">
        {capReason === "max_pages" ? (
          <p className="mb-4 border-l-2 border-accent pl-3 text-sm text-ink-soft">
            Crawl limited to 1,000 pages because this site is larger.
          </p>
        ) : null}
        <LlmsText content={content} />
      </div>
      <div className="px-5">
        <PageInventory siteId={site.id} />
      </div>
    </article>
  );
}

function HostedPanel({
  hosted,
  versionAt,
}: {
  hosted: string;
  versionAt: number | null;
}): ReactElement {
  return (
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
      {versionAt !== null ? (
        <p className="mt-4 text-xs text-ink-soft">last pressed {formatDateTime(versionAt)}</p>
      ) : null}
    </section>
  );
}

function monitoringCopy(monitoringOn: boolean, intervalSeconds: number): string {
  const cadence = formatCadence(intervalSeconds);
  if (monitoringOn) {
    return `Checking ${cadence}. When the site changes, we re-press the file and keep the old versions.`;
  }
  return `Off. Turn on to re-check ${cadence} and republish when the site changes.`;
}

function MonitoringPanel({
  monitoringOn,
  onToggleMonitoring,
  site,
  toggling,
}: Omit<ResultSidebarProperties, "hosted" | "versionAt">): ReactElement {
  return (
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
          onClick={onToggleMonitoring}
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
        {monitoringCopy(monitoringOn, site.checkIntervalS)}
      </p>
      {monitoringOn && site.nextCheckAt !== null ? (
        <p className="mt-2 text-xs text-moss">next check {formatDateTime(site.nextCheckAt)}</p>
      ) : null}
    </section>
  );
}

function ResultSidebar({
  hosted,
  monitoringOn,
  onToggleMonitoring,
  site,
  toggling,
  versionAt,
}: ResultSidebarProperties): ReactElement {
  return (
    <aside className="space-y-6">
      <HostedPanel hosted={hosted} versionAt={versionAt} />
      <MonitoringPanel
        monitoringOn={monitoringOn}
        onToggleMonitoring={onToggleMonitoring}
        site={site}
        toggling={toggling}
      />
    </aside>
  );
}

export function ResultView({ siteId }: { siteId: string }): ReactElement {
  const [site, setSite] = useState<Site | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [versionAt, setVersionAt] = useState<number | null>(null);
  const [generatedBy, setGeneratedBy] = useState<GeneratedBy | null>(null);
  const [capReason, setCapReason] = useState<CapReason | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;

    void loadResultData(siteId)
      .then((data) => {
        if (isCancelled()) {
          return;
        }

        applyResultData(data, {
          setCapReason,
          setContent,
          setGeneratedBy,
          setSite,
          setVersion,
          setVersionAt,
        });
      })
      .catch(() => {
        if (!isCancelled()) setError("Couldn't load the generated file. Try refreshing.");
      });

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
      <ResultArticle
        capReason={capReason}
        content={content}
        generatedBy={generatedBy}
        site={site}
        version={version}
      />
      <ResultSidebar
        hosted={hosted}
        monitoringOn={monitoringOn}
        onToggleMonitoring={() => void toggleMonitoring()}
        site={site}
        toggling={toggling}
        versionAt={versionAt}
      />
    </div>
  );
}
