import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { DocumentationCodeBlock } from "@/components/documentation-code-block";
import { Icons } from "@/components/icons";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Learn what llms.txt is, generate one for a site, and use the stable hosted file in developer workflows.",
  alternates: {
    canonical: "/docs",
  },
};

const quickNav = [
  { href: "#what", label: "What it is" },
  { href: "#quickstart", label: "Quickstart" },
  { href: "#connect", label: "Connect domain" },
  { href: "#features", label: "Features" },
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

const featureItems = [
  {
    title: "Stable hosted URL",
    body: "Every generated site gets a shareable URL that always resolves to the latest validated llms.txt. Use it from docs, deployment checks, reverse proxies, or internal runbooks.",
    code: `curl "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt"`,
  },
  {
    title: "Automatic updates",
    body: "Monitoring starts on by default. When the site structure or page metadata changes, the app can crawl again, publish a new version, and keep the hosted URL pointed at the current file.",
    rows: [
      { term: "stable URL", detail: "latest validated version" },
      { term: "monitoring", detail: "crawl when the site changes" },
      { term: "history", detail: "compare previous versions" },
    ],
  },
  {
    title: "Reviewable inventory",
    body: "The result page shows which pages were discovered and how they were classified before the file was rendered, so developers can catch missing docs, noisy pages, or thin generated output.",
    rows: [
      { term: "docs pages", detail: "included" },
      { term: "reference pages", detail: "included" },
      { term: "low-signal URLs", detail: "optional or omitted" },
    ],
  },
  {
    title: "Version history",
    body: "Each publish is stored as a version. Use the timeline and diffs to see what changed between crawls before you wire the file into a production docs workflow.",
    rows: [
      { term: "v3", detail: "current" },
      { term: "v2", detail: "2 pages added, 1 modified" },
      { term: "v1", detail: "first generated file" },
    ],
  },
] as const;

const proxySnippets = [
  {
    title: "Cloudflare Worker",
    description:
      "Use a Worker route on the site owner's zone, such as example.com/llms.txt, when Cloudflare controls the domain.",
    filename: "worker.js",
    code: `const SOURCE =
  "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt";

export default {
  async fetch() {
    const upstream = await fetch(SOURCE);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  },
};`,
  },
  {
    title: "Vercel rewrite",
    description:
      "Add a rewrite when the site is deployed on Vercel and /llms.txt can be routed at the platform layer.",
    filename: "vercel.json",
    code: `{
  "rewrites": [
    {
      "source": "/llms.txt",
      "destination": "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt"
    }
  ]
}`,
  },
  {
    title: "Next.js route handler",
    description:
      "Use a route handler when you want cache control in application code or when platform rewrites are not available.",
    filename: "app/llms.txt/route.ts",
    code: `export async function GET() {
  const upstream = await fetch(
    "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt",
    { next: { revalidate: 300 } },
  );

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}`,
  },
  {
    title: "Netlify proxy",
    description: "Use a forced 200 rewrite so the visitor stays on the site's own /llms.txt URL.",
    filename: "netlify.toml",
    code: `[[redirects]]
from = "/llms.txt"
to = "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt"
status = 200
force = true`,
  },
  {
    title: "Nginx",
    description:
      "Proxy the exact file path from the origin server or a reverse proxy in front of it.",
    filename: "nginx.conf",
    code: `location = /llms.txt {
  proxy_pass https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt;
  proxy_set_header Host our-api.example.com;
  proxy_ssl_server_name on;
  add_header Cache-Control "public, max-age=300" always;
}`,
  },
  {
    title: "Apache",
    description: "Enable mod_proxy and map the exact /llms.txt path to the generated hosted URL.",
    filename: ".htaccess or vhost.conf",
    code: `ProxyPass "/llms.txt" "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt"
ProxyPassReverse "/llms.txt" "https://our-api.example.com/sites/https%3A%2F%2Fexample.com/llms.txt"
Header set Cache-Control "public, max-age=300"`,
  },
] as const;

function DocumentationHero(): ReactElement {
  return (
    <header className="docs-hero">
      <p className="docs-kicker">Developer docs</p>
      <h1>Generate and publish llms.txt for a site.</h1>
      <p>
        Use the app to turn a public website into a spec-compliant <code>llms.txt</code> file,
        review what was included, and serve the latest version from a stable URL.
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

function WhatSection(): ReactElement {
  return (
    <section id="what" className="docs-section" aria-labelledby="docs-what-title">
      <div className="docs-section-head">
        <p className="docs-kicker">llms.txt basics</p>
        <h2 id="docs-what-title">What an llms.txt file does</h2>
      </div>
      <div className="docs-prose">
        <p>
          An <code>llms.txt</code> file is a plain-text map for language models. It gives models a
          concise description of the site and a curated list of URLs that are worth reading, such as
          docs, API references, changelogs, pricing pages, or support material.
        </p>
        <p>
          The file does not replace your sitemap, robots.txt, or public docs. It gives LLMs a
          smaller entry point that explains which pages matter and why, so a model can choose better
          sources before answering questions about your product.
        </p>
        <p>
          You can find the official spec&nbsp;
          <a
            href="https://llmstxt.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            here
          </a>
        </p>
      </div>
    </section>
  );
}

function QuickstartSection(): ReactElement {
  return (
    <section id="quickstart" className="docs-section" aria-labelledby="docs-quickstart-title">
      <div className="docs-section-head">
        <p className="docs-kicker">Quickstart</p>
        <h2 id="docs-quickstart-title">Generate a file for any public site</h2>
      </div>
      <div className="docs-prose">
        <p>
          Start with the homepage or the canonical docs URL for the site you care about. The app
          discovers crawlable pages, generates the file, validates it against the spec, and takes
          you to a result page with the rendered output.
        </p>
        <p>
          For developer workflows, the hosted URL is usually the important artifact. You can paste
          it into a pull request, add it to release checklist documentation, or proxy it from your
          own <code>/llms.txt</code> path when you are ready to serve it from the site.
        </p>
      </div>
      <div className="docs-steps" aria-label="Generation steps">
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

function ConnectSection(): ReactElement {
  return (
    <section id="connect" className="docs-section" aria-labelledby="docs-connect-title">
      <div className="docs-section-head">
        <p className="docs-kicker">Connect your domain</p>
        <h2 id="docs-connect-title">Proxy /llms.txt from infrastructure you control</h2>
      </div>
      <div className="docs-prose">
        <p>
          The hosted URL is the source of truth for generated files. To make{" "}
          <code>https://example.com/llms.txt</code> resolve on a real domain, the site owner must
          add a proxy, rewrite, or route in their DNS, CDN, hosting platform, or origin server.
        </p>
        <p>
          This app cannot install that route unless it controls the site. For v1, connecting a
          domain means copying the hosted URL from the result page and installing the matching
          snippet in the platform that serves the site.
        </p>
        <p>Code starts for common setups:</p>
      </div>
      <div className="docs-integration-list">
        {proxySnippets.map((snippet) => (
          <section key={snippet.title} className="docs-integration">
            <h3>{snippet.title}</h3>
            <p>{snippet.description}</p>
            <DocumentationCodeBlock label={snippet.filename}>{snippet.code}</DocumentationCodeBlock>
          </section>
        ))}
      </div>
    </section>
  );
}

function FeaturesSection(): ReactElement {
  return (
    <section id="features" className="docs-section" aria-labelledby="docs-features-title">
      <div className="docs-section-head">
        <p className="docs-kicker">Using the application</p>
        <h2 id="docs-features-title">Features developers can build around</h2>
      </div>
      <div className="docs-prose">
        <p>
          The app is designed for a practical loop: generate, inspect, publish, and keep the file
          current. You do not need an account to generate a file, and you can decide later whether
          to use the hosted URL directly or bring the content into your own deployment.
        </p>
      </div>
      <div className="docs-feature-grid">
        {featureItems.map((item) => (
          <section key={item.title} className="docs-feature">
            <h3>
              <Icons.check size={14} />
              {item.title}
            </h3>
            <p>{item.body}</p>
            {"code" in item ? (
              <pre className="docs-feature-code">
                <code>{item.code}</code>
              </pre>
            ) : (
              <dl className="docs-feature-rows">
                {item.rows.map((row) => (
                  <div key={row.term}>
                    <dt>{row.term}</dt>
                    <dd>{row.detail}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

export default function DocumentationPage(): ReactElement {
  return (
    <article className="docs-page">
      <DocumentationHero />
      <WhatSection />
      <QuickstartSection />
      <ConnectSection />
      <FeaturesSection />
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
