import { politeFetch, readBodyText } from "./fetcher";

export interface RobotsRules {
  disallow: string[];
  crawlDelayMs: number;
  sitemaps: string[];
}

const OUR_AGENT = "llms-txt-generator";
const DEFAULT_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

interface RobotsGroup {
  disallow: string[];
  crawlDelayS?: number;
}

interface RobotsParseState {
  sitemaps: string[];
  groups: Partial<Record<string, RobotsGroup>>;
  currentAgents: string[];
  lastLineWasAgent: boolean;
}

const DEFAULT_RULES: RobotsRules = {
  disallow: [],
  crawlDelayMs: DEFAULT_DELAY_MS,
  sitemaps: [],
};

/**
 * Parse robots.txt directives relevant to this crawler.
 *
 * @param text - Raw robots.txt content.
 * @returns Rules for this crawler, falling back to wildcard directives.
 */
export function parseRobots(text: string): RobotsRules {
  const state: RobotsParseState = {
    sitemaps: [],
    groups: {},
    currentAgents: [],
    lastLineWasAgent: false,
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const directive = parseDirective(rawLine);
    if (directive === null) continue;
    applyRobotsDirective(state, directive);
  }

  const applicable = state.groups[OUR_AGENT] ?? state.groups["*"];
  const delaySeconds = applicable?.crawlDelayS;
  return {
    disallow: applicable?.disallow ?? [],
    crawlDelayMs:
      delaySeconds === undefined
        ? DEFAULT_DELAY_MS
        : Math.min(Math.max(delaySeconds * 1000, DEFAULT_DELAY_MS), MAX_DELAY_MS),
    sitemaps: state.sitemaps,
  };
}

function applyRobotsDirective(
  state: RobotsParseState,
  directive: { key: string; value: string },
): void {
  if (directive.key === "sitemap") {
    if (directive.value) state.sitemaps.push(directive.value);
    return;
  }

  if (directive.key === "user-agent") {
    recordUserAgent(state, directive.value);
    return;
  }

  state.lastLineWasAgent = false;
  applyDirective(state.groups, state.currentAgents, directive.key, directive.value);
}

function recordUserAgent(state: RobotsParseState, value: string): void {
  const agent = value.toLowerCase();
  // Consecutive User-agent lines form one group sharing the rules below.
  if (state.lastLineWasAgent) state.currentAgents.push(agent);
  else state.currentAgents = [agent];
  ensureGroup(state.groups, agent);
  state.lastLineWasAgent = true;
}

function parseDirective(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.replace(/#.*$/, "").trim();
  if (!line) return null;

  const separator = line.indexOf(":");
  if (separator === -1) return null;

  return {
    key: line.slice(0, separator).trim().toLowerCase(),
    value: line.slice(separator + 1).trim(),
  };
}

function ensureGroup(groups: Partial<Record<string, RobotsGroup>>, agent: string): RobotsGroup {
  groups[agent] ??= { disallow: [] };
  return groups[agent];
}

function applyDirective(
  groups: Partial<Record<string, RobotsGroup>>,
  agents: string[],
  key: string,
  value: string,
): void {
  for (const agent of agents) {
    const group = ensureGroup(groups, agent);
    if (key === "disallow" && value) group.disallow.push(value);
    else if (key === "crawl-delay") applyCrawlDelay(group, value);
  }
}

function applyCrawlDelay(group: RobotsGroup, value: string): void {
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelayS = seconds;
}

/**
 * Missing or malformed robots.txt → proceed politely with defaults.
 *
 * @param origin - Site origin whose robots.txt should be fetched.
 * @returns Parsed robots rules, or defaults when fetch/parsing fails.
 */
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
