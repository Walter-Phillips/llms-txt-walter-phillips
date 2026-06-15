import { crawlRuns, fileVersions, pages, sites } from "@profound-takehome/db";
import { vi } from "vitest";
import type { Environment } from "./bindings";

type Table = typeof sites | typeof crawlRuns | typeof pages | typeof fileVersions;

type SelectRow = object;
type SelectResponse = SelectRow | SelectRow[] | undefined;

interface QueuedSelect {
  table: Table;
  result: SelectResponse;
}

export interface InsertRecord {
  table: string;
  values: Record<string, unknown>;
}

export interface UpdateRecord {
  table: string;
  values: Record<string, unknown>;
}

function tableName(table: Table): string {
  if (table === sites) return "sites";
  if (table === crawlRuns) return "crawlRuns";
  if (table === pages) return "pages";
  if (table === fileVersions) return "fileVersions";
  return "unknown";
}

function isSelectRows(result: SelectResponse): result is SelectRow[] {
  return Array.isArray(result);
}

class FakeSelect {
  private table: Table | null = null;

  constructor(private readonly db: FakeDatabase) {}

  from(table: Table): this {
    this.table = table;
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  get(): Promise<SelectRow | undefined> {
    const result = this.db.takeSelect(this.table);
    return Promise.resolve(isSelectRows(result) ? (result[0] ?? undefined) : result);
  }

  all(): Promise<SelectRow[]> {
    const result = this.db.takeSelect(this.table);
    if (result === undefined) return Promise.resolve([]);
    return Promise.resolve(isSelectRows(result) ? result : [result]);
  }

  then<TResult1 = SelectRow[], TResult2 = never>(
    onfulfilled?: ((value: SelectRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.all().then(onfulfilled, onrejected);
  }
}

/**
 * Minimal in-memory Drizzle stand-in for route tests.
 */
export class FakeDatabase {
  readonly inserts: InsertRecord[] = [];
  readonly updates: UpdateRecord[] = [];
  private readonly selects: QueuedSelect[] = [];

  /**
   * Queues a select result for a specific table.
   *
   * @param table Table expected by the next select.
   * @param result Row, row list, or missing result to return.
   */
  queueSelect(table: Table, result: SelectResponse): void {
    this.selects.push({ table, result });
  }

  /**
   * Removes the next queued select result.
   *
   * @param table Table requested by the fake query.
   * @returns Queued select result.
   * @throws When the query table does not match the queued result.
   */
  takeSelect(table: Table | null): SelectResponse {
    if (!table) throw new Error("fake db select used before from()");
    const next = this.selects.shift();
    if (!next) throw new Error(`fake db missing queued select for ${tableName(table)}`);
    if (next.table !== table) {
      throw new Error(`fake db expected ${tableName(next.table)} select, got ${tableName(table)}`);
    }
    return next.result;
  }

  /**
   * Starts a fake select builder.
   *
   * @returns Chainable fake select builder.
   */
  select(): FakeSelect {
    return new FakeSelect(this);
  }

  /**
   * Records an insert into a fake table.
   *
   * @param table Table being inserted into.
   * @returns Fake insert builder.
   */
  insert(table: Table): { values: (values: Record<string, unknown>) => Promise<void> } {
    return {
      values: (values: Record<string, unknown>): Promise<void> => {
        this.inserts.push({ table: tableName(table), values });
        return Promise.resolve();
      },
    };
  }

  /**
   * Records an update against a fake table.
   *
   * @param table Table being updated.
   * @returns Fake update builder.
   */
  update(table: Table): {
    set: (values: Record<string, unknown>) => { where: () => Promise<undefined> };
  } {
    return {
      set: (values: Record<string, unknown>) => {
        this.updates.push({ table: tableName(table), values });
        return { where: () => Promise.resolve(undefined) };
      },
    };
  }
}

/**
 * Creates a Cloudflare environment for API route tests.
 *
 * @param db Fake database to expose as the D1 binding.
 * @param overrides Binding overrides for a specific test.
 * @returns Test environment bindings.
 */
export function createTestEnvironment(
  db: FakeDatabase,
  overrides: Partial<Environment> = {},
): Environment {
  return {
    DB: db as unknown as D1Database,
    FILES: { put: vi.fn(() => Promise.resolve(undefined)) } as unknown as R2Bucket,
    RATE_LIMIT: {} as KVNamespace,
    CRAWL_QUEUE: {
      send: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as Environment["CRAWL_QUEUE"],
    MONITOR_QUEUE: {
      send: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as Environment["MONITOR_QUEUE"],
    SITE_COORDINATOR: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({
        fetch: vi.fn(() => Promise.resolve(Response.json({}))),
      })),
    } as unknown as DurableObjectNamespace,
    ANTHROPIC_API_KEY: "test-key",
    APP_ORIGIN: "https://app.example.com",
    ...overrides,
  };
}

/**
 * Creates a Durable Object namespace that returns fixed live state.
 *
 * @param live JSON state returned by the fake Durable Object.
 * @returns Namespace plus fetch spy for assertions.
 */
export function createSiteCoordinator(live: unknown): {
  namespace: DurableObjectNamespace;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} {
  const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(Response.json(live)),
  );
  const stub = { fetch };
  const namespace = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, fetch };
}

export { createTestEnvironment as createTestEnv, FakeDatabase as FakeDb };
