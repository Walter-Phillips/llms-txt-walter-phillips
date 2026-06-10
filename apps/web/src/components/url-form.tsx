"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api";

export const EXAMPLE_SITES = ["vercel.com", "stripe.com", "hono.dev"] as const;

function friendlySubmitError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.message.startsWith("invalid_url")) {
      return "That doesn't look like a website address. Try something like example.com.";
    }
    if (err.status === 0) {
      return "Couldn't reach the API. Check that the Worker is running, then try again.";
    }
    return err.message;
  }
  return "Something went wrong submitting that URL. Please try again.";
}

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(target: string) {
    if (!target.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { siteId, runId } = await api.createSite(target.trim());
      router.push(`/sites/${siteId}?run=${runId}`);
    } catch (err) {
      setError(friendlySubmitError(err));
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(url);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="plate flex items-stretch gap-0 p-1.5">
        <label htmlFor="site-url" className="sr-only">
          Website URL
        </label>
        <input
          id="site-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="yourproduct.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-ink-soft/60"
        />
        <Button type="submit" disabled={submitting || !url.trim()} className="shrink-0 rounded-none bg-ink font-mono text-paper hover:bg-accent">
          {submitting ? "Pressing…" : "Generate"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 border-l-2 border-accent pl-3 text-sm text-accent">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline gap-2 text-xs text-ink-soft">
        <span className="uppercase tracking-[0.2em]">try</span>
        {EXAMPLE_SITES.map((site) => (
          <button
            key={site}
            type="button"
            disabled={submitting}
            onClick={() => {
              setUrl(site);
              void submit(site);
            }}
            className="border border-rule bg-paper px-2.5 py-1 font-mono text-ink transition-colors hover:border-ink hover:text-accent disabled:opacity-50"
          >
            {site}
          </button>
        ))}
      </div>
    </div>
  );
}
