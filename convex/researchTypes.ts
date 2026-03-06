export const candidateCategories = ["cheapest", "best_value", "most_convenient"] as const;
export const candidateVerificationStatuses = ["needs_live_check", "partially_verified", "verified"] as const;
export const qualityGapKeys = ["citation_coverage", "numeric_evidence", "source_diversity", "confidence"] as const;
export const qualityDecisions = ["finalize", "continue", "clarify"] as const;
export const qualityTerminationReasons = [
  "quality_met",
  "needs_user_input",
  "budget_limit",
  "diminishing_returns",
] as const;

export type CandidateCategory = (typeof candidateCategories)[number];
export type CandidateVerificationStatus = (typeof candidateVerificationStatuses)[number];
export type QualityGapKey = (typeof qualityGapKeys)[number];
export type QualityDecision = (typeof qualityDecisions)[number];
export type QualityTerminationReason = (typeof qualityTerminationReasons)[number];

export type SourceEvidence = {
  title: string;
  url: string;
  snippet?: string;
  extractedSummary?: string;
};

export type PromotedSourceEvidence = SourceEvidence & {
  signalScore: number;
  signalReasons: string[];
};

export type QualityAssessment = {
  decision: QualityDecision;
  terminationReason: QualityTerminationReason;
  score: number;
  round: number;
  gaps: QualityGapKey[];
  dimensions: {
    completeness: number;
    depth: number;
    reliability: number;
    actionability: number;
  };
  improvementFromPrevious?: number;
  clarificationKeys: string[];
  reason: string;
};

export type CandidateDraft = {
  category: CandidateCategory;
  title: string;
  summary: string;
  confidence: number;
  verificationStatus: CandidateVerificationStatus;
  estimatedTotalUsd: number;
  travelMinutes: number;
  transferCount: number;
  flexibilityScore: number;
  baggageScore: number;
  bookingEaseScore: number;
  freshnessScore: number;
  verifiedAt?: number;
  recheckAfter: number;
  primarySourceUrl?: string;
  sourceUrls: string[];
};

export type RankedResultDraft = {
  category: CandidateCategory;
  rank: number;
  score: number;
  title: string;
  rationale: string;
  verificationStatus: CandidateVerificationStatus;
  verifiedAt?: number;
  recheckAfter: number;
  sourceUrls: string[];
};
