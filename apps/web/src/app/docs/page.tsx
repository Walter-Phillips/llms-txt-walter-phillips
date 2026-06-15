import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { Icons } from "@/components/icons";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Learn how to generate, host, monitor, and version llms.txt files, plus how the crawler and generation pipeline work under the hood.",
  alternates: {
    canonical: "/docs",
  },
};

const quickNav = [
  { href: "#use", label: "Use it" },
  { href: "#under-the-hood", label: "Under the hood" },
  { href: "#trust", label: "Trust boundaries" },
] as const;

const useSteps = [
  {
    label: "01",
    title: "Paste a public URL",
    body: "Start from the homepage or a canonical docs URL. The crawler normalizes the origin, discovers crawl candidates, and starts a bounded run.",
  },
  {
    label: "02",
    title: "Watch crawl progress",
    body: "Progress moves through discovery, crawling, generation, and validation so it is clear whether the system is still gathering pages or publishing the file.",
  },
  {
    label: "03",
    title: "Review the result",
    body: "The result page shows the rendered llms.txt, copy and download actions, the stable hosted URL, and the page inventory used to produce the file.",
  },
  {
    label: "04",
    title: "Keep it current",
    body: "Monitoring can regenerate the file when site structure or page metadata changes. Version history records what changed and supports inline diffs.",
  },
] as const;

const pipeline = [
  {
    title: "Web app",
    body: "The Next.js interface owns presentation and sends typed requests to the Worker API.",
  },
  {
    title: "Worker API",
    body: "The Cloudflare Worker registers sites, starts crawl runs, serves hosted files, and exposes progress and history endpoints.",
  },
  {
    title: "Coordinator",
    body: "A Durable Object owns live crawl state: frontier, active progress, and drain behavior.",
  },
  {
    title: "Queues",
    body: "Queue consumers fetch pages, classify inventory, retire unseen pages, and trigger generation when a run completes.",
  },
  {
    title: "Storage",
    body: "D1 stores durable site, run, page, and version history. R2 stores the published llms.txt file.",
  },
  {
    title: "Generator",
    body: "The LLM pass summarizes known crawled URLs only, maps output back to the inventory, and validates the file before publishing.",
  },
] as const;

const trustItems = [
  "Crawls are bounded by design: default page cap is 1,000 and depth cap is 3.",
  "The file is metadata, not a full-content dump. It links and describes canonical pages.",
  "The generator cannot invent URLs; output is mapped back to the crawled inventory.",
  "Static fetch is the default. Browser rendering is a budget-capped fallback for sites that need it.",
  "The spec validator gates every generated file before it is written to public storage.",
  "The observer-first product does not require accounts or site ownership to generate a file.",
] as const;

function DocumentationHero(): ReactElement {
  return (
    <header className="docs-hero">
      <p className="docs-kicker">Product docs</p>
      <h1>Generate a durable map of your site for language models.</h1>
      <p>
        This product crawls a public website, turns the discovered inventory into a spec-compliant{" "}
        <code>llms.txt</code>, hosts it at a stable URL, and can keep it in sync as the site
        changes.
      </p>
      <nav className="docs-quicknav" aria-label="Docs sections">
        {quickNav.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function UsageSection(): ReactElement {
  return (
    <section id="use" className="docs-section" aria-labelledby="docs-use-title">
      <div className="docs-section-head">
        <span className="docs-section-index">01</span>
        <div>
          <p className="docs-kicker">Using the product</p>
          <h2 id="docs-use-title">From URL to hosted llms.txt</h2>
        </div>
      </div>
      <div className="docs-steps">
        {useSteps.map((step) => (
          <section key={step.label} className="docs-step" aria-labelledby={`use-${step.label}`}>
            <span>{step.label}</span>
            <h3 id={`use-${step.label}`}>{step.title}</h3>
            <p>{step.body}</p>
          </section>
        ))}
      </div>
    </section>
  );
}

function PipelineSection(): ReactElement {
  return (
    <section
      id="under-the-hood"
      className="docs-section docs-section-split"
      aria-labelledby="docs-pipeline-title"
    >
      <div className="docs-section-head">
        <span className="docs-section-index">02</span>
        <div>
          <p className="docs-kicker">Under the hood</p>
          <h2 id="docs-pipeline-title">The publishing pipeline</h2>
        </div>
      </div>
      <div className="docs-pipeline" aria-label="Pipeline stages">
        {pipeline.map((stage, index) => (
          <section key={stage.title} className="docs-pipe-stage">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{stage.title}</h3>
            <p>{stage.body}</p>
          </section>
        ))}
      </div>
    </section>
  );
}

function TrustSection(): ReactElement {
  return (
    <section id="trust" className="docs-section docs-trust" aria-labelledby="docs-trust-title">
      <div className="docs-section-head">
        <span className="docs-section-index">03</span>
        <div>
          <p className="docs-kicker">Trust boundaries</p>
          <h2 id="docs-trust-title">What the system does and does not promise</h2>
        </div>
      </div>
      <ul className="docs-trust-list">
        {trustItems.map((item) => (
          <li key={item}>
            <Icons.check size={14} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DocumentationPage(): ReactElement {
  return (
    <article className="docs-page">
      <DocumentationHero />
      <UsageSection />
      <PipelineSection />
      <TrustSection />
      <footer className="docs-footer">
        <Link className="btn btn-primary" href="/">
          Generate a file <Icons.arrow size={14} />
        </Link>
        <a className="btn btn-ghost" href="https://llmstxt.org" target="_blank" rel="noreferrer">
          Read the spec <Icons.external size={13} />
        </a>
      </footer>
    </article>
  );
}
