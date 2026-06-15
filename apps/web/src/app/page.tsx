import type { ReactElement } from "react";
import { Icons } from "@/components/icons";
import { HomePathfinder } from "@/components/pathfinder";
import { SplitFlapBoard } from "@/components/split-flap";
import { UrlForm } from "@/components/url-form";

function SpecimenPanel(): ReactElement {
  return (
    <aside className="specimen">
      <div className="specimen-file-head">
        <Icons.file size={13} />
        <span>llms.txt</span>
        <span className="specimen-file-spec">spec v0.1</span>
      </div>
      <pre className="specimen-pre">
        <span className="tok-h1"># Acme</span>
        {"\n\n"}
        <span className="tok-quote">&gt; Acme builds developer tooling. This file lists the</span>
        {"\n"}
        <span className="tok-quote"> canonical pages of acme.com for language models.</span>
        {"\n\n"}
        <span className="tok-h2">## Docs</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Quickstart]</span>
        <span className="tok-url">(/docs/quickstart)</span>
        <span className="tok-desc">: Ship in 5 min</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[API reference]</span>
        <span className="tok-url">(/docs/api)</span>
        <span className="tok-desc">: Endpoints + types</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Self-hosting]</span>
        <span className="tok-url">(/docs/self-hosting)</span>
        {"\n\n"}
        <span className="tok-h2">## Product</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Pricing]</span>
        <span className="tok-url">(/pricing)</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Integrations]</span>
        <span className="tok-url">(/integrations)</span>
        {"\n\n"}
        <span className="tok-h2">## Optional</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Blog]</span>
        <span className="tok-url">(/blog)</span>
        <span className="caret">▌</span>
      </pre>
    </aside>
  );
}

export default function Home(): ReactElement {
  return (
    <>
      <HomePathfinder />
      <div className="home">
        <section className="hero">
          <h1 className="hero-title">
            Make your website <em>legible</em> to <SplitFlapBoard />
          </h1>
          <p className="hero-sub">
            An <code>llms.txt</code> is the file LLMs read to understand your site. Paste your URL:
            we crawl every page and generate a spec-compliant <code>/llms.txt</code> so models cite
            your real docs instead of guessing.
          </p>
          <div className="hero-form">
            <UrlForm />
          </div>
        </section>
        <SpecimenPanel />
      </div>
    </>
  );
}
