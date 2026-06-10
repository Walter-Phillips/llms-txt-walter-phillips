import { UrlForm } from "@/components/url-form";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      <div className="grid gap-12 py-16 md:grid-cols-[3fr_2fr] md:gap-16 md:py-24">
        <section>
          <p className="rise text-xs uppercase tracking-[0.25em] text-accent">
            /llms.txt — one file, machine-readable
          </p>
          <h1 className="rise rise-1 mt-4 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Set your website in{" "}
            <em className="text-accent">plain text</em>, for the machines that read it.
          </h1>
          <p className="rise rise-2 mt-6 max-w-xl text-sm leading-relaxed text-ink-soft">
            llms.txt is a proposed standard: a single markdown file at{" "}
            <code className="text-ink">/llms.txt</code> that tells AI assistants what your site is
            about and where the important pages live. Paste a URL — we crawl the site, draft a
            spec-compliant file, host it, and keep it current as your site changes.
          </p>
          <div className="rise rise-3 mt-10 max-w-xl">
            <UrlForm />
          </div>
        </section>

        <aside className="hidden md:block">
          <div className="plate p-5 text-xs leading-6 text-ink-soft">
            <p className="mb-3 flex items-baseline justify-between uppercase tracking-[0.2em]">
              <span>specimen</span>
              <span className="text-accent">llms.txt</span>
            </p>
            <pre className="whitespace-pre-wrap font-mono">
              <span className="font-semibold text-ink"># Acme</span>
              {"\n\n"}
              <span className="italic">&gt; Acme builds developer tooling.</span>
              {"\n\n"}
              <span className="font-semibold text-ink">## Docs</span>
              {"\n"}- [Quickstart](/docs/quickstart)
              {"\n"}- [API reference](/docs/api)
              {"\n\n"}
              <span className="font-semibold text-ink">## Optional</span>
              {"\n"}- [Blog](/blog)
              <span className="cursor-blink text-accent">▌</span>
            </pre>
          </div>
          <ol className="mt-6 space-y-2 text-xs text-ink-soft">
            <li className="flex gap-3">
              <span className="text-accent">01</span> crawl the site, sitemap-first
            </li>
            <li className="flex gap-3">
              <span className="text-accent">02</span> draft + validate against the spec
            </li>
            <li className="flex gap-3">
              <span className="text-accent">03</span> host it, version it, keep it fresh
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
