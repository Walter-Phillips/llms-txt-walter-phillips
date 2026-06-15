import type { PageInventoryItem } from "@profound-takehome/shared";

type MockPageDefinition = Omit<PageInventoryItem, "url" | "status"> & {
  path: string;
  status?: string;
};

/**
 * Return the hostname portion of a normalized site origin.
 * @param origin Normalized site origin.
 * @returns Hostname for the origin.
 */
export function hostnameFromOrigin(origin: string): string {
  return new URL(origin).hostname;
}

/**
 * Build the display name used by the in-memory mock API.
 * @param origin Normalized site origin.
 * @returns Title-cased display name.
 */
export function titleCase(origin: string): string {
  const name = hostnameFromOrigin(origin)
    .replace(/^www\./, "")
    .split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Create deterministic mock llms.txt content for a generated site.
 * @param origin Normalized site origin.
 * @param version Generated file version.
 * @returns Mock llms.txt content.
 */
export function makeLlmsTxt(origin: string, version: number): string {
  const host = hostnameFromOrigin(origin);
  const name = titleCase(origin);
  const lines = [
    `# ${name}`,
    "",
    `> ${name} builds developer tooling. This file lists the canonical pages of ${host} for language models.`,
    "",
    `${name} publishes product pages, documentation, and a changelog. URLs below are stable and crawlable.`,
    "",
    "## Docs",
    "",
    `- [Quickstart](${origin}/docs/quickstart): Install, configure, and ship in five minutes`,
    `- [API reference](${origin}/docs/api): Complete endpoint and type reference`,
    version >= 2
      ? `- [Authentication](${origin}/docs/auth): Token issuance, scopes, and rotation`
      : null,
    `- [Self-hosting](${origin}/docs/self-hosting): Run the platform on your own infrastructure`,
    "",
    "## Product",
    "",
    `- [Pricing](${origin}/pricing): Plans, limits, and overage policy`,
    `- [Integrations](${origin}/integrations): First-party connectors and webhooks`,
    version >= 3 ? `- [Changelog](${origin}/changelog): Dated release notes, newest first` : null,
    "",
    "## Optional",
    "",
    `- [Blog](${origin}/blog): Engineering notes and release deep-dives`,
    `- [About](${origin}/about): Company, team, and contact details`,
  ].filter((line): line is string => line !== null);
  return lines.join("\n") + "\n";
}

function page(origin: string, definition: MockPageDefinition): PageInventoryItem {
  return {
    url: `${origin}${definition.path}`,
    title: definition.title,
    description: definition.description,
    sectionHint: definition.sectionHint,
    status: definition.status ?? "ok",
  };
}

/**
 * Create deterministic inventory rows for the mock result page.
 * @param origin Normalized site origin.
 * @returns Mock page inventory rows.
 */
export function makePages(origin: string): PageInventoryItem[] {
  const definitions: MockPageDefinition[] = [
    {
      path: "/",
      title: `${titleCase(origin)} - Home`,
      description: "Landing page",
      sectionHint: null,
    },
    {
      path: "/docs/quickstart",
      title: "Quickstart",
      description: "Install and ship in five minutes",
      sectionHint: "Docs",
    },
    {
      path: "/docs/api",
      title: "API reference",
      description: "Endpoints and types",
      sectionHint: "Docs",
    },
    {
      path: "/docs/auth",
      title: "Authentication",
      description: "Tokens, scopes, rotation",
      sectionHint: "Docs",
    },
    {
      path: "/docs/self-hosting",
      title: "Self-hosting",
      description: "Run on your own infra",
      sectionHint: "Docs",
    },
    { path: "/pricing", title: "Pricing", description: "Plans and limits", sectionHint: "Product" },
    {
      path: "/integrations",
      title: "Integrations",
      description: "Connectors and webhooks",
      sectionHint: "Product",
    },
    {
      path: "/changelog",
      title: "Changelog",
      description: "Release notes",
      sectionHint: "Product",
    },
    { path: "/blog", title: "Blog", description: "Engineering notes", sectionHint: "Optional" },
    { path: "/about", title: "About", description: "Company and contact", sectionHint: "Optional" },
    { path: "/admin", title: null, description: null, sectionHint: null, status: "skipped" },
    { path: "/search", title: "Search", description: null, sectionHint: null, status: "excluded" },
  ];
  return definitions.map((definition) => page(origin, definition));
}
