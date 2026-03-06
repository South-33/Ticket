import { z } from "zod";
import {
  candidateCategories,
  candidateVerificationStatuses,
  qualityGapKeys,
  type CandidateDraft,
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
  recommendedAction: z.enum(["finalize", "continue", "clarify"]),
  promotedSourceCount: z.number().int().min(0).max(20),
  unresolvedGaps: z.array(z.enum(qualityGapKeys)).max(4).default([]),
});

const synthesisCandidateSchema = z.object({
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

export const synthesisOutputSchema = z.object({
  candidates: z.array(synthesisCandidateSchema).min(1).max(3),
  shortlistSummary: z.string().min(12).max(320),
  unresolvedGaps: z.array(z.string().min(2).max(80)).max(6).default([]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type RankingOutput = z.infer<typeof rankingOutputSchema>;
export type BranchAnalysisOutput = z.infer<typeof branchAnalysisOutputSchema>;
export type SynthesisOutput = z.infer<typeof synthesisOutputSchema>;

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
