import {
  validateBranchAnalysisOutput,
  validateQualityAssessmentOutput,
  type BranchAnalysisOutput,
} from "./researchContracts";
import type {
  PromotedSourceEvidence,
  QualityAssessment,
  QualityGapKey,
  SourceEvidence,
} from "./researchTypes";

const MAX_RESEARCH_SCAN_ROUNDS = 2;
export const MAX_PROMOTED_CONTEXT_SOURCES = 4;
export const QUALITY_CONTINUE_THRESHOLD = 0.66;

export function summarizeExtractedContent(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.slice(0, 260);
}

export function buildSearchQuery(prompt: string, domain: string) {
  const base = prompt.trim();
  if (!base) {
    return "best travel deals";
  }

  if (domain === "flight") {
    return `${base} flight deals promos booking`;
  }
  if (domain === "concert") {
    return `${base} concert tickets presale resale deals`;
  }
  if (domain === "train") {
    return `${base} train tickets passes discounts`;
  }

  return `${base} deals offers`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function collectUsdPrices(text: string) {
  const values: number[] = [];
  const patterns = [
    /\$\s?(\d{2,5}(?:[.,]\d{1,2})?)/gi,
    /\b(?:usd|us\$)\s?(\d{2,5}(?:[.,]\d{1,2})?)/gi,
    /\bfrom\s+\$?(\d{2,5}(?:[.,]\d{1,2})?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = parseNumber(match[1] ?? "");
      if (!parsed) {
        continue;
      }
      if (parsed < 20 || parsed > 15000) {
        continue;
      }
      values.push(Math.round(parsed));
    }
  }

  return values;
}

export function collectDurationMinutes(text: string) {
  const values: number[] = [];

  for (const match of text.matchAll(/(\d{1,2})\s*h(?:ours?)?\s*(\d{1,2})?\s*m?/gi)) {
    const hours = parseNumber(match[1] ?? "0") ?? 0;
    const minutes = parseNumber(match[2] ?? "0") ?? 0;
    const total = hours * 60 + minutes;
    if (total >= 30 && total <= 3000) {
      values.push(total);
    }
  }

  for (const match of text.matchAll(/(\d{2,4})\s*(?:min|mins|minutes)\b/gi)) {
    const minutes = parseNumber(match[1] ?? "");
    if (!minutes) {
      continue;
    }
    if (minutes >= 30 && minutes <= 3000) {
      values.push(minutes);
    }
  }

  return values;
}

export function collectTransferCounts(text: string) {
  const values: number[] = [];

  if (/\b(?:non[-\s]?stop|direct(?:\s+flight)?|no\s+transfers?)\b/i.test(text)) {
    values.push(0);
  }

  for (const match of text.matchAll(/(\d)\s*(?:stop|stops|transfer|transfers|layover|layovers)\b/gi)) {
    const parsed = parseNumber(match[1] ?? "");
    if (parsed === undefined) {
      continue;
    }
    values.push(clamp(Math.round(parsed), 0, 4));
  }

  if (/\bone[-\s]?stop\b/i.test(text)) {
    values.push(1);
  }
  if (/\btwo[-\s]?stops\b/i.test(text)) {
    values.push(2);
  }

  return values;
}

function sourceTextForSignals(source: SourceEvidence) {
  return `${source.title} ${source.snippet ?? ""} ${source.extractedSummary ?? ""}`.replace(/\s+/g, " ").trim();
}

function scoreSourceSignal(source: SourceEvidence): PromotedSourceEvidence {
  const text = sourceTextForSignals(source);
  const hasExtractedSummary = !!source.extractedSummary;
  const hasSnippet = !!source.snippet;
  const priceSignals = collectUsdPrices(text);
  const durationSignals = collectDurationMinutes(text);
  const transferSignals = collectTransferCounts(text);
  const signalReasons: string[] = [];

  let signalScore = 0.16;

  if (hasExtractedSummary) {
    signalScore += 0.28;
    signalReasons.push("extracted_content");
  }
  if (hasSnippet) {
    signalScore += 0.12;
    signalReasons.push("snippet");
  }
  if (priceSignals.length > 0) {
    signalScore += 0.26;
    signalReasons.push("price_signal");
  }
  if (durationSignals.length > 0) {
    signalScore += 0.12;
    signalReasons.push("duration_signal");
  }
  if (transferSignals.length > 0) {
    signalScore += 0.08;
    signalReasons.push("transfer_signal");
  }

  if (/official|airline|railway|ticketmaster|carrier|booking/i.test(text)) {
    signalScore += 0.08;
    signalReasons.push("official_context");
  }

  return {
    ...source,
    signalScore: clamp(signalScore, 0, 1),
    signalReasons,
  };
}

export function promoteSourceEvidence(sources: SourceEvidence[]): PromotedSourceEvidence[] {
  const scored = sources.map(scoreSourceSignal);
  scored.sort((a, b) => {
    if (b.signalScore !== a.signalScore) {
      return b.signalScore - a.signalScore;
    }
    return a.url.localeCompare(b.url);
  });
  return scored.slice(0, MAX_PROMOTED_CONTEXT_SOURCES);
}

export function assessResearchQuality(args: {
  promotedSources: PromotedSourceEvidence[];
  totalSourceCount: number;
  round: number;
  previousQuality?: QualityAssessment;
  domain?: string;
  canClarifyFlexibility?: boolean;
}): QualityAssessment {
  const promoted = args.promotedSources;
  const promotedText = promoted.map((source) => sourceTextForSignals(source)).join("\n");
  const numericSignals =
    collectUsdPrices(promotedText).length
    + collectDurationMinutes(promotedText).length
    + collectTransferCounts(promotedText).length;
  const citationCoverage = args.totalSourceCount > 0 ? promoted.length / args.totalSourceCount : 0;
  const sourceDiversity = promoted.length / MAX_PROMOTED_CONTEXT_SOURCES;
  const confidence =
    promoted.length > 0
      ? promoted.reduce((sum, source) => sum + source.signalScore, 0) / promoted.length
      : 0;
  const officialCoverage = promoted.length > 0
    ? promoted.filter((source) => source.signalReasons.includes("official_context")).length / promoted.length
    : 0;
  const extractCoverage = promoted.length > 0
    ? promoted.filter((source) => source.signalReasons.includes("extracted_content")).length / promoted.length
    : 0;

  const completeness = clamp(citationCoverage * 0.7 + sourceDiversity * 0.3, 0, 1);
  const depth = clamp(Math.min(1, numericSignals / 6) * 0.75 + extractCoverage * 0.25, 0, 1);
  const reliability = clamp(confidence * 0.75 + officialCoverage * 0.25, 0, 1);
  const actionability = clamp(Math.min(1, numericSignals / 5) * 0.55 + officialCoverage * 0.25 + extractCoverage * 0.2, 0, 1);

  const gaps: QualityGapKey[] = [];
  if (citationCoverage < 0.45) {
    gaps.push("citation_coverage");
  }
  if (numericSignals < 2) {
    gaps.push("numeric_evidence");
  }
  if (sourceDiversity < 0.5) {
    gaps.push("source_diversity");
  }
  if (confidence < 0.58) {
    gaps.push("confidence");
  }

  const score = clamp(
    completeness * 0.28
      + depth * 0.27
      + reliability * 0.25
      + actionability * 0.2,
    0,
    1,
  );

  const continueAllowed = args.round < MAX_RESEARCH_SCAN_ROUNDS;
  const improvementFromPrevious = args.previousQuality
    ? Number((score - args.previousQuality.score).toFixed(3))
    : undefined;
  const diminishingReturns = improvementFromPrevious !== undefined && improvementFromPrevious < 0.08;
  const clarificationKeys: string[] = [];
  const shouldClarifyFlexibility =
    args.domain === "flight"
    && args.canClarifyFlexibility === true
    && args.round >= 2
    && gaps.includes("numeric_evidence");
  if (shouldClarifyFlexibility) {
    clarificationKeys.push("flexibilityLevel");
  }

  let decision: QualityAssessment["decision"] = "finalize";
  let terminationReason: QualityAssessment["terminationReason"] = "quality_met";

  if (clarificationKeys.length > 0) {
    decision = "clarify";
    terminationReason = "needs_user_input";
  } else if (score < QUALITY_CONTINUE_THRESHOLD && diminishingReturns) {
    decision = "finalize";
    terminationReason = "diminishing_returns";
  } else if (score < QUALITY_CONTINUE_THRESHOLD && continueAllowed && !diminishingReturns) {
    decision = "continue";
    terminationReason = "budget_limit";
  } else if (score < QUALITY_CONTINUE_THRESHOLD && !continueAllowed) {
    decision = "finalize";
    terminationReason = "budget_limit";
  }

  let reason = `Quality score ${(score * 100).toFixed(0)} meets threshold with ${gaps.length === 0 ? "no critical gaps" : `remaining gaps: ${gaps.join(", ")}`}.`;
  if (decision === "continue") {
    reason = `Quality score ${(score * 100).toFixed(0)} is below threshold ${(QUALITY_CONTINUE_THRESHOLD * 100).toFixed(0)}; continue targeted search for: ${gaps.join(", ") || "coverage"}.`;
  } else if (decision === "clarify") {
    reason = `Quality score ${(score * 100).toFixed(0)} is still weak after the current scan budget; ask the user for ${clarificationKeys.join(", ")} before another search pass.`;
  } else if (terminationReason === "diminishing_returns") {
    reason = `Quality only improved by ${Math.round((improvementFromPrevious ?? 0) * 100)} points, so another broad scan is unlikely to help.`;
  } else if (terminationReason === "budget_limit") {
    reason = `Quality score ${(score * 100).toFixed(0)} stayed below threshold, but the current continuation budget is exhausted.`;
  }

  return validateQualityAssessmentOutput({
    decision,
    terminationReason,
    score,
    round: args.round,
    gaps,
    dimensions: {
      completeness,
      depth,
      reliability,
      actionability,
    },
    improvementFromPrevious,
    clarificationKeys,
    reason,
  });
}

export function buildFollowupSearchQuery(baseQuery: string, quality: QualityAssessment) {
  const gapHints: string[] = [];
  if (quality.gaps.includes("numeric_evidence")) {
    gapHints.push("price duration layover");
  }
  if (quality.gaps.includes("citation_coverage") || quality.gaps.includes("source_diversity")) {
    gapHints.push("official booking fare rules");
  }
  if (quality.gaps.includes("confidence")) {
    gapHints.push("latest verified update");
  }

  if (gapHints.length === 0) {
    return `${baseQuery} fare rules official booking`;
  }

  return `${baseQuery} ${gapHints.join(" ")}`;
}

export function buildDeterministicBranchAnalysis(args: {
  promotedSources: PromotedSourceEvidence[];
  quality: QualityAssessment;
}): BranchAnalysisOutput {
  const findings = args.promotedSources.slice(0, 3).map((source) => ({
    title: source.title.slice(0, 120),
    summary: source.extractedSummary
      ?? source.snippet
      ?? "Captured a potentially relevant lead, but a deeper extraction pass is still needed.",
    sourceUrls: [source.url],
    confidence: clamp(source.signalScore, 0.25, 0.92),
    evidenceSignals: source.signalReasons.slice(0, 4),
  }));

  return validateBranchAnalysisOutput(
    {
      findings,
      qualitySummary: args.quality.reason,
      recommendedAction: args.quality.decision,
      promotedSourceCount: args.promotedSources.length,
      unresolvedGaps: args.quality.gaps,
    },
    new Set(args.promotedSources.map((source) => source.url)),
  );
}
