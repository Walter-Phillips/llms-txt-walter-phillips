"use client";

import type { DiffResponse, FileVersion } from "@profound-takehome/shared";
import { useEffect, useState } from "react";
import { DiffView } from "@/components/diff-view";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

/**
 * Version timeline. Select any two versions to see the unified diff between
 * them (always rendered older → newer).
 */
export function HistoryView({ siteId }: { siteId: string }) {
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getVersions(siteId)
      .then((res) => {
        if (cancelled) return;
        setVersions(res.versions);
        // Preselect the latest pair so the diff is one click away.
        if (res.versions.length >= 2) {
          setSelected([res.versions[1].version, res.versions[0].version]);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load version history.");
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (selected.length !== 2) {
      setDiff(null);
      return;
    }
    const [from, to] = [...selected].sort((a, b) => a - b);
    let cancelled = false;
    api
      .getDiff(siteId, from, to)
      .then((res) => {
        if (!cancelled) setDiff(res);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load that diff.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected, siteId]);

  function toggle(version: number) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(version)) return prev.filter((v) => v !== version);
      if (prev.length === 2) return [prev[1], version];
      return [...prev, version];
    });
  }

  if (error && !versions) {
    return (
      <p role="alert" className="border-l-2 border-accent pl-3 text-sm text-accent">
        {error}
      </p>
    );
  }
  if (!versions) return <p className="py-12 text-sm text-ink-soft">Loading history…</p>;
  if (versions.length === 0) {
    return <p className="py-12 text-sm text-ink-soft">No versions yet — run a generation first.</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <ol className="space-y-0">
        {versions.map((v) => {
          const checked = selected.includes(v.version);
          return (
            <li key={v.id} className="border-b border-rule/60">
              <label
                className={`flex cursor-pointer items-baseline gap-3 py-3 pl-1 pr-2 ${
                  checked ? "bg-paper-deep" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(v.version)}
                  className="translate-y-0.5 accent-[hsl(var(--accent))]"
                  aria-label={`Select version ${v.version}`}
                />
                <span className={`text-sm font-semibold ${checked ? "text-accent" : ""}`}>
                  v{v.version}
                </span>
                <span className="ml-auto text-right text-xs text-ink-soft">
                  <span className="block">{formatDate(v.createdAt)}</span>
                  <span className="block italic">{v.changeSummary ?? "no summary"}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ol>

      <div>
        {selected.length === 2 && diff ? (
          <>
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-ink-soft">
              comparing v{diff.from} → v{diff.to}
            </p>
            <DiffView diff={diff.diff} />
          </>
        ) : (
          <p className="py-12 text-sm text-ink-soft">
            {versions.length < 2
              ? "Only one version so far — diffs appear after the next press."
              : "Select two versions to compare them."}
          </p>
        )}
        {error && versions ? <p className="mt-3 text-xs text-accent">{error}</p> : null}
      </div>
    </div>
  );
}
