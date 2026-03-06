export const candidateCategories = ["cheapest", "best_value", "most_convenient"] as const;
export const candidateVerificationStatuses = ["needs_live_check", "partially_verified", "verified"] as const;
export const qualityGapKeys = ["citation_coverage", "numeric_evidence", "source_diversity", "confidence"] as const;

export type CandidateCategory = (typeof candidateCategories)[number];
export type CandidateVerificationStatus = (typeof candidateVerificationStatuses)[number];
export type QualityGapKey = (typeof qualityGapKeys)[number];

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
  decision: "finalize" | "continue";
  score: number;
  round: number;
  gaps: QualityGapKey[];
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
