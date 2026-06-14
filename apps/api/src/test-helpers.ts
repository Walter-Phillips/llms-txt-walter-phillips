import { crawlRuns, fileVersions, pages, sites } from "@profound-takehome/db";
import { vi } from "vitest";
import type { Env } from "./bindings";

type Table = typeof sites | typeof crawlRuns | typeof pages | typeof fileVersions;

type SelectResponse = unknown | unknown[];

type QueuedSelect = {
  table: Table;
  result: SelectResponse;
};

export type InsertRecord = {
  table: string;
  values: Record<string, unknown>;
};

export type UpdateRecord = {
  table: string;
  values: Record<string, unknown>;
};

function tableName(table: Table): string {
  if (table === sites) return "sites";
  if (table === crawlRuns) return "crawlRuns";
  if (table === pages) return "pages";
  if (table === fileVersions) return "fileVersions";
  return "unknown";
}

class FakeSelect {
  private table: Table | null = null;

  constructor(private readonly db: FakeDb) {}

  from(table: Table) {
    this.table = table;
    return this;
  }

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    const result = this.db.takeSelect(this.table);
    return Array.isArray(result) ? (result[0] ?? undefined) : result;
  }

  async all() {
    const result = this.db.takeSelect(this.table);
    return Array.isArray(result) ? result : result == null ? [] : [result];
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.all().then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  readonly inserts: InsertRecord[] = [];
  readonly updates: UpdateRecord[] = [];
  private readonly selects: QueuedSelect[] = [];

  queueSelect(table: Table, result: SelectResponse) {
    this.selects.push({ table, result });
  }

  takeSelect(table: Table | null) {
    if (!table) throw new Error("fake db select used before from()");
    const next = this.selects.shift();
    if (!next) throw new Error(`fake db missing queued select for ${tableName(table)}`);
    if (next.table !== table) {
      throw new Error(`fake db expected ${tableName(next.table)} select, got ${tableName(table)}`);
    }
    return next.result;
  }

  select() {
    return new FakeSelect(this);
  }

  insert(table: Table) {
    return {
      values: async (values: Record<string, unknown>) => {
        this.inserts.push({ table: tableName(table), values });
      },
    };
  }

  update(table: Table) {
    return {
      set: (values: Record<string, unknown>) => {
        this.updates.push({ table: tableName(table), values });
        return { where: async () => undefined };
      },
    };
  }
}

export function createTestEnv(db: FakeDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as D1Database,
    FILES: { put: vi.fn(async () => undefined) } as unknown as R2Bucket,
    RATE_LIMIT: {} as KVNamespace,
    CRAWL_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Env["CRAWL_QUEUE"],
    MONITOR_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Env["MONITOR_QUEUE"],
    SITE_COORDINATOR: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => Response.json({})),
      })),
    } as unknown as DurableObjectNamespace,
    ANTHROPIC_API_KEY: "test-key",
    APP_ORIGIN: "https://app.example.com",
    ...overrides,
  };
}

export function createSiteCoordinator(live: unknown) {
  const fetch = vi.fn(async () => Response.json(live));
  const stub = { fetch };
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, fetch };
}
