import {
  createSiteResponseSchema,
  diffResponseSchema,
  jobStatusResponseSchema,
  pagesResponseSchema,
  siteResponseSchema,
  versionsResponseSchema,
  type CreateSiteResponse,
  type DiffResponse,
  type JobStatusResponse,
  type PagesResponse,
  type SiteResponse,
  type VersionsResponse
} from "@profound-takehome/shared";

/**
 * Thin typed client for the Worker API. Every response is parsed with the
 * shared zod contracts so the UI never trusts unvalidated JSON.
 *
 * Set NEXT_PUBLIC_API_MOCK=1 to swap in an in-memory mock that simulates a
 * full crawl, so every screen is demoable without the backend.
 */
export interface LlmsApi {
  createSite(url: string): Promise<CreateSiteResponse>;
  getSite(siteId: string): Promise<SiteResponse>;
  getJob(runId: string): Promise<JobStatusResponse>;
  getVersions(siteId: string): Promise<VersionsResponse>;
  getPages(siteId: string): Promise<PagesResponse>;
  getDiff(siteId: string, from: number, to: number): Promise<DiffResponse>;
  setMonitoring(siteId: string, enabled: boolean): Promise<SiteResponse>;
  getLlmsTxt(domain: string): Promise<string>;
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

export function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** The shareable hosted URL for a generated file. */
export function hostedFileUrl(originOrDomain: string): string {
  return `${apiBaseUrl()}/sites/${encodeURIComponent(originOrDomain)}/llms.txt`;
}

async function request<T>(
  path: string,
  parse: (data: unknown) => T,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    });
  } catch {
    throw new ApiRequestError(0, "Could not reach the API. Is the Worker running?");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "error" in body) {
        message = String((body as { error: unknown }).error);
      }
    } catch {
      // keep the generic message
    }
    throw new ApiRequestError(res.status, message);
  }
  return parse(await res.json());
}

const httpClient: LlmsApi = {
  createSite: (url) =>
    request("/api/sites", (d) => createSiteResponseSchema.parse(d), {
      method: "POST",
      body: JSON.stringify({ url: normalizeWebsiteUrl(url) })
    }),
  getSite: (siteId) => request(`/api/sites/${siteId}`, (d) => siteResponseSchema.parse(d)),
  getJob: (runId) => request(`/api/jobs/${runId}`, (d) => jobStatusResponseSchema.parse(d)),
  getVersions: (siteId) =>
    request(`/api/sites/${siteId}/versions`, (d) => versionsResponseSchema.parse(d)),
  getPages: (siteId) => request(`/api/sites/${siteId}/pages`, (d) => pagesResponseSchema.parse(d)),
  getDiff: (siteId, from, to) =>
    request(`/api/sites/${siteId}/diff?from=${from}&to=${to}`, (d) => diffResponseSchema.parse(d)),
  setMonitoring: (siteId, enabled) =>
    request(`/api/sites/${siteId}/monitoring`, (d) => siteResponseSchema.parse(d), {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    }),
  getLlmsTxt: async (domain) => {
    const res = await fetch(hostedFileUrl(domain));
    if (!res.ok) throw new ApiRequestError(res.status, `File not found (${res.status})`);
    return res.text();
  }
};

export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_API_MOCK === "1";
}

let client: LlmsApi | null = null;

async function resolveClient(): Promise<LlmsApi> {
  if (client) return client;
  if (isMockMode()) {
    const { mockClient } = await import("./mock-api");
    client = mockClient;
  } else {
    client = httpClient;
  }
  return client;
}

/** Module-level facade so callers can `import { api }` regardless of mode. */
export const api: LlmsApi = {
  createSite: async (url) => (await resolveClient()).createSite(normalizeWebsiteUrl(url)),
  getSite: async (siteId) => (await resolveClient()).getSite(siteId),
  getJob: async (runId) => (await resolveClient()).getJob(runId),
  getVersions: async (siteId) => (await resolveClient()).getVersions(siteId),
  getPages: async (siteId) => (await resolveClient()).getPages(siteId),
  getDiff: async (siteId, from, to) => (await resolveClient()).getDiff(siteId, from, to),
  setMonitoring: async (siteId, enabled) => (await resolveClient()).setMonitoring(siteId, enabled),
  getLlmsTxt: async (domain) => (await resolveClient()).getLlmsTxt(domain)
};
