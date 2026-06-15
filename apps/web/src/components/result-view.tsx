"use client";

import type { FileVersion, PageInventoryItem, Site } from "@profound-takehome/shared";
import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";
import { CopyButton } from "@/components/copy-button";
import { Icons } from "@/components/icons";
import { LlmsText } from "@/components/llms-text";
import { PageInventory } from "@/components/page-inventory";
import { api, hostedFileUrl } from "@/lib/api";
import { reconstructFromDiff } from "@/lib/diff";
import { formatCadence, formatRelative } from "@/lib/format";
import { hostnameOf } from "@/lib/utils";

type Tab = "file" | "pages";

interface ResultData {
  site: Site | null;
  versions: FileVersion[];
  pages: PageInventoryItem[];
  error: string | null;
}

function useResultData(siteId: string): ResultData {
  const [site, setSite] = useState<Site | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [pages, setPages] = useState<PageInventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [siteResponse, versionsResponse, pagesResponse] = await Promise.all([
          api.getSite(siteId),
          api.getVersions(siteId),
          api.getPages(siteId),
        ]);
        if (cancelled) return;
        setSite(siteResponse.site);
        setVersions(versionsResponse.versions);
        setPages(pagesResponse.pages);
      } catch {
        if (!cancelled) setError("Couldn't load the generated file. Try refreshing.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  return { site, versions, pages, error };
}

/** Older versions are reconstructed from a diff against the latest version. */
function useVersionContent(
  siteId: string,
  domain: string | null,
  activeVersion: number | null,
  latestVersion: number | null,
): string | null {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (domain === null || activeVersion === null || latestVersion === null) return;
    const siteDomain = domain;
    const active = activeVersion;
    const latest = latestVersion;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const text =
          active === latest
            ? await api.getLlmsTxt(siteDomain)
            : reconstructFromDiff((await api.getDiff(siteId, active, latest)).diff);
        if (!cancelled) setContent(text);
      } catch {
        if (!cancelled) setContent(null);
      }
    }
    setContent(null);
    void load();
    return () => {
      cancelled = true;
    };
  }, [siteId, domain, activeVersion, latestVersion]);

  return content;
}

function downloadTextFile(content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "llms.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function ResultBar({ host }: { host: string }): ReactElement {
  return (
    <div className="result-bar">
      <div className="result-crumb">
        <Icons.check size={15} className="result-crumb-ok" />
        <span className="crumb-domain">{host}</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-file">llms.txt</span>
      </div>
      <Link className="btn btn-ghost btn-sm" href="/">
        <Icons.arrow size={13} style={{ transform: "rotate(180deg)" }} />
        <span>New site</span>
      </Link>
    </div>
  );
}

function EditorTabs({
  tab,
  setTab,
  content,
  hosted,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  content: string;
  hosted: string;
}): ReactElement {
  return (
    <div className="editor-tabs">
      <button
        type="button"
        className={`etab ${tab === "file" ? "etab-on" : ""}`}
        onClick={() => {
          setTab("file");
        }}
      >
        <Icons.file size={13} /> llms.txt
      </button>
      <button
        type="button"
        className={`etab ${tab === "pages" ? "etab-on" : ""}`}
        onClick={() => {
          setTab("pages");
        }}
      >
        <Icons.layers size={13} /> pages
      </button>
      <span className="editor-tabs-spacer" />
      <div className="editor-actions">
        <CopyButton text={content} className="btn-sm" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            downloadTextFile(content);
          }}
        >
          <Icons.download size={14} />
          <span>Download</span>
        </button>
        <a className="btn btn-ghost btn-sm" href={hosted} target="_blank" rel="noreferrer">
          <Icons.external size={14} />
          <span>Raw</span>
        </a>
      </div>
    </div>
  );
}

interface EditorProperties {
  tab: Tab;
  setTab: (tab: Tab) => void;
  content: string;
  pages: PageInventoryItem[];
  hosted: string;
  isLatest: boolean;
  activeVersion: number;
  onJumpLatest: () => void;
}

function ResultEditor(props: EditorProperties): ReactElement {
  const { tab, setTab, content, pages, hosted, isLatest, activeVersion, onJumpLatest } = props;
  return (
    <section className="editor">
      <EditorTabs tab={tab} setTab={setTab} content={content} hosted={hosted} />
      {isLatest ? null : (
        <div className="editor-notice">
          Viewing <strong>v{activeVersion}</strong>, an older version.
          <button type="button" className="linkbtn" onClick={onJumpLatest}>
            Jump to latest →
          </button>
        </div>
      )}
      <div className="editor-body">
        {tab === "file" ? <LlmsText content={content} /> : <PageInventory pages={pages} />}
      </div>
    </section>
  );
}

function VersionHistory({
  versions,
  activeVersion,
  onSelect,
}: {
  versions: FileVersion[];
  activeVersion: number;
  onSelect: (version: number) => void;
}): ReactElement {
  const latest = versions.length > 0 ? versions[0].version : null;
  return (
    <div className="vhist">
      {versions.map((version) => {
        const active = version.version === activeVersion;
        return (
          <button
            type="button"
            className={`vrow ${active ? "vrow-active" : ""}`}
            key={version.id}
            onClick={() => {
              onSelect(version.version);
            }}
          >
            <span className="vrow-tag">v{version.version}</span>
            <span className="vrow-time">{formatRelative(version.createdAt)}</span>
            {version.version === latest ? <span className="vrow-now">current</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function formatUpcoming(epoch: number): string {
  const date = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "due now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `in ${String(Math.round(diff / minute))}m`;
  if (diff < day) return `in ${String(Math.round(diff / hour))}h`;
  const days = Math.round(diff / day);
  return days === 1 ? "tomorrow" : `in ${String(days)}d`;
}

interface SidebarProperties {
  hosted: string;
  site: Site;
  monitoringOn: boolean;
  versions: FileVersion[];
  activeVersion: number;
  onSelect: (version: number) => void;
}

function ResultSidebar(props: SidebarProperties): ReactElement {
  const { hosted, site, monitoringOn, versions, activeVersion, onSelect } = props;
  return (
    <aside className="meta">
      <section className="card">
        <p className="card-k">
          <Icons.link size={13} /> hosted at
        </p>
        <a className="hosted" href={hosted} target="_blank" rel="noreferrer">
          {hosted}
        </a>
        <div className="card-actions">
          <CopyButton text={hosted} label="Copy link" className="btn-sm" />
          <a className="btn btn-ghost btn-sm" href={hosted} target="_blank" rel="noreferrer">
            <Icons.external size={13} />
            <span>Open</span>
          </a>
        </div>
      </section>

      <section className="card">
        <div className="card-row">
          <p className="card-k">
            <Icons.clock size={13} /> modification window
          </p>
        </div>
        <p className="card-note">
          {monitoringOn
            ? `Monitoring ${formatCadence(site.checkIntervalS)}.`
            : `Monitoring paused. Window is ${formatCadence(site.checkIntervalS)}.`}
        </p>
        {monitoringOn && site.nextCheckAt !== null ? (
          <p className="card-note">Next check {formatUpcoming(site.nextCheckAt)}.</p>
        ) : null}
      </section>

      <section className="card">
        <p className="card-k">
          <Icons.history size={13} /> versions
        </p>
        <VersionHistory versions={versions} activeVersion={activeVersion} onSelect={onSelect} />
      </section>
    </aside>
  );
}

export function ResultView({ siteId }: { siteId: string }): ReactElement {
  const { site, versions, pages, error } = useResultData(siteId);
  const latestVersion: number | null = versions.length > 0 ? versions[0].version : null;
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("file");

  useEffect(() => {
    if (activeVersion === null && latestVersion !== null) setActiveVersion(latestVersion);
  }, [activeVersion, latestVersion]);

  const domain = site?.domain ?? null;
  const content = useVersionContent(siteId, domain, activeVersion, latestVersion);

  if (error) {
    return <p className="mono-dim">{error}</p>;
  }
  if (!site || content === null || activeVersion === null || latestVersion === null) {
    return (
      <div className="result-loading">
        <span className="mono-dim">loading file…</span>
      </div>
    );
  }

  const hosted = hostedFileUrl(site.domain);
  return (
    <div className="result">
      <ResultBar host={hostnameOf(site.domain)} />
      <div className="result-grid">
        <ResultEditor
          tab={tab}
          setTab={setTab}
          content={content}
          pages={pages}
          hosted={hosted}
          isLatest={activeVersion === latestVersion}
          activeVersion={activeVersion}
          onJumpLatest={() => {
            setActiveVersion(latestVersion);
          }}
        />
        <ResultSidebar
          hosted={hosted}
          site={site}
          monitoringOn={site.monitoring === 1}
          versions={versions}
          activeVersion={activeVersion}
          onSelect={setActiveVersion}
        />
      </div>
    </div>
  );
}
