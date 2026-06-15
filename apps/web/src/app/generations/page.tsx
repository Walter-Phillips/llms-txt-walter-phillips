import type { Metadata } from "next";
import type { ReactElement } from "react";
import { GenerationBrowser } from "@/components/generation-browser";

export const metadata: Metadata = {
  title: "Generations",
  description: "Find previously generated llms.txt files without starting a new crawl.",
  alternates: {
    canonical: "/generations",
  },
};

export default function GenerationsPage(): ReactElement {
  return <GenerationBrowser />;
}
