import { describe, expect, test } from "vitest";
import { verifyShortlist } from "./researchVerification";
import type { CandidateDraft, RankedResultDraft } from "./researchTypes";

function buildCandidate(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    category: "best_value",
    title: "Balanced option",
    summary: "Balanced option with decent timing and fare tradeoffs.",
    confidence: 0.7,
    verificationStatus: "partially_verified",
    estimatedTotalUsd: 540,
    travelMinutes: 720,
    transferCount: 1,
    flexibilityScore: 0.6,
    baggageScore: 0.55,
    bookingEaseScore: 0.6,
    freshnessScore: 0.7,
    verifiedAt: 123,
    recheckAfter: 456,
    primarySourceUrl: "https://example.com/a",
    sourceUrls: ["https://example.com/a", "https://example.com/b"],
    ...overrides,
  };
}

function buildRankedResult(overrides: Partial<RankedResultDraft> = {}): RankedResultDraft {
  return {
    category: "best_value",
    rank: 1,
    score: 81,
    title: "Balanced option",
    rationale: "This option balances price and travel burden well.",
    verificationStatus: "partially_verified",
    verifiedAt: 123,
    recheckAfter: 456,
    sourceUrls: ["https://example.com/a", "https://example.com/b"],
    ...overrides,
  };
}

describe("research verification", () => {
  test("downgrades candidates with uncaptured citations", () => {
    const result = verifyShortlist({
      candidates: [buildCandidate({ sourceUrls: ["https://example.com/missing"] })],
      rankedResults: [buildRankedResult({ sourceUrls: ["https://example.com/missing"] })],
      sources: [
        {
          url: "https://example.com/a",
          title: "Captured source",
          snippet: "Captured source with a fare mention.",
          provider: "tavily",
        },
      ],
      now: 1_000,
    });

    expect(result.blockedCategories).toEqual(["best_value"]);
    expect(result.candidates[0]?.verificationStatus).toBe("needs_live_check");
    expect(result.rankedResults[0]?.verificationStatus).toBe("needs_live_check");
    expect(result.summary).toContain("downgraded");
  });

  test("keeps multi-source candidates partially verified when freshness and support are good", () => {
    const result = verifyShortlist({
      candidates: [buildCandidate()],
      rankedResults: [buildRankedResult()],
      sources: [
        {
          url: "https://example.com/a",
          title: "Official airline fare",
          snippet: "Official fare listing from the carrier.",
          provider: "tavily",
        },
        {
          url: "https://example.com/b",
          title: "OTA comparison",
          snippet: "OTA comparison page with fare details.",
          provider: "tavily",
        },
      ],
      extractedByUrl: new Map([
        ["https://example.com/a", "Official airline fare with cabin and baggage details."],
        ["https://example.com/b", "Comparison page showing total fare and one stop."],
      ]),
      now: 2_000,
    });

    expect(result.blockedCategories).toEqual([]);
    expect(result.candidates[0]?.verificationStatus).toBe("partially_verified");
    expect(result.candidates[0]?.sourceUrls).toHaveLength(2);
    expect(result.citationCoverage).toBe(1);
    expect(result.summary).toContain("confirmed citation coverage");
  });
});
