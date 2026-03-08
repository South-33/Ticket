export type ResearchPlannerMode = "pending" | "llm" | "fallback";
export type ResearchSearchMode = "pending" | "tavily" | "fallback" | "hybrid";
export type ResearchRankingMode = "pending" | "llm" | "fallback";

export type ResearchRuntimeSignals = {
  plannerMode: ResearchPlannerMode;
  searchMode: ResearchSearchMode;
  rankingMode: ResearchRankingMode;
  fallbackActive: boolean;
};

type RuntimeSignalInput = {
  findings: Array<{ title: string }>;
  sources: Array<{ provider: string }>;
};

export function deriveResearchRuntimeSignals(args: RuntimeSignalInput): ResearchRuntimeSignals {
  const findingTitles = new Set(args.findings.map((finding) => finding.title));
  const sourceProviders = new Set(args.sources.map((source) => source.provider));

  const plannerMode: ResearchPlannerMode = findingTitles.has("Planner fallback strategy used")
    ? "fallback"
    : findingTitles.has("Planner strategy generated")
      ? "llm"
      : "pending";

  const rankingMode: ResearchRankingMode = findingTitles.has("Ranking fallback used")
    ? "fallback"
    : findingTitles.has("LLM ranking applied")
      ? "llm"
      : "pending";

  let searchMode: ResearchSearchMode = "pending";
  if (sourceProviders.has("tavily") && sourceProviders.has("fallback")) {
    searchMode = "hybrid";
  } else if (sourceProviders.has("tavily")) {
    searchMode = "tavily";
  } else if (sourceProviders.has("fallback") || findingTitles.has("Tavily scan fallback used")) {
    searchMode = "fallback";
  }

  const fallbackActive =
    plannerMode === "fallback" ||
    rankingMode === "fallback" ||
    searchMode === "fallback" ||
    searchMode === "hybrid";

  return {
    plannerMode,
    searchMode,
    rankingMode,
    fallbackActive,
  };
}
