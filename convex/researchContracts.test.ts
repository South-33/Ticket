import { describe, expect, test } from "vitest";
import {
  assessResearchQuality,
  buildSearchQuery,
  buildDeterministicBranchAnalysis,
  promoteSourceEvidence,
} from "./researchEvidence";
import { validateBranchAnalysisOutput, validateSynthesisOutput } from "./researchContracts";
import { buildDeterministicSynthesisOutput } from "./researchSynthesis";

describe("research contracts", () => {
  test("validateBranchAnalysisOutput rejects uncaptured citations", () => {
    expect(() =>
      validateBranchAnalysisOutput(
        {
          findings: [
            {
              title: "Source",
              summary: "This finding points to a URL that was never captured by the run.",
              sourceUrls: ["https://example.com/missing"],
              confidence: 0.5,
              evidenceSignals: ["price_signal"],
            },
          ],
          qualitySummary: "Quality was acceptable but the citations were invalid.",
          recommendedAction: "finalize",
          promotedSourceCount: 1,
          unresolvedGaps: [],
        },
        new Set(["https://example.com/allowed"]),
      ),
    ).toThrow(/uncaptured source URL/i);
  });

  test("buildDeterministicBranchAnalysis keeps findings citation bound", () => {
    const promotedSources = promoteSourceEvidence([
      {
        title: "Official fare page",
        url: "https://example.com/fare",
        snippet: "Fare from $540 direct 12h 30m baggage included.",
        extractedSummary: "Official fare from $540 direct 12h 30m baggage included.",
      },
    ]);
    const quality = assessResearchQuality({
      promotedSources,
      totalSourceCount: 1,
      round: 1,
    });

    const analysis = buildDeterministicBranchAnalysis({ promotedSources, quality });

    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0]?.sourceUrls).toEqual(["https://example.com/fare"]);
  });

  test("validateSynthesisOutput rejects duplicate categories", () => {
    expect(() =>
      validateSynthesisOutput(
        {
          candidates: [
            {
              category: "cheapest",
              title: "Alpha",
              summary: "Candidate A uses the same category twice and should fail validation.",
              confidence: 0.5,
              verificationStatus: "needs_live_check",
              estimatedTotalUsd: 500,
              travelMinutes: 700,
              transferCount: 1,
              flexibilityScore: 0.5,
              baggageScore: 0.5,
              bookingEaseScore: 0.5,
              freshnessScore: 0.5,
              recheckAfter: Date.now(),
              sourceUrls: ["https://example.com/a"],
            },
            {
              category: "cheapest",
              title: "Bravo",
              summary: "Candidate B repeats the category and should trigger a duplicate error.",
              confidence: 0.5,
              verificationStatus: "needs_live_check",
              estimatedTotalUsd: 520,
              travelMinutes: 710,
              transferCount: 1,
              flexibilityScore: 0.5,
              baggageScore: 0.5,
              bookingEaseScore: 0.5,
              freshnessScore: 0.5,
              recheckAfter: Date.now(),
              sourceUrls: ["https://example.com/b"],
            },
          ],
          shortlistSummary: "A duplicate category should never pass the synthesis contract.",
          unresolvedGaps: [],
        },
        new Set(["https://example.com/a", "https://example.com/b"]),
      ),
    ).toThrow(/duplicate category/i);
  });

  test("buildDeterministicSynthesisOutput returns normalized candidate set", () => {
    const output = buildDeterministicSynthesisOutput({
      goal: {
        prompt: "Find me a flight from Manila to Frankfurt on 2026-08-11 budget 900",
        domain: "flight",
        constraintSummary: "origin: Manila | destination: Frankfurt | departureDate: 2026-08-11 | budget: 900",
        slotMap: {
          returnDate: "2026-08-19",
          passengerCount: "2",
        },
      },
      sources: [
        {
          title: "Official option",
          url: "https://example.com/official",
          snippet: "Fare from $610 direct 12h 40m baggage included.",
          extractedSummary: "Official option from $610 direct 12h 40m baggage included and flexible fares available.",
        },
        {
          title: "OTA option",
          url: "https://example.com/ota",
          snippet: "Fare from $560 one stop 14h 10m.",
        },
      ],
      unresolvedGaps: ["citation_coverage"],
    });

    expect(output.candidates).toHaveLength(3);
    expect(output.unresolvedGaps).toEqual(["citation_coverage"]);
    expect(output.candidates.map((candidate) => candidate.category)).toEqual([
      "cheapest",
      "best_value",
      "most_convenient",
    ]);
    expect(output.candidates[0]?.summary).toContain("Round-trip context includes return 2026-08-19.");
    expect(output.candidates[0]?.summary).toContain("Traveler count: 2.");
  });

  test("buildSearchQuery appends structured flight constraint terms", () => {
    const query = buildSearchQuery("Find me fares from Manila to Frankfurt", "flight", {
      returnDate: "2026-08-19",
      passengerCount: "2",
      cabinClass: "business",
      nonstopOnly: "true",
      bags: "checked",
      flexibilityLevel: "flexible",
    });

    expect(query).toContain("round trip");
    expect(query).toContain("return 2026-08-19");
    expect(query).toContain("2 passengers");
    expect(query).toContain("business class");
    expect(query).toContain("nonstop");
    expect(query).toContain("checked bag");
    expect(query).toContain("flexible dates");
  });

  test("buildDeterministicSynthesisOutput adds soft caveats for nonstop and checked bags", () => {
    const output = buildDeterministicSynthesisOutput({
      goal: {
        prompt: "Find me a flight from Manila to Frankfurt on 2026-08-11 budget 900",
        domain: "flight",
        constraintSummary: "origin: Manila | destination: Frankfurt | departureDate: 2026-08-11 | budget: 900",
        slotMap: {
          nonstopOnly: "true",
          bags: "checked",
          cabinClass: "business",
        },
      },
      sources: [
        {
          title: "OTA option",
          url: "https://example.com/ota",
          snippet: "Fare from $560 one stop 14h 10m.",
        },
      ],
    });

    const cheapest = output.candidates.find((candidate) => candidate.category === "cheapest");
    expect(cheapest?.summary).toContain("nonstop-only preference");
    expect(cheapest?.summary).toContain("Checked-bag coverage remains weak");
    expect(cheapest?.summary).toContain("Cabin alignment for business");
  });

  test("assessResearchQuality requests clarification when quality stalls on flight pricing", () => {
    const promotedSources = promoteSourceEvidence([
      {
        title: "OTA fare",
        url: "https://example.com/ota",
        snippet: "Flight deal with one stop and baggage details pending.",
      },
      {
        title: "Blog mention",
        url: "https://example.com/blog",
        snippet: "General route ideas but no exact prices yet.",
      },
    ]);

    const roundOne = assessResearchQuality({
      promotedSources,
      totalSourceCount: 4,
      round: 1,
      domain: "flight",
      canClarifyFlexibility: true,
    });
    const roundTwo = assessResearchQuality({
      promotedSources,
      totalSourceCount: 4,
      round: 2,
      previousQuality: roundOne,
      domain: "flight",
      canClarifyFlexibility: true,
    });

    expect(roundTwo.decision).toBe("clarify");
    expect(roundTwo.terminationReason).toBe("needs_user_input");
    expect(roundTwo.clarificationKeys).toEqual(["flexibilityLevel"]);
  });

  test("assessResearchQuality finalizes on diminishing returns", () => {
    const promotedSources = promoteSourceEvidence([
      {
        title: "Carrier page",
        url: "https://example.com/carrier",
        snippet: "Official route page with general schedule info.",
        extractedSummary: "Official route page with general schedule info and no exact fare numbers.",
      },
    ]);

    const result = assessResearchQuality({
      promotedSources,
      totalSourceCount: 3,
      round: 2,
      previousQuality: {
        decision: "continue",
        terminationReason: "budget_limit",
        score: 0.48,
        round: 1,
        gaps: ["numeric_evidence"],
        dimensions: {
          completeness: 0.48,
          depth: 0.3,
          reliability: 0.55,
          actionability: 0.35,
        },
        improvementFromPrevious: undefined,
        clarificationKeys: [],
        reason: "Round one baseline.",
      },
      domain: "flight",
      canClarifyFlexibility: false,
    });

    expect(result.decision).toBe("finalize");
    expect(result.terminationReason).toBe("diminishing_returns");
  });
});
