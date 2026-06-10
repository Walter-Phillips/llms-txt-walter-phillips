import { politeFetch, readBodyText } from "./fetcher";

export type RobotsRules = {
  disallow: string[];
  crawlDelayMs: number;
  sitemaps: string[];
};

const OUR_AGENT = "llms-txt-generator";
const DEFAULT_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

export const DEFAULT_RULES: RobotsRules = {
  disallow: [],
  crawlDelayMs: DEFAULT_DELAY_MS,
  sitemaps: [],
};

export function parseRobots(text: string): RobotsRules {
  const sitemaps: string[] = [];
  const groups: Record<string, { disallow: string[]; crawlDelayS?: number }> = {};
  let currentAgents: string[] = [];
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      // Consecutive User-agent lines form one group sharing the rules below.
      if (lastLineWasAgent) currentAgents.push(agent);
      else currentAgents = [agent];
      groups[agent] ??= { disallow: [] };
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    for (const agent of currentAgents) {
      const group = groups[agent]!;
      if (key === "disallow" && value) group.disallow.push(value);
      else if (key === "crawl-delay") {
        const s = Number.parseFloat(value);
        if (Number.isFinite(s) && s >= 0) group.crawlDelayS = s;
      }
    }
  }

  const applicable = groups[OUR_AGENT] ?? groups["*"];
  const delayS = applicable?.crawlDelayS;
  return {
    disallow: applicable?.disallow ?? [],
    crawlDelayMs:
      delayS === undefined
        ? DEFAULT_DELAY_MS
        : Math.min(Math.max(delayS * 1000, DEFAULT_DELAY_MS), MAX_DELAY_MS),
    sitemaps,
  };
}

/** Missing or malformed robots.txt → proceed politely with defaults. */
export async function fetchRobots(origin: string): Promise<RobotsRules> {
  try {
    const res = await politeFetch(`${origin}/robots.txt`);
    if (res.status !== 200 || !res.body) return DEFAULT_RULES;
    const text = await readBodyText(res.body, 512 * 1024);
    return parseRobots(text);
  } catch {
    return DEFAULT_RULES;
  }
}
