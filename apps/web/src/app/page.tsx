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
        <span className="tok-h1"># llmstxt.gen</span>
        {"\n\n"}
        <span className="tok-quote">&gt; Generate hosted llms.txt files for your site.</span>
        {"\n"}
        <span className="tok-quote">&gt; Keep them current as your site changes.</span>
        {"\n\n"}
        <span className="tok-h2">## Docs</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Product docs]</span>
        <span className="tok-url">(/docs)</span>
        <span className="tok-desc">: Guide</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Use]</span>
        <span className="tok-url">(/docs#use)</span>
        <span className="tok-desc">: Generate + monitor</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Pipeline]</span>
        <span className="tok-url">(/docs#under-the-hood)</span>
        <span className="tok-desc">: Internals</span>
        {"\n\n"}
        <span className="tok-h2">## Product</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Generate]</span>
        <span className="tok-url">(/)</span>
        <span className="tok-desc">: Start a run</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Trust]</span>
        <span className="tok-url">(/docs#trust)</span>
        <span className="tok-desc">: Crawl limits</span>
        {"\n\n"}
        <span className="tok-h2">## Optional</span>
        {"\n"}
        <span className="tok-bullet">- </span>
        <span className="tok-link">[Spec]</span>
        <span className="tok-url">(https://llmstxt.org)</span>
        <span className="tok-desc">: llms.txt</span>
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
