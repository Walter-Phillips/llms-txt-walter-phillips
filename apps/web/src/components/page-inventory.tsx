import type { PageInventoryItem } from "@profound-takehome/shared";
import type { JSX } from "react";

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "") || "/";
}

export function PageInventory({ pages }: { pages: PageInventoryItem[] }): JSX.Element {
  return (
    <div className="inv">
      <div className="inv-table">
        <div className="inv-row inv-head">
          <span>path</span>
          <span>title</span>
          <span>status</span>
        </div>
        {pages.map((page) => {
          const muted = page.status !== "ok";
          return (
            <div className={`inv-row ${muted ? "inv-row-mute" : ""}`} key={page.url}>
              <span className="inv-path">{pathOf(page.url)}</span>
              <span className="inv-title">
                {page.title ?? <em className="mono-dim">no title</em>}
              </span>
              <span className={`inv-status ${muted ? "inv-status-mute" : ""}`}>{page.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
