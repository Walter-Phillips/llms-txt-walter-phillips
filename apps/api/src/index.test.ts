import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("api", () => {
  it("returns health", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
