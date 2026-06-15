import { type Context, Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sites, fileVersions } from "@profound-takehome/db";
import type { Environment } from "../bindings";
import { normalizeOrigin } from "../lib/url";

export const filesRouter = new Hono<{ Bindings: Environment }>();

type SiteRow = typeof sites.$inferSelect;

interface VersionRange {
  from: number;
  to: number;
}

interface DiffLabels {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Shared version-history handlers — operate on an already-resolved site row.
// Each router resolves its site (by id or by domain) then delegates here so
// the listing/diff logic lives in exactly one place.
// ---------------------------------------------------------------------------

/**
 * Lists stored file versions for a site.
 *
 * @param c Active Hono request context.
 * @param db Drizzle database connection.
 * @param site Site whose versions should be listed.
 * @returns JSON response containing the version rows.
 */
export async function listVersions(
  c: Context<{ Bindings: Environment }>,
  db: ReturnType<typeof drizzle>,
  site: SiteRow,
): Promise<Response> {
  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version));
  return c.json({ versions });
}

/**
 * Computes a unified diff between two stored file versions.
 *
 * @param c Active Hono request context.
 * @param db Drizzle database connection.
 * @param site Site that owns both versions.
 * @param versions Version numbers to compare.
 * @returns JSON response with the generated diff or an error.
 */
export async function computeDiff(
  c: Context<{ Bindings: Environment }>,
  db: ReturnType<typeof drizzle>,
  site: SiteRow,
  versions: VersionRange,
): Promise<Response> {
  const { from, to } = versions;
  const rows = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, site.id), inArray(fileVersions.version, [from, to])));
  const fromRow = rows.find((r) => r.version === from);
  const toRow = rows.find((r) => r.version === to);
  if (!fromRow || !toRow) return c.json({ error: "version_not_found" }, 404);

  const [fromObject, toObject] = await Promise.all([
    c.env.FILES.get(fromRow.r2Key),
    c.env.FILES.get(toRow.r2Key),
  ]);
  if (!fromObject || !toObject) return c.json({ error: "file_missing" }, 500);

  const [fromText, toText] = await Promise.all([fromObject.text(), toObject.text()]);
  const diff = unifiedDiff(fromText, toText, {
    from: `llms.txt v${String(from)}`,
    to: `llms.txt v${String(to)}`,
  });
  return c.json({ from, to, diff });
}

/**
 * Builds possible stored-domain keys from a route parameter.
 *
 * @param parameter Raw or encoded domain route parameter.
 * @returns Candidate origin strings to query.
 */
export function domainCandidates(parameter: string): string[] {
  let decoded = parameter;
  try {
    decoded = decodeURIComponent(parameter);
  } catch {
    // Hono may already decode route params; keep the original value.
  }

  const candidates = new Set<string>();
  const origin = normalizeOrigin(decoded);
  if (origin) candidates.add(origin);
  candidates.add(decoded);
  if (!decoded.includes("://")) {
    candidates.add(`https://${decoded}`);
    candidates.add(`http://${decoded}`);
  }
  return [...candidates];
}

async function findSiteByDomainParameter(
  db: ReturnType<typeof drizzle>,
  parameter: string,
): Promise<SiteRow | undefined> {
  for (const candidate of domainCandidates(parameter)) {
    const site = await db.select().from(sites).where(eq(sites.domain, candidate)).get();
    if (site) return site;
  }
  return undefined;
}

// Public: GET /sites/:domain/llms.txt → latest file for a registered domain.
// The domain segment may be an encoded origin, e.g. https%3A%2F%2Fexample.com.
filesRouter.get("/:domain/llms.txt", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParameter(db, c.req.param("domain"));
  if (!site) return c.text("not found", 404);

  const latest = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  if (!latest) return c.text("not generated yet", 404);

  const object = await c.env.FILES.get(latest.r2Key);
  if (!object) return c.text("file missing", 500);

  return new Response(object.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-llms-txt-version": String(latest.version),
    },
  });
});

filesRouter.get("/:domain/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParameter(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);
  return listVersions(c, db, site);
});

// GET /sites/:domain/versions/:v → raw file for one historical version.
filesRouter.get("/:domain/versions/:v", async (c) => {
  const version = Number.parseInt(c.req.param("v"), 10);
  if (!Number.isInteger(version) || version < 1) return c.json({ error: "invalid_version" }, 400);

  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParameter(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);

  const row = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, site.id), eq(fileVersions.version, version)))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const object = await c.env.FILES.get(row.r2Key);
  if (!object) return c.json({ error: "file_missing" }, 500);

  return new Response(object.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-llms-txt-version": String(row.version),
    },
  });
});

// GET /sites/:domain/diff?from=&to= → unified diff between two versions.
filesRouter.get("/:domain/diff", async (c) => {
  const from = Number.parseInt(c.req.query("from") ?? "", 10);
  const to = Number.parseInt(c.req.query("to") ?? "", 10);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
    return c.json({ error: "invalid_version_range" }, 400);
  }

  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParameter(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);

  return computeDiff(c, db, site, { from, to });
});

// ---------------------------------------------------------------------------
// Unified diff — small local LCS line-diff, no dependencies. Exported for
// unit tests; llms.txt files are small so O(n·m) DP is fine.
// ---------------------------------------------------------------------------

interface DiffOp {
  tag: " " | "-" | "+";
  line: string;
}

function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ tag: "-", line: a[i] });
      i++;
    } else {
      ops.push({ tag: "+", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "-", line: a[i++] });
  while (j < m) ops.push({ tag: "+", line: b[j++] });
  return ops;
}

/**
 * Formats a unified diff for two text bodies.
 *
 * @param fromText Original text content.
 * @param toText Updated text content.
 * @param labels File labels for the diff header.
 * @param context Number of unchanged context lines around changes.
 * @returns Unified diff text, or an empty string when unchanged.
 */
export function unifiedDiff(
  fromText: string,
  toText: string,
  labels: DiffLabels,
  context = 3,
): string {
  const a = splitLines(fromText);
  const b = splitLines(toText);
  const ops = diffLines(a, b);
  const positions = linePositions(ops);
  const changed = ops.flatMap((op, idx) => (op.tag === " " ? [] : [idx]));
  if (changed.length === 0) return "";

  const hunks = changedRanges(changed, context).flatMap((range) =>
    formatHunk(ops, positions, range, context),
  );

  return [`--- ${labels.from}`, `+++ ${labels.to}`, ...hunks].join("\n") + "\n";
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // ignore trailing newline
  return lines;
}

function linePositions(ops: DiffOp[]): { oldAt: number[]; newAt: number[] } {
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.tag !== "+") oldLine++;
    if (op.tag !== "-") newLine++;
  }
  return { oldAt, newAt };
}

function changedRanges(changed: number[], context: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const last = ranges.at(-1);
    if (last === undefined || index - last[1] > 2 * context) {
      ranges.push([index, index]);
    } else {
      last[1] = index;
    }
  }
  return ranges;
}

function formatHunk(
  ops: DiffOp[],
  positions: { oldAt: number[]; newAt: number[] },
  range: [number, number],
  context: number,
): string[] {
  const start = Math.max(0, range[0] - context);
  const end = Math.min(ops.length - 1, range[1] + context);
  const body = ops.slice(start, end + 1).map((op) => op.tag + op.line);
  const oldCount = ops.slice(start, end + 1).filter((op) => op.tag !== "+").length;
  const newCount = ops.slice(start, end + 1).filter((op) => op.tag !== "-").length;
  const oldStart = oldCount === 0 ? positions.oldAt[start] : positions.oldAt[start] + 1;
  const newStart = newCount === 0 ? positions.newAt[start] : positions.newAt[start] + 1;
  const header = `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(
    newCount,
  )} @@`;
  return [header, ...body];
}
