import { z } from "zod";
import {
  candidateCategories,
  candidateVerificationStatuses,
  qualityDecisions,
  qualityGapKeys,
  qualityTerminationReasons,
  type CandidateDraft,
  type QualityAssessment,
  type RankedResultDraft,
} from "./researchTypes";

export const plannerEvidenceFocusValues = [
  "price_total",
  "duration",
  "transfers",
  "baggage",
  "fare_rules",
  "freshness",
  "booking_path",
] as const;

export const plannerOutputSchema = z.object({
  strategy: z.string().min(12).max(400),
  primaryQuery: z.string().min(6).max(220),
  fallbackQuery: z.string().min(6).max(220).optional(),
  subqueries: z.array(z.string().min(6).max(220)).min(1).max(5),
  evidenceFocus: z.array(z.enum(plannerEvidenceFocusValues)).min(1).max(6),
  qualityGate: z.string().min(12).max(300),
});

export const rankingCategorySchema = z.enum(candidateCategories);

export const rankingOutputSchema = z.object({
  rankings: z.array(
    z.object({
      category: rankingCategorySchema,
      rank: z.number().int().min(1).max(5),
      score: z.number().int().min(1).max(100),
      rationale: z.string().min(12).max(280),
    }),
  ).min(1).max(3),
});

const branchFindingSchema = z.object({
  title: z.string().min(4).max(120),
  summary: z.string().min(12).max(320),
  sourceUrls: z.array(z.string().url()).max(4),
  confidence: z.number().min(0).max(1),
  evidenceSignals: z.array(z.string().min(2).max(64)).max(6).default([]),
});

export const branchAnalysisOutputSchema = z.object({
  findings: z.array(branchFindingSchema).max(6),
  qualitySummary: z.string().min(12).max(320),
  recommendedAction: z.enum(qualityDecisions),
  promotedSourceCount: z.number().int().min(0).max(20),
  unresolvedGaps: z.array(z.enum(qualityGapKeys)).max(4).default([]),
});

export const qualityAssessmentOutputSchema = z.object({
  decision: z.enum(qualityDecisions),
  terminationReason: z.enum(qualityTerminationReasons),
  score: z.number().min(0).max(1),
  round: z.number().int().min(1).max(10),
  gaps: z.array(z.enum(qualityGapKeys)).max(4),
  dimensions: z.object({
    completeness: z.number().min(0).max(1),
    depth: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    actionability: z.number().min(0).max(1),
  }),
  improvementFromPrevious: z.number().min(-1).max(1).optional(),
  clarificationKeys: z.array(z.string().min(1).max(40)).max(4),
  reason: z.string().min(12).max(360),
});

export const candidateDraftSchema = z.object({
  category: z.enum(candidateCategories),
  title: z.string().min(4).max(120),
  summary: z.string().min(12).max(320),
  confidence: z.number().min(0).max(1),
  verificationStatus: z.enum(candidateVerificationStatuses),
  estimatedTotalUsd: z.number().int().min(0).max(50000),
  travelMinutes: z.number().int().min(0).max(10000),
  transferCount: z.number().int().min(0).max(8),
  flexibilityScore: z.number().min(0).max(1),
  baggageScore: z.number().min(0).max(1),
  bookingEaseScore: z.number().min(0).max(1),
  freshnessScore: z.number().min(0).max(1),
  verifiedAt: z.number().int().positive().optional(),
  recheckAfter: z.number().int().min(0),
  primarySourceUrl: z.string().url().optional(),
  sourceUrls: z.array(z.string().url()).max(4),
});

export const rankedResultSchema = z.object({
  category: z.enum(candidateCategories),
  rank: z.number().int().min(1).max(5),
  score: z.number().int().min(1).max(100),
  title: z.string().min(4).max(120),
  rationale: z.string().min(12).max(400),
  verificationStatus: z.enum(candidateVerificationStatuses),
  verifiedAt: z.number().int().positive().optional(),
  recheckAfter: z.number().int().min(0),
  sourceUrls: z.array(z.string().url()).max(4),
});

export const synthesisOutputSchema = z.object({
  candidates: z.array(candidateDraftSchema).min(1).max(3),
  shortlistSummary: z.string().min(12).max(320),
  unresolvedGaps: z.array(z.string().min(2).max(80)).max(6).default([]),
});

export const verificationOutputSchema = z.object({
  candidates: z.array(candidateDraftSchema).min(1).max(3),
  rankedResults: z.array(rankedResultSchema).min(1).max(3),
  blockedCategories: z.array(z.enum(candidateCategories)).max(3),
  citationCoverage: z.number().min(0).max(1),
  verificationConfidence: z.number().min(0).max(1),
  summary: z.string().min(12).max(400),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type RankingOutput = z.infer<typeof rankingOutputSchema>;
export type BranchAnalysisOutput = z.infer<typeof branchAnalysisOutputSchema>;
export type QualityAssessmentOutput = z.infer<typeof qualityAssessmentOutputSchema>;
export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;
export type VerificationOutput = z.infer<typeof verificationOutputSchema>;

function validateCitationUrls(sourceUrls: string[], allowedSourceUrls: Set<string>, label: string) {
  for (const sourceUrl of sourceUrls) {
    if (allowedSourceUrls.size > 0 && !allowedSourceUrls.has(sourceUrl)) {
      throw new Error(`${label} references uncaptured source URL: ${sourceUrl}`);
    }
  }
}

export function validateBranchAnalysisOutput(output: unknown, allowedSourceUrls: Set<string>) {
  const parsed = branchAnalysisOutputSchema.parse(output);
  for (const finding of parsed.findings) {
    validateCitationUrls(finding.sourceUrls, allowedSourceUrls, `Branch finding \"${finding.title}\"`);
  }
  return parsed;
}

export function validateSynthesisOutput(output: unknown, allowedSourceUrls: Set<string>) {
  const parsed = synthesisOutputSchema.parse(output);
  const seen = new Set<string>();
  for (const candidate of parsed.candidates) {
    if (seen.has(candidate.category)) {
      throw new Error(`Synthesis output contains duplicate category: ${candidate.category}`);
    }
    seen.add(candidate.category);
    validateCitationUrls(candidate.sourceUrls, allowedSourceUrls, `Synthesis candidate \"${candidate.title}\"`);
    if (candidate.primarySourceUrl) {
      validateCitationUrls([candidate.primarySourceUrl], allowedSourceUrls, `Synthesis candidate \"${candidate.title}\"`);
    }
  }
  return parsed as { candidates: CandidateDraft[]; shortlistSummary: string; unresolvedGaps: string[] };
}

export function validateQualityAssessmentOutput(output: unknown) {
  return qualityAssessmentOutputSchema.parse(output) as QualityAssessment;
}

export function validateVerificationOutput(output: unknown, allowedSourceUrls: Set<string>) {
  const parsed = verificationOutputSchema.parse(output);
  for (const candidate of parsed.candidates) {
    validateCitationUrls(candidate.sourceUrls, allowedSourceUrls, `Verified candidate \"${candidate.title}\"`);
    if (candidate.primarySourceUrl) {
      validateCitationUrls([candidate.primarySourceUrl], allowedSourceUrls, `Verified candidate \"${candidate.title}\"`);
    }
  }
  for (const rankedResult of parsed.rankedResults) {
    validateCitationUrls(rankedResult.sourceUrls, allowedSourceUrls, `Verified ranked result \"${rankedResult.title}\"`);
  }
  return parsed as {
    candidates: CandidateDraft[];
    rankedResults: RankedResultDraft[];
    blockedCategories: CandidateDraft["category"][];
    citationCoverage: number;
    verificationConfidence: number;
    summary: string;
  };
}
