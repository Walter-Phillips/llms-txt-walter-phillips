"use client";

import { useRouter } from "next/navigation";
import { useState, type JSX, type SyntheticEvent } from "react";
import { Icons } from "@/components/icons";
import { api, ApiRequestError, normalizeWebsiteUrl } from "@/lib/api";

const EXAMPLE_SITES = ["vercel.com", "stripe.com", "hono.dev"] as const;

function friendlySubmitError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.message.startsWith("invalid_url")) {
      return "Enter a full website address, e.g. stripe.com";
    }
    if (err.status === 0) {
      return "Couldn't reach the API. Check that the Worker is running, then try again.";
    }
    return err.message;
  }
  return "Something went wrong submitting that URL. Please try again.";
}

function ExampleRow({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (site: string) => void;
}): JSX.Element {
  return (
    <div className="examples">
      <span className="examples-label">try</span>
      <div className="examples-list">
        {EXAMPLE_SITES.map((site) => (
          <button
            key={site}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => {
              onPick(site);
            }}
          >
            {site}
          </button>
        ))}
      </div>
    </div>
  );
}

export function UrlForm(): JSX.Element {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(target: string): Promise<void> {
    if (!target.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { siteId, runId } = await api.createSite(normalizeWebsiteUrl(target));
      router.push(`/sites/${siteId}?run=${runId}`);
    } catch (err) {
      setError(friendlySubmitError(err));
      setSubmitting(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(url);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={`urlform-field ${error ? "urlform-field-err" : ""}`}>
        <span className="urlform-scheme">https://</span>
        <label htmlFor="site-url" className="sr-only">
          Website URL
        </label>
        <input
          id="site-url"
          name="url"
          className="urlform-input"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError(null);
          }}
          placeholder="your-site.com"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Website URL"
        />
        <button
          type="submit"
          className="btn btn-primary urlform-go"
          disabled={submitting || !url.trim()}
        >
          <span>{submitting ? "Generating…" : "Generate"}</span>
          <Icons.arrow size={15} />
        </button>
      </div>

      <div className="urlform-meta">
        {error ? (
          <span className="urlform-error" role="alert">
            {error}
          </span>
        ) : (
          <span className="urlform-hint">
            Sitemap-first crawl, validated against the spec, hosted at <code>/llms.txt</code>.
          </span>
        )}
      </div>

      <ExampleRow
        disabled={submitting}
        onPick={(site) => {
          setUrl(site);
          void submit(site);
        }}
      />
    </form>
  );
}
