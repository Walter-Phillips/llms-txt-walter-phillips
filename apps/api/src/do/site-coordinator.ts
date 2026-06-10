import { DurableObject } from "cloudflare:workers";
import type { Env } from "../bindings";

type Phase = "idle" | "discovering" | "crawling" | "generating" | "done" | "error";

type State = {
  runId: string | null;
  phase: Phase;
  pagesFound: number;
  pagesCrawled: number;
  discoveryMethod: string | null;
  frontier: string[]; // pending URLs, deduped
  inFlight: Set<string>;
  seen: Set<string>;
};

const DEFAULT_STATE: State = {
  runId: null,
  phase: "idle",
  pagesFound: 0,
  pagesCrawled: 0,
  discoveryMethod: null,
  frontier: [],
  inFlight: new Set(),
  seen: new Set(),
};

/**
 * One SiteCoordinator per domain. Owns the URL frontier, dedupes,
 * tracks live progress, and serves as the per-site mutex.
 *
 * State here is *runtime* coordination state. D1 is the durable
 * record once a run finishes.
 */
export class SiteCoordinator extends DurableObject<Env> {
  private state: State = DEFAULT_STATE;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/status") return Response.json(this.snapshot());
    return new Response("not found", { status: 404 });
  }

  private snapshot() {
    return {
      runId: this.state.runId,
      phase: this.state.phase,
      pagesFound: this.state.pagesFound,
      pagesCrawled: this.state.pagesCrawled,
      discoveryMethod: this.state.discoveryMethod,
      frontierSize: this.state.frontier.length,
      inFlight: this.state.inFlight.size,
    };
  }

  // TODO: claimRun, enqueueDiscovered, markCrawled, transitionToGenerate,
  // markDone — invoked from queue consumers via stub.fetch(...) RPCs.
}
