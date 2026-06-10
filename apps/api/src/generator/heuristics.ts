export type {
  InventoryPage,
  SectionInventory,
  Inventory,
} from "@profound-takehome/shared";

const RULES: Array<{ rx: RegExp; section: string; optional?: boolean }> = [
  { rx: /^\/(docs|documentation|guide|guides|api|reference)/i, section: "Documentation" },
  { rx: /^\/(blog|news|articles|posts)/i, section: "Blog" },
  { rx: /^\/\d{4}\/\d{2}\//, section: "Blog" },
  { rx: /^\/(pricing|plans|products|features)/i, section: "Products" },
  { rx: /^\/(about|team|contact|company)/i, section: "About" },
  { rx: /^\/(legal|privacy|terms|careers|jobs)/i, section: "Optional", optional: true },
];

// Pass 1: deterministic classify. Pass 2 (LLM) renames/reorders sections.
export function classify(path: string): { section: string; optional: boolean } {
  for (const r of RULES) {
    if (r.rx.test(path)) return { section: r.section, optional: !!r.optional };
  }
  return { section: "Core Pages", optional: false };
}
