import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sites, fileVersions } from "@profound-takehome/db";
import type { Env } from "../bindings";
import { normalizeOrigin } from "../lib/url";

export const filesRouter = new Hono<{ Bindings: Env }>();

type SiteRow = typeof sites.$inferSelect;

// ---------------------------------------------------------------------------
// Shared version-history handlers — operate on an already-resolved site row.
// Each router resolves its site (by id or by domain) then delegates here so
// the listing/diff logic lives in exactly one place.
// ---------------------------------------------------------------------------

export async function listVersions(
  c: Context<{ Bindings: Env }>,
  db: ReturnType<typeof drizzle>,
  site: SiteRow
) {
  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version));
  return c.json({ versions });
}

export async function computeDiff(
  c: Context<{ Bindings: Env }>,
  db: ReturnType<typeof drizzle>,
  site: SiteRow,
  from: number,
  to: number
) {
  const rows = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, site.id), inArray(fileVersions.version, [from, to])));
  const fromRow = rows.find((r) => r.version === from);
  const toRow = rows.find((r) => r.version === to);
  if (!fromRow || !toRow) return c.json({ error: "version_not_found" }, 404);

  const [fromObj, toObj] = await Promise.all([
    c.env.FILES.get(fromRow.r2Key),
    c.env.FILES.get(toRow.r2Key)
  ]);
  if (!fromObj || !toObj) return c.json({ error: "file_missing" }, 500);

  const [fromText, toText] = await Promise.all([fromObj.text(), toObj.text()]);
  const diff = unifiedDiff(fromText, toText, `llms.txt v${from}`, `llms.txt v${to}`);
  return c.json({ from, to, diff });
}

export function domainCandidates(param: string): string[] {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
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

async function findSiteByDomainParam(
  db: ReturnType<typeof drizzle>,
  param: string
): Promise<SiteRow | undefined> {
  for (const candidate of domainCandidates(param)) {
    const site = await db.select().from(sites).where(eq(sites.domain, candidate)).get();
    if (site) return site;
  }
  return undefined;
}

// Public: GET /sites/:domain/llms.txt → latest file for a registered domain.
// The domain segment may be an encoded origin, e.g. https%3A%2F%2Fexample.com.
filesRouter.get("/:domain/llms.txt", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParam(db, c.req.param("domain"));
  if (!site) return c.text("not found", 404);

  const latest = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.siteId, site.id))
    .orderBy(desc(fileVersions.version))
    .limit(1)
    .get();
  if (!latest) return c.text("not generated yet", 404);

  const obj = await c.env.FILES.get(latest.r2Key);
  if (!obj) return c.text("file missing", 500);

  return new Response(obj.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-llms-txt-version": String(latest.version)
    }
  });
});

filesRouter.get("/:domain/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParam(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);
  return listVersions(c, db, site);
});

// GET /sites/:domain/versions/:v → raw file for one historical version.
filesRouter.get("/:domain/versions/:v", async (c) => {
  const version = Number.parseInt(c.req.param("v"), 10);
  if (!Number.isInteger(version) || version < 1) return c.json({ error: "invalid_version" }, 400);

  const db = drizzle(c.env.DB);
  const site = await findSiteByDomainParam(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);

  const row = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.siteId, site.id), eq(fileVersions.version, version)))
    .get();
  if (!row) return c.json({ error: "not_found" }, 404);

  const obj = await c.env.FILES.get(row.r2Key);
  if (!obj) return c.json({ error: "file_missing" }, 500);

  return new Response(obj.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-llms-txt-version": String(row.version)
    }
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
  const site = await findSiteByDomainParam(db, c.req.param("domain"));
  if (!site) return c.json({ error: "not_found" }, 404);

  return computeDiff(c, db, site, from, to);
});

// ---------------------------------------------------------------------------
// Unified diff — small local LCS line-diff, no dependencies. Exported for
// unit tests; llms.txt files are small so O(n·m) DP is fine.
// ---------------------------------------------------------------------------

type DiffOp = { tag: " " | "-" | "+"; line: string };

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

export function unifiedDiff(
  fromText: string,
  toText: string,
  fromLabel: string,
  toLabel: string,
  context = 3
): string {
  const a = splitLines(fromText);
  const b = splitLines(toText);
  const ops = diffLines(a, b);

  // Line numbers (0-based) each op starts at, in the old and new files.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 0;
  let nw = 0;
  for (const op of ops) {
    oldAt.push(o);
    newAt.push(nw);
    if (op.tag !== "+") o++;
    if (op.tag !== "-") nw++;
  }

  // Group changed op indices into hunks, merging when the equal gap ≤ 2·context.
  const changed = ops.flatMap((op, idx) => (op.tag === " " ? [] : [idx]));
  if (changed.length === 0) return "";

  const ranges: Array<[number, number]> = [];
  for (const idx of changed) {
    const last = ranges[ranges.length - 1];
    if (last && idx - last[1] <= 2 * context) last[1] = idx;
    else ranges.push([idx, idx]);
  }

  const hunks: string[] = [];
  for (const [s, e] of ranges) {
    const start = Math.max(0, s - context);
    const end = Math.min(ops.length - 1, e + context);
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = start; k <= end; k++) {
      const op = ops[k];
      if (op.tag !== "+") oldCount++;
      if (op.tag !== "-") newCount++;
      body.push(op.tag + op.line);
    }
    // Unified-diff convention: a zero-count side reports the line *before*.
    const oldStart = oldCount === 0 ? oldAt[start] : oldAt[start] + 1;
    const newStart = newCount === 0 ? newAt[start] : newAt[start] + 1;
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
  }

  return [`--- ${fromLabel}`, `+++ ${toLabel}`, ...hunks].join("\n") + "\n";
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // ignore trailing newline
  return lines;
}
