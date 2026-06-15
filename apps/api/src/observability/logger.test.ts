import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../bindings";
import { withObservabilityContext } from "./context";
import { logError, logInfo, urlFields } from "./logger";

function firstConsoleArgument(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const argument = spy.mock.calls[0]?.[0];
  expect(argument).toBeTypeOf("object");
  if (typeof argument !== "object" || argument === null) throw new Error("missing log object");
  return argument as Record<string, unknown>;
}

function fetchUrl(input: RequestInfo | URL | undefined): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.toString();
  return typeof input === "string" ? input : "";
}

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits Pino object logs with project fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logInfo("test_event", {
      workflow: "test",
      step: "emit",
      outcome: "ok",
      siteId: "site_1",
    });

    expect(firstConsoleArgument(info)).toMatchObject({
      service: "llms-txt-api",
      level: "info",
      event: "test_event",
      workflow: "test",
      step: "emit",
      outcome: "ok",
      siteId: "site_1",
    });
  });

  it("redacts sensitive fields before handing records to Pino", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Error("boom");

    logError("test_error", {
      apiKey: "secret-key",
      nested: { token: "secret-token", safe: "visible" },
      error: cause,
    });

    expect(firstConsoleArgument(error)).toMatchObject({
      event: "test_error",
      apiKey: "[redacted]",
      nested: { token: "[redacted]", safe: "visible" },
      error: { name: "Error", message: "boom" },
    });
  });

  it("summarizes URLs without query strings or fragments", () => {
    expect(urlFields("https://example.com/docs?a=1#top")).toEqual({
      domain: "https://example.com",
      path: "/docs",
    });
  });

  it("schedules Axiom forwarding when invocation context has Axiom config", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ingested: 1,
        failed: 0,
        failures: [],
      }),
    );
    const pending: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil: (promise: Promise<unknown>): void => {
        pending.push(promise);
      },
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const env = {
      AXIOM_DATASET: "logs",
      AXIOM_TOKEN: "token",
    } as Environment;

    withObservabilityContext({ env, executionContext }, () => {
      logInfo("test_axiom", { workflow: "test", step: "axiom", outcome: "queued" });
    });

    await Promise.all(pending);
    expect(info).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchUrl(fetch.mock.calls[0]?.[0])).toContain("/v1/datasets/logs/ingest");
  });
});
