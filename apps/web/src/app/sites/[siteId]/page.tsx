import type { Metadata } from "next";
import { SiteScreen } from "@/components/site-screen";

interface SitePageProperties {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ run?: string }>;
}

// Per-site result pages render per-request app state — keep them out of search
// indexes (also disallowed in robots.txt).
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function SitePage({ params, searchParams }: SitePageProperties) {
  const { siteId } = await params;
  const { run } = await searchParams;
  return <SiteScreen siteId={siteId} runId={run} />;
}
