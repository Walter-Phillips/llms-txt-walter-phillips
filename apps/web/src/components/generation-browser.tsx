"use client";

import type { GeneratedSite } from "@profound-takehome/shared";
import Link from "next/link";
import { useEffect, useState, type ReactElement, type SyntheticEvent } from "react";
import { Icons } from "@/components/icons";
import { api, hostedFileUrl } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { hostnameOf } from "@/lib/utils";

function GenerationRow({ item }: { item: GeneratedSite }): ReactElement {
  const host = hostnameOf(item.site.domain);
  const hosted = hostedFileUrl(item.site.domain);
  return (
    <article className="gen-row">
      <div className="gen-row-main">
        <div className="gen-row-title">
          <Icons.file size={14} />
          <span>{host}</span>
        </div>
        <p>{item.latestVersion.changeSummary ?? "Published llms.txt file"}</p>
      </div>
      <div className="gen-row-meta">
        <span>v{item.latestVersion.version}</span>
        <span>{formatRelative(item.latestVersion.createdAt)}</span>
        <span>{item.site.monitoring === 1 ? "monitoring" : "paused"}</span>
      </div>
      <div className="gen-row-actions">
        <Link className="btn btn-ghost btn-sm" href={`/sites/${item.site.id}`}>
          <Icons.arrow size={13} />
          <span>Open</span>
        </Link>
        <a className="btn btn-ghost btn-sm" href={hosted} target="_blank" rel="noreferrer">
          <Icons.external size={13} />
          <span>Raw</span>
        </a>
      </div>
    </article>
  );
}

function GenerationList({
  error,
  items,
  loading,
}: {
  error: string | null;
  items: GeneratedSite[];
  loading: boolean;
}): ReactElement {
  return (
    <div className="gen-list" aria-live="polite">
      {loading ? <p className="mono-dim">loading generations...</p> : null}
      {error ? (
        <p className="gen-empty" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className="gen-empty">
          <Icons.search size={18} />
          <p>No generated file found for that site.</p>
          <Link className="btn btn-ghost btn-sm" href="/">
            <Icons.arrow size={13} />
            <span>Generate one</span>
          </Link>
        </div>
      ) : null}
      {!loading && !error
        ? items.map((item) => <GenerationRow key={item.site.id} item={item} />)
        : null}
    </div>
  );
}

export function GenerationBrowser(): ReactElement {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [items, setItems] = useState<GeneratedSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getGeneratedSites(activeQuery);
        if (!cancelled) setItems(response.sites);
      } catch {
        if (!cancelled) setError("Could not load generated files. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeQuery]);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setActiveQuery(query.trim());
  }

  return (
    <section className="generations" aria-labelledby="generations-title">
      <div className="generations-head">
        <p className="mono-dim">existing files</p>
        <h1 id="generations-title">Find a generated llms.txt</h1>
        <p>Search the files already published by previous crawls.</p>
      </div>

      <form className="gen-search" onSubmit={submit}>
        <Icons.search size={16} />
        <label htmlFor="generation-query" className="sr-only">
          Search generated sites
        </label>
        <input
          id="generation-query"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search domain, e.g. stripe.com"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button className="btn btn-primary btn-sm" type="submit">
          <span>Search</span>
          <Icons.arrow size={13} />
        </button>
      </form>

      <GenerationList error={error} items={items} loading={loading} />
    </section>
  );
}
