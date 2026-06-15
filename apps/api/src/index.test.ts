import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";

describe("api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns health", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await app.request("/health");
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
