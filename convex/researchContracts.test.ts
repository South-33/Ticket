import { describe, expect, test } from "vitest";
import {
  buildDeterministicBranchAnalysis,
  promoteSourceEvidence,
  assessResearchQuality,
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
  });
});
