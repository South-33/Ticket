import type { CandidateDraft, RankedResultDraft } from "./researchTypes";

type NumericBand = {
  min: number;
  max: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function inverseNormalized(value: number, band: NumericBand) {
  if (band.max <= band.min) {
    return 1;
  }
  const normalized = (value - band.min) / (band.max - band.min);
  return clamp01(1 - normalized);
}

function verificationBonus(status: CandidateDraft["verificationStatus"]) {
  if (status === "verified") {
    return 0.12;
  }
  if (status === "partially_verified") {
    return 0.06;
  }
  return 0;
}

function toBand(values: number[]): NumericBand {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max };
}

export function buildRankedResultsFromCandidates(candidates: CandidateDraft[]): RankedResultDraft[] {
  if (candidates.length === 0) {
    return [];
  }

  const priceBand = toBand(candidates.map((candidate) => candidate.estimatedTotalUsd));
  const durationBand = toBand(candidates.map((candidate) => candidate.travelMinutes));
  const transferBand = toBand(candidates.map((candidate) => candidate.transferCount));

  const ranked = candidates
    .map((candidate) => {
      const costScore = inverseNormalized(candidate.estimatedTotalUsd, priceBand);
      const durationScore = inverseNormalized(candidate.travelMinutes, durationBand);
      const transferScore = inverseNormalized(candidate.transferCount, transferBand);
      const convenienceScore =
        durationScore * 0.55 + transferScore * 0.25 + clamp01(candidate.bookingEaseScore) * 0.2;

      let weightedBase = 0;
      if (candidate.category === "cheapest") {
        weightedBase =
          costScore * 0.62 +
          convenienceScore * 0.16 +
          clamp01(candidate.flexibilityScore) * 0.08 +
          clamp01(candidate.baggageScore) * 0.06 +
          clamp01(candidate.freshnessScore) * 0.08;
      } else if (candidate.category === "best_value") {
        weightedBase =
          costScore * 0.34 +
          convenienceScore * 0.28 +
          clamp01(candidate.flexibilityScore) * 0.16 +
          clamp01(candidate.baggageScore) * 0.1 +
          clamp01(candidate.freshnessScore) * 0.12;
      } else {
        weightedBase =
          convenienceScore * 0.58 +
          costScore * 0.14 +
          clamp01(candidate.flexibilityScore) * 0.12 +
          clamp01(candidate.baggageScore) * 0.06 +
          clamp01(candidate.freshnessScore) * 0.1;
      }

      const confidenceLift = clamp01(candidate.confidence) * 0.12;
      const verificationLift = verificationBonus(candidate.verificationStatus);
      const finalScore = Math.round(clamp01(weightedBase + confidenceLift + verificationLift) * 100);

      const rationaleParts = [
        `price ${Math.round(costScore * 100)}`,
        `convenience ${Math.round(convenienceScore * 100)}`,
        `flexibility ${Math.round(clamp01(candidate.flexibilityScore) * 100)}`,
        `freshness ${Math.round(clamp01(candidate.freshnessScore) * 100)}`,
      ];
      const rationale =
        candidate.verificationStatus === "verified"
          ? `Weighted factors (${rationaleParts.join(", ")}) with fully verified evidence.`
          : `Weighted factors (${rationaleParts.join(", ")}) with provisional verification; live price recheck required.`;

      return {
        category: candidate.category,
        score: finalScore,
        title: candidate.title,
        rationale,
        verificationStatus: candidate.verificationStatus,
        verifiedAt: candidate.verifiedAt,
        recheckAfter: candidate.recheckAfter,
        sourceUrls: candidate.sourceUrls,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

  return ranked;
}
