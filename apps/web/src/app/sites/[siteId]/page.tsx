import { SiteScreen } from "@/components/site-screen";

interface SitePageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ run?: string }>;
}

export default async function SitePage({ params, searchParams }: SitePageProps) {
  const { siteId } = await params;
  const { run } = await searchParams;
  return <SiteScreen siteId={siteId} runId={run} />;
}
