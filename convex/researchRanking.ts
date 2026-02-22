type CandidateForRanking = {
  category: "cheapest" | "best_value" | "most_convenient";
  title: string;
  summary: string;
  confidence: number;
  verificationStatus: "needs_live_check" | "partially_verified" | "verified";
  sourceUrls: string[];
};

type RankedResultDraft = {
  category: "cheapest" | "best_value" | "most_convenient";
  rank: number;
  score: number;
  title: string;
  rationale: string;
  verificationStatus: "needs_live_check" | "partially_verified" | "verified";
  sourceUrls: string[];
};

function verificationBonus(status: CandidateForRanking["verificationStatus"]) {
  if (status === "verified") {
    return 12;
  }
  if (status === "partially_verified") {
    return 6;
  }
  return 0;
}

function categoryWeight(category: CandidateForRanking["category"]) {
  if (category === "best_value") {
    return 4;
  }
  if (category === "most_convenient") {
    return 2;
  }
  return 3;
}

export function buildRankedResultsFromCandidates(candidates: CandidateForRanking[]): RankedResultDraft[] {
  const ranked = candidates
    .map((candidate) => {
      const base = Math.round(candidate.confidence * 100);
      const score = Math.min(100, base + verificationBonus(candidate.verificationStatus) + categoryWeight(candidate.category));

      return {
        category: candidate.category,
        score,
        title: candidate.title,
        rationale:
          candidate.verificationStatus === "verified"
            ? "Rank is boosted by verified evidence quality and confidence."
            : "Rank is provisional and should be rechecked with live pricing before booking.",
        verificationStatus: candidate.verificationStatus,
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
