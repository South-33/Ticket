import { expect, test } from "vitest";
import { deriveResearchRuntimeSignals } from "./researchRuntime";

test("deriveResearchRuntimeSignals marks llm and tavily modes without fallback", () => {
  const result = deriveResearchRuntimeSignals({
    findings: [
      { title: "Planner strategy generated" },
      { title: "LLM ranking applied" },
    ],
    sources: [{ provider: "tavily" }],
  });

  expect(result).toEqual({
    plannerMode: "llm",
    searchMode: "tavily",
    rankingMode: "llm",
    fallbackActive: false,
  });
});

test("deriveResearchRuntimeSignals marks fallback modes when findings or sources indicate degradation", () => {
  const result = deriveResearchRuntimeSignals({
    findings: [
      { title: "Planner fallback strategy used" },
      { title: "Ranking fallback used" },
      { title: "Tavily scan fallback used" },
    ],
    sources: [{ provider: "fallback" }],
  });

  expect(result).toEqual({
    plannerMode: "fallback",
    searchMode: "fallback",
    rankingMode: "fallback",
    fallbackActive: true,
  });
});

test("deriveResearchRuntimeSignals marks hybrid search when both source providers are present", () => {
  const result = deriveResearchRuntimeSignals({
    findings: [{ title: "Planner strategy generated" }],
    sources: [{ provider: "tavily" }, { provider: "fallback" }],
  });

  expect(result).toEqual({
    plannerMode: "llm",
    searchMode: "hybrid",
    rankingMode: "pending",
    fallbackActive: true,
  });
});
