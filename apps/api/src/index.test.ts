import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("api", () => {
  it("returns health", async () => {
    const response = await app.request("/health");
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
