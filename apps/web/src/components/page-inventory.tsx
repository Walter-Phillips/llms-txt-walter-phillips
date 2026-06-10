"use client";

import type { PageInventoryItem } from "@profound-takehome/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function statusTone(status: string): string {
  if (status === "ok") return "text-moss";
  if (status === "skipped" || status === "excluded") return "text-ink-soft";
  return "text-accent";
}

/** Collapsible crawl inventory; pages are fetched on first expand. */
export function PageInventory({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageInventoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || pages) return;
    let cancelled = false;
    api
      .getPages(siteId)
      .then((res) => {
        if (!cancelled) setPages(res.pages);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the page inventory.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, pages, siteId]);

  return (
    <section className="border-t border-rule">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between py-3 text-left text-xs uppercase tracking-[0.2em] text-ink-soft hover:text-accent"
      >
        <span>Page inventory{pages ? ` · ${pages.length}` : ""}</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        error ? (
          <p className="pb-4 text-sm text-accent">{error}</p>
        ) : !pages ? (
          <p className="pb-4 text-sm text-ink-soft">Loading inventory…</p>
        ) : (
          <div className="overflow-x-auto pb-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-rule text-ink-soft">
                  <th className="py-2 pr-4 font-medium uppercase tracking-wider">URL</th>
                  <th className="py-2 pr-4 font-medium uppercase tracking-wider">Title</th>
                  <th className="py-2 pr-4 font-medium uppercase tracking-wider">Section</th>
                  <th className="py-2 font-medium uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.url} className="border-b border-rule/60 align-baseline">
                    <td className="max-w-[260px] truncate py-2 pr-4 text-ink-soft">{page.url}</td>
                    <td className="py-2 pr-4">{page.title ?? "—"}</td>
                    <td className="py-2 pr-4 text-ink-soft">{page.sectionHint ?? "—"}</td>
                    <td className={`py-2 ${statusTone(page.status)}`}>{page.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
