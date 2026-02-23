import { ConvexError, v } from "convex/values";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import {
  extractWithTavily,
  searchWebWithTavily,
  type SearchLead,
} from "./researchProvider";
import {
  buildFollowUpQuestion,
  detectDomain,
  detectMode,
  extractSlotsFromPrompt,
  mergeSlots,
  missingSlots,
  requiredSlotsForDomain,
  summarizeConstraints,
  type ResearchDomain,
} from "./researchIntake";
import { buildRankedResultsFromCandidates } from "./researchRanking";
import { getAuthUserIdOrThrow } from "./auth";

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const MAX_PAGE_SIZE = 50;
const MAX_JOB_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [30_000, 120_000, 300_000] as const;
const JOB_LEASE_DURATION_MS = 9 * 60 * 1000;
const MAX_RESEARCH_SCAN_ROUNDS = 2;
const MAX_PROMOTED_CONTEXT_SOURCES = 4;
const QUALITY_CONTINUE_THRESHOLD = 0.66;
const MAX_PLANNER_REPAIR_ATTEMPTS = 2;

const plannerEvidenceFocusValues = [
  "price_total",
  "duration",
  "transfers",
  "baggage",
  "fare_rules",
  "freshness",
  "booking_path",
] as const;

const plannerOutputSchema = z.object({
  strategy: z.string().min(12).max(400),
  primaryQuery: z.string().min(6).max(220),
  fallbackQuery: z.string().min(6).max(220).optional(),
  subqueries: z.array(z.string().min(6).max(220)).min(1).max(5),
  evidenceFocus: z.array(z.enum(plannerEvidenceFocusValues)).min(1).max(6),
  qualityGate: z.string().min(12).max(300),
});

type ResearchJobStatus =
  | "draft"
  | "awaiting_input"
  | "planned"
  | "running"
  | "synthesizing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type CandidateCategory = "cheapest" | "best_value" | "most_convenient";

type CandidateDraft = {
  category: CandidateCategory;
  title: string;
  summary: string;
  confidence: number;
  verificationStatus: "needs_live_check" | "partially_verified" | "verified";
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

type PlannerOutput = z.infer<typeof plannerOutputSchema>;

type PlannerPlanResult = {
  plan: PlannerOutput;
  mode: "llm" | "fallback";
  validationErrors: string[];
};

type ResearchStartResult = {
  researchJobId: Id<"researchJobs">;
  projectGoalId: Id<"projectGoals">;
  jobStatus: "awaiting_input" | "planned";
  missingFields: string[];
  followUpQuestion?: string;
};

type ResearchErrorCode =
  | "provider_key_missing"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "task_missing"
  | "goal_missing"
  | "unknown_error";

const SENSITIVE_SLOT_KEYS = new Set(["nationality", "ageBand"]);
const VERIFICATION_WINDOW_MS = {
  verified: 6 * 60 * 60 * 1000,
  partially_verified: 2 * 60 * 60 * 1000,
  needs_live_check: 0,
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPageSize(numItems: number) {
  if (numItems < 1 || numItems > MAX_PAGE_SIZE) {
    throw new ConvexError(`paginationOpts.numItems must be between 1 and ${MAX_PAGE_SIZE}`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyResearchError(error: unknown): { code: ResearchErrorCode; retryable: boolean } {
  const message = errorMessage(error);

  if (/TAVILY_API_KEY is not configured/i.test(message)) {
    return { code: "provider_key_missing", retryable: false };
  }
  if (/429|rate limit/i.test(message)) {
    return { code: "provider_rate_limited", retryable: true };
  }
  if (/tavily.*failed:\s*5\d\d|fetch failed|network|timeout/i.test(message)) {
    return { code: "provider_unavailable", retryable: true };
  }
  if (/Research task not found/i.test(message)) {
    return { code: "task_missing", retryable: false };
  }
  if (/Project goal not found/i.test(message)) {
    return { code: "goal_missing", retryable: false };
  }

  return { code: "unknown_error", retryable: true };
}

function computeRetryDelayMs(attempt: number) {
  const idx = Math.max(0, Math.min(RETRY_BACKOFF_MS.length - 1, attempt - 1));
  return RETRY_BACKOFF_MS[idx];
}

function createLeaseToken() {
  return `lease_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type PatchJobArgs = {
  researchJobId: Id<"researchJobs">;
  status?: ResearchJobStatus;
  stage?: string;
  progress?: number;
  error?: string | null;
  lastErrorCode?: string | null;
  nextRunAt?: number | null;
  attemptDelta?: number;
  startedNow?: boolean;
  completedNow?: boolean;
};

function shouldRecordStageEvent(args: {
  status?: ResearchJobStatus;
  stage?: string;
  error?: string | null;
  lastErrorCode?: string | null;
}) {
  return (
    args.status !== undefined ||
    args.stage !== undefined ||
    args.error !== undefined ||
    args.lastErrorCode !== undefined
  );
}

async function patchJobAndRecordStageEvent(ctx: MutationCtx, args: PatchJobArgs) {
  const current = await ctx.db.get(args.researchJobId);
  if (!current) {
    throw new ConvexError("Research job not found");
  }

  const now = Date.now();
  const patch: Record<string, unknown> = {
    updatedAt: now,
  };

  if (args.status !== undefined) {
    patch.status = args.status;
  }
  if (args.stage !== undefined) {
    patch.stage = args.stage;
  }
  if (args.progress !== undefined) {
    patch.progress = args.progress;
  }
  if (args.error !== undefined) {
    patch.error = args.error ?? undefined;
  }
  if (args.lastErrorCode !== undefined) {
    patch.lastErrorCode = args.lastErrorCode ?? undefined;
  }
  if (args.nextRunAt !== undefined) {
    patch.nextRunAt = args.nextRunAt ?? undefined;
  }
  if (args.attemptDelta !== undefined) {
    patch.attempt = current.attempt + args.attemptDelta;
  }
  if (args.startedNow) {
    patch.startedAt = now;
  }
  if (args.completedNow) {
    patch.completedAt = now;
  }

  await ctx.db.patch(args.researchJobId, patch);

  if (shouldRecordStageEvent(args)) {
    const nextStatus = (args.status ?? current.status) as ResearchJobStatus;
    const nextStage = args.stage ?? current.stage;
    const nextProgress = args.progress ?? current.progress;
    const nextAttempt = current.attempt + (args.attemptDelta ?? 0);
    const nextErrorCode =
      args.lastErrorCode !== undefined ? (args.lastErrorCode ?? undefined) : current.lastErrorCode;

    const latestEvent = await ctx.db
      .query("researchStageEvents")
      .withIndex("by_job_createdAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .take(1);

    const duplicate = latestEvent[0]
      && latestEvent[0].status === nextStatus
      && latestEvent[0].stage === nextStage
      && latestEvent[0].progress === nextProgress
      && latestEvent[0].attempt === nextAttempt
      && latestEvent[0].errorCode === nextErrorCode;

    if (!duplicate) {
      await ctx.db.insert("researchStageEvents", {
        jobId: args.researchJobId,
        userId: current.userId,
        threadId: current.threadId,
        status: nextStatus,
        stage: nextStage,
        progress: nextProgress,
        attempt: nextAttempt,
        errorCode: nextErrorCode,
        createdAt: now,
      });
    }
  }
}

async function getOwnedJobOrThrow(
  ctx: {
    db: {
      get: (id: Id<"researchJobs">) => Promise<{
        _id: Id<"researchJobs">;
        userId: string;
        status: string;
      } | null>;
    };
  },
  researchJobId: Id<"researchJobs">,
  userId: string,
) {
  const job = await ctx.db.get(researchJobId);
  if (!job) {
    throw new ConvexError("Research job not found");
  }
  if (job.userId !== userId) {
    throw new ConvexError("Not authorized");
  }
  return job;
}

function summarizeExtractedContent(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.slice(0, 260);
}

function buildSearchQuery(prompt: string, domain: string) {
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

function createSynthesisSummary(sources: { title: string; url: string }[]) {
  if (sources.length === 0) {
    return "No reliable source links were captured yet. Kept a placeholder lead so the pipeline can continue; next step is adding fallback providers.";
  }

  const labels = sources.slice(0, 3).map((source) => source.title);
  return `Collected ${sources.length} web leads. Strongest early leads: ${labels.join("; ")}. All prices still require live verification before booking.`;
}

function isSensitiveSlot(key: string) {
  return SENSITIVE_SLOT_KEYS.has(key);
}

function verificationTimestamps(
  status: CandidateDraft["verificationStatus"],
  now: number,
): Pick<CandidateDraft, "verifiedAt" | "recheckAfter"> {
  if (status === "needs_live_check") {
    return {
      verifiedAt: undefined,
      recheckAfter: now,
    };
  }

  return {
    verifiedAt: now,
    recheckAfter: now + VERIFICATION_WINDOW_MS[status],
  };
}

function extractBudgetCeiling(text: string) {
  const budgetMatch = text.match(/(?:budget|max|under|below|<=?)\s*\$?\s*(\d{2,5})/i);
  if (budgetMatch) {
    return Number(budgetMatch[1]);
  }

  const dollarMatch = text.match(/\$\s*(\d{2,5})/);
  if (dollarMatch) {
    return Number(dollarMatch[1]);
  }

  return undefined;
}

type SourceEvidence = {
  title: string;
  url: string;
  snippet?: string;
  extractedSummary?: string;
};

type PromotedSourceEvidence = SourceEvidence & {
  signalScore: number;
  signalReasons: string[];
};

type QualityGapKey = "citation_coverage" | "numeric_evidence" | "source_diversity" | "confidence";

type QualityAssessment = {
  decision: "finalize" | "continue";
  score: number;
  round: number;
  gaps: QualityGapKey[];
  reason: string;
};

type CandidateEvidenceMetrics = {
  cheapestUsd: number;
  valueUsd: number;
  convenientUsd: number;
  cheapestMinutes: number;
  valueMinutes: number;
  convenientMinutes: number;
  cheapestTransfers: number;
  valueTransfers: number;
  convenientTransfers: number;
  flexibilityScore: number;
  baggageScore: number;
  bookingEaseScore: number;
  freshnessScore: number;
  confidenceLift: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function collectUsdPrices(text: string) {
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

function collectDurationMinutes(text: string) {
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

function collectTransferCounts(text: string) {
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

function median(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function average(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function keywordScore(text: string, positive: RegExp[], negative: RegExp[], baseline: number) {
  let score = baseline;
  for (const pattern of positive) {
    if (pattern.test(text)) {
      score += 0.06;
    }
  }
  for (const pattern of negative) {
    if (pattern.test(text)) {
      score -= 0.08;
    }
  }
  return clamp(score, 0.2, 0.95);
}

function deriveCandidateEvidenceMetrics(
  domain: string,
  baselineBudget: number,
  topSources: SourceEvidence[],
): CandidateEvidenceMetrics {
  const joinedEvidence = topSources
    .map((source) => `${source.title} ${source.snippet ?? ""} ${source.extractedSummary ?? ""}`)
    .join("\n");

  const priceSignals = collectUsdPrices(joinedEvidence);
  const durationSignals = collectDurationMinutes(joinedEvidence);
  const transferSignals = collectTransferCounts(joinedEvidence);

  const defaultMinutes = domain === "flight" ? { cheap: 680, value: 590, fast: 510 } : { cheap: 320, value: 260, fast: 210 };
  const defaultTransfers = domain === "flight" ? { cheap: 2, value: 1, fast: 0 } : { cheap: 1, value: 1, fast: 0 };

  const lowestPrice = priceSignals.length > 0 ? Math.min(...priceSignals) : Math.round(baselineBudget * 0.9);
  const medianPrice = median(priceSignals) ?? Math.round(baselineBudget * 1.02);
  const convenientPrice = clamp(Math.round(Math.max(medianPrice, lowestPrice) * 1.08), 30, 15000);

  const shortestDuration = durationSignals.length > 0 ? Math.min(...durationSignals) : defaultMinutes.fast;
  const medianDuration = median(durationSignals) ?? defaultMinutes.value;
  const slowDuration = clamp(
    Math.max(medianDuration, Math.round((average(durationSignals) ?? defaultMinutes.cheap) * 1.08)),
    30,
    3000,
  );

  const minTransfers = transferSignals.length > 0 ? Math.min(...transferSignals) : defaultTransfers.fast;
  const averageTransfers = average(transferSignals);
  const typicalTransfers = averageTransfers !== undefined ? clamp(Math.round(averageTransfers), 0, 4) : defaultTransfers.value;
  const higherTransfers = clamp(Math.max(typicalTransfers, minTransfers + 1), 0, 4);

  const extractCoverage = topSources.length > 0
    ? topSources.filter((source) => !!source.extractedSummary).length / topSources.length
    : 0;
  const snippetCoverage = topSources.length > 0
    ? topSources.filter((source) => !!source.snippet).length / topSources.length
    : 0;

  const freshnessScore = clamp(0.25 + extractCoverage * 0.5 + snippetCoverage * 0.2, 0.2, 0.98);
  const confidenceLift = clamp(0.04 + extractCoverage * 0.14 + Math.min(0.08, priceSignals.length * 0.015), 0.04, 0.26);

  const flexibilityScore = keywordScore(
    joinedEvidence,
    [/\brefundable\b/i, /\bfree\s+cancell?ation\b/i, /\bflexible\b/i, /\bchange\s+policy\b/i],
    [/\bnon[-\s]?refundable\b/i, /\bstrict\b/i, /\bno\s+changes\b/i],
    0.56,
  );

  const baggageScore = keywordScore(
    joinedEvidence,
    [/\bcarry[-\s]?on\s+included\b/i, /\bchecked\s+bag\s+included\b/i, /\bbaggage\s+included\b/i],
    [/\bbaggage\s+fee\b/i, /\bextra\s+bag(?:gage)?\b/i, /\bno\s+bag(?:gage)?\b/i],
    0.52,
  );

  const bookingEaseScore = keywordScore(
    joinedEvidence,
    [/\bofficial\s+site\b/i, /\bbook\s+direct\b/i, /\binstant\s+confirmation\b/i],
    [/\bcoupon\s+code\b/i, /\bpromo\s+code\b/i, /\bcall\s+to\s+book\b/i],
    0.6,
  );

  return {
    cheapestUsd: clamp(lowestPrice, 30, 15000),
    valueUsd: clamp(medianPrice, 30, 15000),
    convenientUsd: convenientPrice,
    cheapestMinutes: slowDuration,
    valueMinutes: clamp(medianDuration, 30, 3000),
    convenientMinutes: clamp(shortestDuration, 30, 3000),
    cheapestTransfers: higherTransfers,
    valueTransfers: typicalTransfers,
    convenientTransfers: minTransfers,
    flexibilityScore,
    baggageScore,
    bookingEaseScore,
    freshnessScore,
    confidenceLift,
  };
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

function promoteSourceEvidence(sources: SourceEvidence[]): PromotedSourceEvidence[] {
  const scored = sources.map(scoreSourceSignal);
  scored.sort((a, b) => {
    if (b.signalScore !== a.signalScore) {
      return b.signalScore - a.signalScore;
    }
    return a.url.localeCompare(b.url);
  });
  return scored.slice(0, MAX_PROMOTED_CONTEXT_SOURCES);
}

function assessResearchQuality(args: {
  promotedSources: PromotedSourceEvidence[];
  totalSourceCount: number;
  round: number;
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
    citationCoverage * 0.32
      + Math.min(1, numericSignals / 6) * 0.26
      + sourceDiversity * 0.18
      + confidence * 0.24,
    0,
    1,
  );

  const continueAllowed = args.round < MAX_RESEARCH_SCAN_ROUNDS;
  const decision = score < QUALITY_CONTINUE_THRESHOLD && continueAllowed ? "continue" : "finalize";

  const reason =
    decision === "continue"
      ? `Quality score ${(score * 100).toFixed(0)} is below threshold ${(QUALITY_CONTINUE_THRESHOLD * 100).toFixed(0)}; continuing targeted scan for: ${gaps.join(", ") || "coverage"}.`
      : `Quality score ${(score * 100).toFixed(0)} meets threshold or continuation budget exhausted.`;

  return {
    decision,
    score,
    round: args.round,
    gaps,
    reason,
  };
}

function buildFollowupSearchQuery(baseQuery: string, quality: QualityAssessment) {
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

function buildCandidateDrafts(
  goal: { prompt: string; domain: string; constraintSummary?: string },
  sources: SourceEvidence[],
): CandidateDraft[] {
  const now = Date.now();
  const top = sources.slice(0, 4);
  const sourceUrls = top.map((source) => source.url);
  const primary = sourceUrls[0];
  const routeHint = goal.domain === "flight" ? "route and airport alternatives" : "option alternatives";
  const budget = extractBudgetCeiling(`${goal.prompt} ${goal.constraintSummary ?? ""}`);
  const baselineBudget = budget ?? (goal.domain === "flight" ? 780 : 460);
  const evidenceMetrics = deriveCandidateEvidenceMetrics(goal.domain, baselineBudget, top);

  if (top.length === 0) {
    const pending = verificationTimestamps("needs_live_check", now);
    return [
      {
        category: "cheapest",
        title: "Lowest-Cost Lead Pending",
        summary:
          "No reliable live source links were captured in this run. Re-run search or broaden query constraints before presenting a bookable cheapest option.",
        confidence: 0.25,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 0.96),
        travelMinutes: goal.domain === "flight" ? 760 : 340,
        transferCount: 2,
        flexibilityScore: 0.4,
        baggageScore: 0.3,
        bookingEaseScore: 0.35,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      },
      {
        category: "best_value",
        title: "Best-Value Lead Pending",
        summary:
          "Value recommendation is blocked until at least one credible source is available for comparison across total cost and tradeoffs.",
        confidence: 0.22,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 1.06),
        travelMinutes: goal.domain === "flight" ? 690 : 300,
        transferCount: 1,
        flexibilityScore: 0.5,
        baggageScore: 0.45,
        bookingEaseScore: 0.45,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      },
      {
        category: "most_convenient",
        title: "Convenience Lead Pending",
        summary:
          "Convenience recommendation needs validated timing and transfer details from live sources before ranking can be trusted.",
        confidence: 0.2,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 1.14),
        travelMinutes: goal.domain === "flight" ? 540 : 230,
        transferCount: 0,
        flexibilityScore: 0.44,
        baggageScore: 0.5,
        bookingEaseScore: 0.55,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      },
    ];
  }

  const cheapestVerification = verificationTimestamps("needs_live_check", now);
  const valueVerification = verificationTimestamps("partially_verified", now);
  const convenientVerification = verificationTimestamps("needs_live_check", now);

  return [
    {
      category: "cheapest",
      title: "Cheapest Candidate (Web Lead)",
      summary:
        "Prioritize the strongest low-cost source first, then verify total payable amount including fees and baggage before booking.",
      confidence: clamp(0.56 + evidenceMetrics.confidenceLift * 0.6, 0.3, 0.9),
        verificationStatus: "needs_live_check",
      estimatedTotalUsd: evidenceMetrics.cheapestUsd,
      travelMinutes: evidenceMetrics.cheapestMinutes,
      transferCount: evidenceMetrics.cheapestTransfers,
      flexibilityScore: clamp(evidenceMetrics.flexibilityScore - 0.08, 0.2, 0.95),
      baggageScore: clamp(evidenceMetrics.baggageScore - 0.06, 0.2, 0.95),
      bookingEaseScore: clamp(evidenceMetrics.bookingEaseScore - 0.08, 0.2, 0.95),
      freshnessScore: evidenceMetrics.freshnessScore,
      verifiedAt: cheapestVerification.verifiedAt,
      recheckAfter: cheapestVerification.recheckAfter,
      primarySourceUrl: primary,
      sourceUrls,
    },
    {
      category: "best_value",
      title: "Best Value Candidate (Balanced)",
      summary: `Balance total price against ${routeHint}, transfer burden, and policy flexibility using the top ranked source set.`,
      confidence: clamp(0.6 + evidenceMetrics.confidenceLift, 0.32, 0.94),
      verificationStatus: "partially_verified",
      estimatedTotalUsd: evidenceMetrics.valueUsd,
      travelMinutes: evidenceMetrics.valueMinutes,
      transferCount: evidenceMetrics.valueTransfers,
      flexibilityScore: evidenceMetrics.flexibilityScore,
      baggageScore: evidenceMetrics.baggageScore,
      bookingEaseScore: evidenceMetrics.bookingEaseScore,
      freshnessScore: clamp(evidenceMetrics.freshnessScore + 0.05, 0.2, 1),
      verifiedAt: valueVerification.verifiedAt,
      recheckAfter: valueVerification.recheckAfter,
      primarySourceUrl: sourceUrls[1] ?? primary,
      sourceUrls,
    },
    {
      category: "most_convenient",
      title: "Most Convenient Candidate",
      summary:
        "Favor fewer transfers and simpler booking flow while staying within acceptable budget variance from the low-cost candidate.",
      confidence: clamp(0.54 + evidenceMetrics.confidenceLift * 0.5, 0.3, 0.9),
      verificationStatus: "needs_live_check",
      estimatedTotalUsd: evidenceMetrics.convenientUsd,
      travelMinutes: evidenceMetrics.convenientMinutes,
      transferCount: evidenceMetrics.convenientTransfers,
      flexibilityScore: clamp(evidenceMetrics.flexibilityScore - 0.02, 0.2, 0.95),
      baggageScore: clamp(evidenceMetrics.baggageScore + 0.04, 0.2, 0.95),
      bookingEaseScore: clamp(evidenceMetrics.bookingEaseScore + 0.12, 0.2, 0.97),
      freshnessScore: evidenceMetrics.freshnessScore,
      verifiedAt: convenientVerification.verifiedAt,
      recheckAfter: convenientVerification.recheckAfter,
      primarySourceUrl: sourceUrls[2] ?? primary,
      sourceUrls,
    },
  ];
}

async function upsertFactFromSlot(
  ctx: MutationCtx,
  args: {
    userId: string;
    key: string;
    value: string;
    sourceType: "inferred" | "user_confirmed";
  },
) {
  const now = Date.now();
  const sensitive = isSensitiveSlot(args.key);
  const status = args.sourceType === "user_confirmed" ? "confirmed" : sensitive ? "proposed" : "confirmed";
  const confidence = args.sourceType === "user_confirmed" ? 1 : sensitive ? 0.45 : 0.66;

  const existingFact = await ctx.db
    .query("userMemoryFacts")
    .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
    .order("desc")
    .take(1);

  if (!existingFact[0]) {
    await ctx.db.insert("userMemoryFacts", {
      userId: args.userId,
      key: args.key,
      value: args.value,
      sourceType: args.sourceType,
      confidence,
      status,
      isSensitive: sensitive,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const shouldProtectConfirmedFact =
    args.sourceType === "inferred"
    && existingFact[0].status === "confirmed"
    && existingFact[0].confidence >= 0.85
    && (existingFact[0].isSensitive || existingFact[0].sourceType === "user_confirmed");

  if (shouldProtectConfirmedFact) {
    return;
  }

  await ctx.db.patch(existingFact[0]._id, {
    value: args.value,
    sourceType: args.sourceType,
    confidence,
    status,
    isSensitive: sensitive,
    updatedAt: now,
  });
}

function buildPromptWithCriteria(prompt: string, criteria: Record<string, string>) {
  const entries = Object.entries(criteria)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .slice(0, 24);

  if (entries.length === 0) {
    return prompt;
  }

  const criteriaLines = entries.map(([key, value]) => `${key}: ${value}`).join("\n");
  return `${prompt}\n\nResearch criteria:\n${criteriaLines}`;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractJsonFromModelOutput(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return raw.trim();
}

function parsePlannerOutput(raw: string) {
  try {
    const parsed = JSON.parse(extractJsonFromModelOutput(raw));
    const result = plannerOutputSchema.safeParse(parsed);
    if (result.success) {
      return { plan: result.data, errors: [] as string[] };
    }
    return {
      plan: null,
      errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  } catch (error) {
    return {
      plan: null,
      errors: [`planner_json_parse_error: ${errorMessage(error)}`],
    };
  }
}

function buildDeterministicPlannerOutput(args: {
  prompt: string;
  domain: ResearchDomain;
  plannerHints: string[];
  constraintSummary?: string;
}): PlannerOutput {
  const primaryQuery = buildSearchQuery(args.prompt, args.domain);
  const fallbackQuery = `${primaryQuery} official fares baggage rules`.slice(0, 220);
  const hintSubqueries = args.plannerHints
    .slice(0, 2)
    .map((hint) => `${primaryQuery} ${compactText(hint).slice(0, 80)}`.slice(0, 220));
  const subqueries = Array.from(new Set([primaryQuery, ...hintSubqueries])).slice(0, 4);

  return {
    strategy: "Deterministic fallback plan: start with route-constrained query and add verification-focused expansions.",
    primaryQuery,
    fallbackQuery,
    subqueries,
    evidenceFocus: ["price_total", "duration", "transfers", "fare_rules", "freshness"],
    qualityGate:
      "Continue one targeted round when numeric fare evidence is weak; request clarification when required user criteria can unlock better coverage.",
  };
}

function buildPlannerPrompt(args: {
  prompt: string;
  domain: ResearchDomain;
  constraintSummary?: string;
  plannerHints: string[];
}) {
  return [
    "You are the research planner for a travel deep-research pipeline.",
    "Return only JSON matching the schema.",
    "Plan should be concise, query-focused, and evidence-first.",
    "",
    `domain: ${args.domain}`,
    `user_prompt: ${compactText(args.prompt)}`,
    `constraints: ${compactText(args.constraintSummary ?? "none")}`,
    "planner_hints:",
    args.plannerHints.length > 0 ? args.plannerHints.slice(0, 6).map((hint) => `- ${hint}`).join("\n") : "- none",
    "",
    "Required JSON schema:",
    "{",
    '  "strategy": "string (12-400)",',
    '  "primaryQuery": "string (6-220)",',
    '  "fallbackQuery": "string (6-220, optional)",',
    '  "subqueries": ["1-5 strings"],',
    '  "evidenceFocus": ["price_total|duration|transfers|baggage|fare_rules|freshness|booking_path"],',
    '  "qualityGate": "string (12-300)"',
    "}",
    "",
    "Do not include markdown, comments, or extra keys.",
  ].join("\n");
}

async function generatePlannerPlan(args: {
  prompt: string;
  domain: ResearchDomain;
  plannerHints: string[];
  constraintSummary?: string;
}): Promise<PlannerPlanResult> {
  const fallback = buildDeterministicPlannerOutput(args);
  const validationErrors: string[] = [];

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    validationErrors.push("planner_model_api_key_missing");
    return {
      plan: fallback,
      mode: "fallback",
      validationErrors,
    };
  }

  let plannerPrompt = buildPlannerPrompt(args);
  for (let attempt = 0; attempt <= MAX_PLANNER_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateText({
        model: google("gemini-flash-lite-latest"),
        prompt: plannerPrompt,
      });

      const parsed = parsePlannerOutput(result.text);
      if (parsed.plan) {
        return {
          plan: parsed.plan,
          mode: "llm",
          validationErrors,
        };
      }

      validationErrors.push(...parsed.errors);
      plannerPrompt = [
        buildPlannerPrompt(args),
        "",
        "Validation failed. Re-emit corrected JSON only.",
        ...parsed.errors.map((error) => `- ${error}`),
      ].join("\n");
    } catch (error) {
      validationErrors.push(`planner_model_error: ${errorMessage(error)}`);
      break;
    }
  }

  return {
    plan: fallback,
    mode: "fallback",
    validationErrors,
  };
}

function hasProvidedGoalSlot(
  slots: Array<{ key: string; value?: string; status: "missing" | "provided" | "confirmed" }>,
  targetKey: string,
) {
  const normalizedTarget = targetKey.trim().toLowerCase();
  return slots.some((slot) => {
    if (slot.key.trim().toLowerCase() !== normalizedTarget) {
      return false;
    }
    if (slot.status === "missing") {
      return false;
    }
    return !!slot.value?.trim();
  });
}

function buildClarificationPrompt(questions: Array<{ key: string; question: string }>) {
  const ask = questions
    .map((item) => item.question.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
  if (ask.length === 0) {
    return "Quick clarification before I continue the research.";
  }
  if (ask.length === 1) {
    return `Quick clarification before I continue: ${ask[0]}`;
  }
  return `Quick clarification before I continue:\n- ${ask.join("\n- ")}`;
}

export async function createResearchJobForPrompt(
  ctx: MutationCtx,
  args: {
    userId: string;
    threadId: string;
    promptMessageId: string;
    prompt: string;
    domainOverride?: ResearchDomain;
    criteriaOverrides?: Record<string, string>;
    selectedSkillSlugs?: string[];
    skillHintsSnapshot?: string[];
    skillPackDigest?: string;
  },
): Promise<ResearchStartResult> {
  const now = Date.now();
  const domain = args.domainOverride ?? detectDomain(args.prompt);
  const mode = detectMode(args.prompt);

  const confirmedFacts = await ctx.db
    .query("userMemoryFacts")
    .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", args.userId).eq("status", "confirmed"))
    .order("desc")
    .take(60);

  const memorySlots = confirmedFacts.reduce<Record<string, string>>((acc, fact) => {
    if (!acc[fact.key]) {
      acc[fact.key] = fact.value;
    }
    return acc;
  }, {});

  const promptSlots = mergeSlots(extractSlotsFromPrompt(args.prompt, domain), args.criteriaOverrides ?? {});
  const mergedSlots = mergeSlots(promptSlots, memorySlots);
  const missingFieldList = missingSlots(domain, mergedSlots);
  const followUpQuestion = buildFollowUpQuestion(domain, missingFieldList);
  const goalStatus = missingFieldList.length > 0 ? "awaiting_input" : "ready";
  const jobStatus = missingFieldList.length > 0 ? "awaiting_input" : "planned";

  const projectGoalId = await ctx.db.insert("projectGoals", {
    userId: args.userId,
    threadId: args.threadId,
    promptMessageId: args.promptMessageId,
    prompt: args.prompt,
    domain,
    status: goalStatus,
    mode,
    missingFields: missingFieldList,
    followUpQuestion,
    constraintSummary: summarizeConstraints(mergedSlots),
    createdAt: now,
    updatedAt: now,
  });

  const slotKeys = Array.from(new Set([...Object.keys(mergedSlots), ...missingFieldList]));
  await Promise.all(
    slotKeys.map((key) =>
      ctx.db.insert("projectGoalSlots", {
        projectGoalId,
        key,
        value: mergedSlots[key],
        status: mergedSlots[key] ? "provided" : "missing",
        sourceType: promptSlots[key] ? "prompt" : mergedSlots[key] ? "memory" : "prompt",
        isSensitive: key === "nationality" || key === "ageBand",
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );

  for (const [key, value] of Object.entries(promptSlots)) {
    if (!value) {
      continue;
    }
    await upsertFactFromSlot(ctx, {
      userId: args.userId,
      key,
      value,
      sourceType: "inferred",
    });
  }

  const researchJobId = await ctx.db.insert("researchJobs", {
    userId: args.userId,
    threadId: args.threadId,
    promptMessageId: args.promptMessageId,
    projectGoalId,
    status: jobStatus,
    stage: jobStatus === "planned" ? "Queued" : "Awaiting Required Details",
    progress: 0,
    attempt: 0,
    missingFields: missingFieldList,
    followUpQuestion,
    selectedSkillSlugs: args.selectedSkillSlugs,
    skillHintsSnapshot: args.skillHintsSnapshot,
    skillPackDigest: args.skillPackDigest,
    createdAt: now,
    updatedAt: now,
  });

  await Promise.all([
    ctx.db.insert("researchTasks", {
      jobId: researchJobId,
      key: "plan",
      label: "Build search plan",
      order: 0,
      status: "queued",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert("researchTasks", {
      jobId: researchJobId,
      key: "scan",
      label: "Scan candidate sources",
      order: 1,
      status: "queued",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert("researchTasks", {
      jobId: researchJobId,
      key: "synthesize",
      label: "Synthesize shortlist",
      order: 2,
      status: "queued",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  if (jobStatus === "planned") {
    await ctx.scheduler.runAfter(0, internal.research.runJobInternal, {
      researchJobId,
    });
  }

  return {
    researchJobId,
    projectGoalId,
    jobStatus,
    missingFields: missingFieldList,
    followUpQuestion,
  };
}

export async function continueAwaitingJobForPrompt(
  ctx: MutationCtx,
  args: {
    userId: string;
    threadId: string;
    promptMessageId: string;
    prompt: string;
    criteriaOverrides?: Record<string, string>;
    selectedSkillSlugs?: string[];
    skillHintsSnapshot?: string[];
    skillPackDigest?: string;
  },
): Promise<ResearchStartResult | null> {
  const jobs = await ctx.db
    .query("researchJobs")
    .withIndex("by_thread_updatedAt", (q) => q.eq("threadId", args.threadId))
    .order("desc")
    .take(8);
  const awaitingJob = jobs.find((job) => job.status === "awaiting_input");
  if (!awaitingJob) {
    return null;
  }

  const goal = await ctx.db.get(awaitingJob.projectGoalId);
  if (!goal) {
    throw new ConvexError("Project goal not found");
  }

  const now = Date.now();
  const promptSlots = mergeSlots(extractSlotsFromPrompt(args.prompt, goal.domain), args.criteriaOverrides ?? {});

  const [allGoalSlots, confirmedFacts] = await Promise.all([
    ctx.db
      .query("projectGoalSlots")
      .withIndex("by_goal_key", (q) => q.eq("projectGoalId", goal._id))
      .take(120),
    ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", args.userId).eq("status", "confirmed"))
      .order("desc")
      .take(60),
  ]);

  const explicitGoalSlots = allGoalSlots.reduce<Record<string, string>>((acc, slot) => {
    if (slot.status === "missing") {
      return acc;
    }
    if (slot.value && !acc[slot.key]) {
      acc[slot.key] = slot.value;
    }
    return acc;
  }, {});

  const memorySlots = confirmedFacts.reduce<Record<string, string>>((acc, fact) => {
    if (!acc[fact.key]) {
      acc[fact.key] = fact.value;
    }
    return acc;
  }, {});

  const mergedSlots = mergeSlots(promptSlots, mergeSlots(explicitGoalSlots, memorySlots));
  const missingFieldList = missingSlots(goal.domain, mergedSlots);
  const followUpQuestion = buildFollowUpQuestion(goal.domain, missingFieldList);
  const goalStatus = missingFieldList.length > 0 ? "awaiting_input" : "ready";
  const jobStatus = missingFieldList.length > 0 ? "awaiting_input" : "planned";

  const trackedSlotKeys = Array.from(
    new Set([
      ...requiredSlotsForDomain(goal.domain),
      ...Object.keys(explicitGoalSlots),
      ...Object.keys(memorySlots),
      ...Object.keys(promptSlots),
    ]),
  );

  const existingByKey = new Map(allGoalSlots.map((slot) => [slot.key, slot]));

  for (const key of trackedSlotKeys) {
    const value = mergedSlots[key];
    const fromPrompt = !!promptSlots[key];
    const sourceType = fromPrompt
      ? "user_confirmed"
      : value && memorySlots[key]
        ? "memory"
        : existingByKey.get(key)?.sourceType ?? "prompt";
    const status = value ? (fromPrompt ? "confirmed" : "provided") : "missing";
    const existing = existingByKey.get(key);

    if (!existing) {
      await ctx.db.insert("projectGoalSlots", {
        projectGoalId: goal._id,
        key,
        value,
        status,
        sourceType,
        isSensitive: isSensitiveSlot(key),
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    await ctx.db.patch(existing._id, {
      value,
      status,
      sourceType,
      isSensitive: isSensitiveSlot(key),
      updatedAt: now,
    });
  }

  for (const [key, value] of Object.entries(promptSlots)) {
    if (!value) {
      continue;
    }

    await upsertFactFromSlot(ctx, {
      userId: args.userId,
      key,
      value,
      sourceType: "user_confirmed",
    });
  }

  await ctx.db.patch(goal._id, {
    promptMessageId: args.promptMessageId,
    prompt: `${goal.prompt}\nFollow-up: ${args.prompt}`,
    status: goalStatus,
    missingFields: missingFieldList,
    followUpQuestion,
    constraintSummary: summarizeConstraints(mergedSlots),
    updatedAt: now,
  });

  await ctx.db.patch(awaitingJob._id, {
    promptMessageId: args.promptMessageId,
    status: jobStatus,
    stage: jobStatus === "planned" ? "Queued" : "Awaiting Required Details",
    progress: jobStatus === "planned" ? 0 : awaitingJob.progress,
    missingFields: missingFieldList,
    followUpQuestion,
    selectedSkillSlugs: args.selectedSkillSlugs ?? awaitingJob.selectedSkillSlugs,
    skillHintsSnapshot: args.skillHintsSnapshot ?? awaitingJob.skillHintsSnapshot,
    skillPackDigest: args.skillPackDigest ?? awaitingJob.skillPackDigest,
    error: undefined,
    lastErrorCode: undefined,
    nextRunAt: undefined,
    startedAt: jobStatus === "planned" ? undefined : awaitingJob.startedAt,
    completedAt: undefined,
    updatedAt: now,
  });

  if (jobStatus === "planned") {
    await ctx.scheduler.runAfter(0, internal.research.runJobInternal, {
      researchJobId: awaitingJob._id,
    });
  }

  return {
    researchJobId: awaitingJob._id,
    projectGoalId: goal._id,
    jobStatus,
    missingFields: missingFieldList,
    followUpQuestion,
  };
}

export const startResearchFromOpsInternal = internalMutation({
  args: {
    userId: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
    prompt: v.string(),
    domain: v.union(v.literal("flight"), v.literal("train"), v.literal("concert"), v.literal("mixed"), v.literal("general")),
    selectedSkillSlugs: v.array(v.string()),
    criteria: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
      }),
    ),
    skillHintsSnapshot: v.array(v.string()),
    skillPackDigest: v.optional(v.string()),
  },
  returns: v.object({
    researchJobId: v.id("researchJobs"),
    projectGoalId: v.id("projectGoals"),
    jobStatus: v.union(v.literal("awaiting_input"), v.literal("planned")),
    missingFields: v.array(v.string()),
    followUpQuestion: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const selectedSkillSlugs = Array.from(
      new Set(args.selectedSkillSlugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => slug.length > 0)),
    ).slice(0, 8);

    if (selectedSkillSlugs.length === 0) {
      throw new ConvexError("At least one skill is required to start research");
    }

    const criteriaOverrides = Object.fromEntries(
      args.criteria
        .map((entry) => [entry.key.trim(), entry.value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0),
    );

    const prompt = buildPromptWithCriteria(args.prompt, criteriaOverrides);

    const resumed = await continueAwaitingJobForPrompt(ctx, {
      userId: args.userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      prompt,
      criteriaOverrides,
      selectedSkillSlugs,
      skillHintsSnapshot: args.skillHintsSnapshot,
      skillPackDigest: args.skillPackDigest,
    });

    if (resumed) {
      return resumed;
    }

    return await createResearchJobForPrompt(ctx, {
      userId: args.userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      prompt,
      domainOverride: args.domain,
      criteriaOverrides,
      selectedSkillSlugs,
      skillHintsSnapshot: args.skillHintsSnapshot,
      skillPackDigest: args.skillPackDigest,
    });
  },
});

export const requestUserClarificationInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    requestedBy: v.optional(v.union(v.literal("researcher"), v.literal("system"))),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        answerType: v.union(v.literal("string"), v.literal("boolean"), v.literal("enum"), v.literal("date"), v.literal("number")),
        required: v.boolean(),
        choices: v.optional(v.array(v.string())),
        reason: v.optional(v.string()),
        evidenceUrls: v.optional(v.array(v.string())),
      }),
    ),
  },
  returns: v.object({
    requestId: v.id("researchClarificationRequests"),
    askedMessage: v.string(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      throw new ConvexError("Research job not found");
    }

    if (args.questions.length === 0) {
      throw new ConvexError("At least one clarification question is required");
    }

    const dedupedQuestions = Array.from(
      new Map(
        args.questions
          .map((question) => ({
            ...question,
            key: question.key.trim(),
            question: question.question.trim(),
          }))
          .filter((question) => question.key.length > 0 && question.question.length > 0)
          .map((question) => [question.key.toLowerCase(), question] as const),
      ).values(),
    ).slice(0, 3);

    if (dedupedQuestions.length === 0) {
      throw new ConvexError("At least one valid clarification question is required");
    }

    const now = Date.now();
    const askedMessage = buildClarificationPrompt(
      dedupedQuestions.map((question) => ({ key: question.key, question: question.question })),
    );

    const existingPending = await ctx.db
      .query("researchClarificationRequests")
      .withIndex("by_thread_status_createdAt", (q) => q.eq("threadId", job.threadId).eq("status", "pending"))
      .order("desc")
      .take(1);
    if (existingPending[0]?.jobId === job._id) {
      await ctx.db.patch(existingPending[0]._id, {
        questions: dedupedQuestions,
        askedMessage,
        updatedAt: now,
      });
      await ctx.db.patch(job._id, {
        blockedByRequestId: existingPending[0]._id,
        missingFields: dedupedQuestions.map((question) => question.key),
        followUpQuestion: askedMessage,
        updatedAt: now,
      });
      await patchJobAndRecordStageEvent(ctx, {
        researchJobId: job._id,
        status: "awaiting_input",
        stage: "Awaiting clarification",
      });
      return { requestId: existingPending[0]._id, askedMessage };
    }

    const requestId = await ctx.db.insert("researchClarificationRequests", {
      jobId: job._id,
      userId: job.userId,
      threadId: job.threadId,
      status: "pending",
      requestedBy: args.requestedBy ?? "researcher",
      questions: dedupedQuestions,
      askedMessage,
      createdAt: now,
      updatedAt: now,
    });

    await patchJobAndRecordStageEvent(ctx, {
      researchJobId: job._id,
      status: "awaiting_input",
      stage: "Awaiting clarification",
    });
    await ctx.db.patch(job._id, {
      blockedByRequestId: requestId,
      missingFields: dedupedQuestions.map((question) => question.key),
      followUpQuestion: askedMessage,
      updatedAt: now,
    });

    await ctx.db.insert("researchDialogueEvents", {
      jobId: job._id,
      userId: job.userId,
      threadId: job.threadId,
      actor: "researcher",
      kind: "decision",
      message: "Clarification requested from user.",
      detail: dedupedQuestions.map((question) => question.key).join(","),
      createdAt: now,
    });

    return { requestId, askedMessage };
  },
});

export const submitClarificationAnswerInternal = internalMutation({
  args: {
    requestId: v.id("researchClarificationRequests"),
    answers: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
      }),
    ),
  },
  returns: v.object({
    accepted: v.boolean(),
    resumed: v.boolean(),
    missingKeys: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new ConvexError("Clarification request not found");
    }
    if (request.status !== "pending") {
      return { accepted: false, resumed: false, missingKeys: [] };
    }

    const now = Date.now();
    const answersByKey = new Map(
      args.answers
        .map((answer) => [answer.key.trim().toLowerCase(), answer.value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0),
    );

    const requiredKeys = request.questions.filter((question) => question.required).map((question) => question.key.toLowerCase());
    const missingKeys = requiredKeys.filter((key) => !answersByKey.get(key));
    if (missingKeys.length > 0) {
      await ctx.db.patch(args.requestId, {
        updatedAt: now,
      });
      return { accepted: false, resumed: false, missingKeys };
    }

    const normalizedAnswers = Array.from(answersByKey.entries()).map(([key, value]) => ({ key, value }));
    await ctx.db.patch(args.requestId, {
      status: "answered",
      answers: normalizedAnswers,
      answeredAt: now,
      updatedAt: now,
    });

    const job = await ctx.db.get(request.jobId);
    if (!job) {
      throw new ConvexError("Research job not found");
    }
    const goal = await ctx.db.get(job.projectGoalId);
    if (!goal) {
      throw new ConvexError("Project goal not found");
    }

    const existingSlots = await ctx.db
      .query("projectGoalSlots")
      .withIndex("by_goal_key", (q) => q.eq("projectGoalId", goal._id))
      .take(120);
    const existingByKey = new Map(existingSlots.map((slot) => [slot.key.toLowerCase(), slot]));

    for (const answer of normalizedAnswers) {
      const existing = existingByKey.get(answer.key);
      if (existing) {
        await ctx.db.patch(existing._id, {
          value: answer.value,
          status: "confirmed",
          sourceType: "user_confirmed",
          isSensitive: isSensitiveSlot(answer.key),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("projectGoalSlots", {
          projectGoalId: goal._id,
          key: answer.key,
          value: answer.value,
          status: "confirmed",
          sourceType: "user_confirmed",
          isSensitive: isSensitiveSlot(answer.key),
          createdAt: now,
          updatedAt: now,
        });
      }

      await upsertFactFromSlot(ctx, {
        userId: job.userId,
        key: answer.key,
        value: answer.value,
        sourceType: "user_confirmed",
      });
    }

    await patchJobAndRecordStageEvent(ctx, {
      researchJobId: job._id,
      status: "planned",
      stage: "Clarification received",
    });
    await ctx.db.patch(job._id, {
      blockedByRequestId: undefined,
      missingFields: undefined,
      followUpQuestion: undefined,
      error: undefined,
      lastErrorCode: undefined,
      nextRunAt: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("researchDialogueEvents", {
      jobId: job._id,
      userId: job.userId,
      threadId: job.threadId,
      actor: "chatbot",
      kind: "decision",
      message: "Clarification answers captured; resuming research.",
      detail: normalizedAnswers.map((answer) => answer.key).join(","),
      createdAt: now,
    });

    return { accepted: true, resumed: false, missingKeys: [] };
  },
});

export const getPendingClarificationForThread = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      requestId: v.id("researchClarificationRequests"),
      researchJobId: v.id("researchJobs"),
      askedMessage: v.string(),
      questions: v.array(
        v.object({
          key: v.string(),
          question: v.string(),
          answerType: v.union(v.literal("string"), v.literal("boolean"), v.literal("enum"), v.literal("date"), v.literal("number")),
          required: v.boolean(),
          choices: v.optional(v.array(v.string())),
          reason: v.optional(v.string()),
          evidenceUrls: v.optional(v.array(v.string())),
        }),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const pending = await ctx.db
      .query("researchClarificationRequests")
      .withIndex("by_thread_status_createdAt", (q) => q.eq("threadId", args.threadId).eq("status", "pending"))
      .order("desc")
      .take(5);
    const selected = pending.find((item) => item.userId === userId);
    if (!selected) {
      return null;
    }

    return {
      requestId: selected._id,
      researchJobId: selected.jobId,
      askedMessage: selected.askedMessage,
      questions: selected.questions,
      createdAt: selected.createdAt,
    };
  },
});

export const getPendingClarificationForThreadInternal = internalQuery({
  args: {
    threadId: v.string(),
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      requestId: v.id("researchClarificationRequests"),
      researchJobId: v.id("researchJobs"),
      askedMessage: v.string(),
      questions: v.array(
        v.object({
          key: v.string(),
          question: v.string(),
          answerType: v.union(v.literal("string"), v.literal("boolean"), v.literal("enum"), v.literal("date"), v.literal("number")),
          required: v.boolean(),
          choices: v.optional(v.array(v.string())),
          reason: v.optional(v.string()),
          evidenceUrls: v.optional(v.array(v.string())),
        }),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("researchClarificationRequests")
      .withIndex("by_thread_status_createdAt", (q) => q.eq("threadId", args.threadId).eq("status", "pending"))
      .order("desc")
      .take(5);
    const selected = pending.find((item) => item.userId === args.userId);
    if (!selected) {
      return null;
    }

    return {
      requestId: selected._id,
      researchJobId: selected.jobId,
      askedMessage: selected.askedMessage,
      questions: selected.questions,
      createdAt: selected.createdAt,
    };
  },
});

export const getLatestJobForThread = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      researchJobId: v.id("researchJobs"),
      status: v.string(),
      stage: v.string(),
      progress: v.number(),
      error: v.optional(v.string()),
      lastErrorCode: v.optional(v.string()),
      nextRunAt: v.optional(v.number()),
      missingFields: v.optional(v.array(v.string())),
      followUpQuestion: v.optional(v.string()),
      blockedByRequestId: v.optional(v.id("researchClarificationRequests")),
      selectedSkillSlugs: v.optional(v.array(v.string())),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      updatedAt: v.number(),
      tasks: v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          attempt: v.number(),
          status: v.string(),
          errorCode: v.optional(v.string()),
          nextRunAt: v.optional(v.number()),
          updatedAt: v.number(),
        }),
      ),
      findings: v.array(
        v.object({
          title: v.string(),
          summary: v.string(),
          confidence: v.number(),
          sourceType: v.string(),
          createdAt: v.number(),
        }),
      ),
      sources: v.array(
        v.object({
          rank: v.number(),
          title: v.string(),
          url: v.string(),
          snippet: v.optional(v.string()),
          provider: v.string(),
          createdAt: v.number(),
        }),
      ),
      candidates: v.array(
        v.object({
          category: v.string(),
          title: v.string(),
          summary: v.string(),
          confidence: v.number(),
          verificationStatus: v.string(),
          estimatedTotalUsd: v.number(),
          travelMinutes: v.number(),
          transferCount: v.number(),
          flexibilityScore: v.number(),
          baggageScore: v.number(),
          bookingEaseScore: v.number(),
          freshnessScore: v.number(),
          verifiedAt: v.optional(v.number()),
          recheckAfter: v.number(),
          primarySourceUrl: v.optional(v.string()),
          sourceUrls: v.array(v.string()),
          updatedAt: v.number(),
        }),
      ),
      rankedResults: v.array(
        v.object({
          category: v.string(),
          rank: v.number(),
          score: v.number(),
          title: v.string(),
          rationale: v.string(),
          verificationStatus: v.string(),
          verifiedAt: v.optional(v.number()),
          recheckAfter: v.number(),
          sourceUrls: v.array(v.string()),
          updatedAt: v.number(),
        }),
      ),
      dialogueEvents: v.array(
        v.object({
          actor: v.string(),
          kind: v.string(),
          message: v.string(),
          detail: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const jobs = await ctx.db
      .query("researchJobs")
      .withIndex("by_user_thread_updatedAt", (q) => q.eq("userId", userId).eq("threadId", args.threadId))
      .order("desc")
      .take(8);

    const selectedJob = jobs.find((job) => !TERMINAL_JOB_STATUSES.has(job.status)) ?? jobs[0] ?? null;
    if (!selectedJob) {
      return null;
    }

    const [tasks, findings, sources, candidates, rankedResults, dialogueEvents] = await Promise.all([
      ctx.db
        .query("researchTasks")
        .withIndex("by_job_order", (q) => q.eq("jobId", selectedJob._id))
        .order("asc")
        .take(20),
      ctx.db
        .query("findings")
        .withIndex("by_job_createdAt", (q) => q.eq("jobId", selectedJob._id))
        .order("desc")
        .take(4),
      ctx.db
        .query("sources")
        .withIndex("by_job_rank", (q) => q.eq("jobId", selectedJob._id))
        .order("asc")
        .take(5),
      ctx.db
        .query("candidates")
        .withIndex("by_job_updatedAt", (q) => q.eq("jobId", selectedJob._id))
        .order("desc")
        .take(8),
      ctx.db
        .query("rankedResults")
        .withIndex("by_job_rank", (q) => q.eq("jobId", selectedJob._id))
        .order("asc")
        .take(10),
      ctx.db
        .query("researchDialogueEvents")
        .withIndex("by_job_createdAt", (q) => q.eq("jobId", selectedJob._id))
        .order("desc")
        .take(10),
    ]);

    return {
      researchJobId: selectedJob._id,
      status: selectedJob.status,
      stage: selectedJob.stage,
      progress: selectedJob.progress,
      error: selectedJob.error,
      lastErrorCode: selectedJob.lastErrorCode,
      nextRunAt: selectedJob.nextRunAt,
      missingFields: selectedJob.missingFields,
      followUpQuestion: selectedJob.followUpQuestion,
      blockedByRequestId: selectedJob.blockedByRequestId,
      selectedSkillSlugs: selectedJob.selectedSkillSlugs,
      startedAt: selectedJob.startedAt,
      completedAt: selectedJob.completedAt,
      updatedAt: selectedJob.updatedAt,
      tasks: tasks.map((task) => ({
        key: task.key,
        label: task.label,
        attempt: task.attempt,
        status: task.status,
        errorCode: task.errorCode,
        nextRunAt: task.nextRunAt,
        updatedAt: task.updatedAt,
      })),
      findings: findings
        .slice()
        .reverse()
        .map((finding) => ({
          title: finding.title,
          summary: finding.summary,
          confidence: finding.confidence,
          sourceType: finding.sourceType,
          createdAt: finding.createdAt,
        })),
      sources: sources.map((source) => ({
        rank: source.rank,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        provider: source.provider,
        createdAt: source.createdAt,
      })),
      candidates: candidates
        .slice()
        .reverse()
        .map((candidate) => ({
          category: candidate.category,
          title: candidate.title,
          summary: candidate.summary,
          confidence: candidate.confidence,
          verificationStatus: candidate.verificationStatus,
          estimatedTotalUsd: candidate.estimatedTotalUsd,
          travelMinutes: candidate.travelMinutes,
          transferCount: candidate.transferCount,
          flexibilityScore: candidate.flexibilityScore,
          baggageScore: candidate.baggageScore,
          bookingEaseScore: candidate.bookingEaseScore,
          freshnessScore: candidate.freshnessScore,
          verifiedAt: candidate.verifiedAt,
          recheckAfter: candidate.recheckAfter,
          primarySourceUrl: candidate.primarySourceUrl,
          sourceUrls: candidate.sourceUrls,
          updatedAt: candidate.updatedAt,
        })),
      rankedResults: rankedResults.map((ranked) => ({
        category: ranked.category,
        rank: ranked.rank,
        score: ranked.score,
        title: ranked.title,
        rationale: ranked.rationale,
        verificationStatus: ranked.verificationStatus,
        verifiedAt: ranked.verifiedAt,
        recheckAfter: ranked.recheckAfter,
        sourceUrls: ranked.sourceUrls,
        updatedAt: ranked.updatedAt,
      })),
      dialogueEvents: dialogueEvents
        .slice()
        .reverse()
        .map((event) => ({
          actor: event.actor,
          kind: event.kind,
          message: event.message,
          detail: event.detail,
          createdAt: event.createdAt,
        })),
    };
  },
});

export const listJobsByThread = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("researchJobs")
      .withIndex("by_user_thread_updatedAt", (q) => q.eq("userId", userId).eq("threadId", args.threadId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((job) => ({
        researchJobId: job._id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        lastErrorCode: job.lastErrorCode,
        nextRunAt: job.nextRunAt,
        missingFields: job.missingFields,
        updatedAt: job.updatedAt,
      })),
    };
  },
});

export const listSourcesByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("sources")
      .withIndex("by_job_rank", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((source) => ({
        rank: source.rank,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        provider: source.provider,
        createdAt: source.createdAt,
      })),
    };
  },
});

export const listCandidatesByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("candidates")
      .withIndex("by_job_updatedAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((candidate) => ({
        category: candidate.category,
        title: candidate.title,
        summary: candidate.summary,
        confidence: candidate.confidence,
        verificationStatus: candidate.verificationStatus,
        estimatedTotalUsd: candidate.estimatedTotalUsd,
        travelMinutes: candidate.travelMinutes,
        transferCount: candidate.transferCount,
        flexibilityScore: candidate.flexibilityScore,
        baggageScore: candidate.baggageScore,
        bookingEaseScore: candidate.bookingEaseScore,
        freshnessScore: candidate.freshnessScore,
        verifiedAt: candidate.verifiedAt,
        recheckAfter: candidate.recheckAfter,
        primarySourceUrl: candidate.primarySourceUrl,
        sourceUrls: candidate.sourceUrls,
        updatedAt: candidate.updatedAt,
      })),
    };
  },
});

export const listTasksByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("researchTasks")
      .withIndex("by_job_order", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((task) => ({
        key: task.key,
        label: task.label,
        order: task.order,
        status: task.status,
        attempt: task.attempt,
        errorCode: task.errorCode,
        nextRunAt: task.nextRunAt,
        updatedAt: task.updatedAt,
      })),
    };
  },
});

export const listFindingsByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("findings")
      .withIndex("by_job_createdAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((finding) => ({
        title: finding.title,
        summary: finding.summary,
        confidence: finding.confidence,
        sourceType: finding.sourceType,
        createdAt: finding.createdAt,
      })),
    };
  },
});

export const listRankedResultsByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("rankedResults")
      .withIndex("by_job_rank", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((ranked) => ({
        category: ranked.category,
        rank: ranked.rank,
        score: ranked.score,
        title: ranked.title,
        rationale: ranked.rationale,
        verificationStatus: ranked.verificationStatus,
        verifiedAt: ranked.verifiedAt,
        recheckAfter: ranked.recheckAfter,
        updatedAt: ranked.updatedAt,
      })),
    };
  },
});

export const listStageEventsByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("researchStageEvents")
      .withIndex("by_job_createdAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((event) => ({
        status: event.status,
        stage: event.stage,
        progress: event.progress,
        attempt: event.attempt,
        errorCode: event.errorCode,
        createdAt: event.createdAt,
      })),
    };
  },
});

export const listDialogueEventsByJob = query({
  args: {
    researchJobId: v.id("researchJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    await getOwnedJobOrThrow(ctx, args.researchJobId, userId);
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("researchDialogueEvents")
      .withIndex("by_job_createdAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((event) => ({
        actor: event.actor,
        kind: event.kind,
        message: event.message,
        detail: event.detail,
        createdAt: event.createdAt,
      })),
    };
  },
});

export const requestLiveRecheck = mutation({
  args: {
    researchJobId: v.id("researchJobs"),
  },
  returns: v.object({
    scheduled: v.boolean(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const job = await getOwnedJobOrThrow(ctx, args.researchJobId, userId);

    if (job.status === "awaiting_input") {
      return { scheduled: false, status: job.status };
    }
    if (job.status === "running" || job.status === "synthesizing" || job.status === "verifying") {
      return { scheduled: false, status: job.status };
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "planned",
      stage: "Manual live recheck queued",
      progress: 0,
      error: undefined,
      lastErrorCode: undefined,
      nextRunAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      updatedAt: now,
    });

    const tasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_job_order", (q) => q.eq("jobId", job._id))
      .order("asc")
      .take(20);
    await Promise.all(
      tasks.map((task) =>
        ctx.db.patch(task._id, {
          status: "queued",
          output: undefined,
          error: undefined,
          errorCode: undefined,
          nextRunAt: undefined,
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: now,
        }),
      ),
    );

    await ctx.scheduler.runAfter(0, internal.research.runJobInternal, {
      researchJobId: job._id,
    });
    return { scheduled: true, status: "planned" };
  },
});

export const getJobInternal = internalQuery({
  args: {
    researchJobId: v.id("researchJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.researchJobId);
  },
});

export const getProjectGoalInternal = internalQuery({
  args: {
    projectGoalId: v.id("projectGoals"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectGoalId);
  },
});

export const listGoalSlotsInternal = internalQuery({
  args: {
    projectGoalId: v.id("projectGoals"),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      value: v.optional(v.string()),
      status: v.union(v.literal("missing"), v.literal("provided"), v.literal("confirmed")),
      sourceType: v.union(v.literal("prompt"), v.literal("memory"), v.literal("user_confirmed")),
      isSensitive: v.boolean(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const slots = await ctx.db
      .query("projectGoalSlots")
      .withIndex("by_goal_key", (q) => q.eq("projectGoalId", args.projectGoalId))
      .take(120);
    return slots.map((slot) => ({
      key: slot.key,
      value: slot.value,
      status: slot.status,
      sourceType: slot.sourceType,
      isSensitive: slot.isSensitive,
      updatedAt: slot.updatedAt,
    }));
  },
});

export const listSourcesForJobInternal = internalQuery({
  args: {
    researchJobId: v.id("researchJobs"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sources")
      .withIndex("by_job_rank", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .take(args.limit);
  },
});

export const acquireJobLeaseInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    leaseToken: v.string(),
    leaseMs: v.number(),
  },
  returns: v.object({
    acquired: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      return { acquired: false };
    }
    if (job.status !== "planned" && job.status !== "running") {
      return { acquired: false };
    }

    const now = Date.now();
    const hasActiveLease =
      !!job.runLeaseToken
      && !!job.runLeaseExpiresAt
      && job.runLeaseExpiresAt > now
      && job.runLeaseToken !== args.leaseToken;

    if (hasActiveLease) {
      return { acquired: false };
    }

    await ctx.db.patch(args.researchJobId, {
      runLeaseToken: args.leaseToken,
      runLeaseExpiresAt: now + Math.max(1, args.leaseMs),
    });

    return { acquired: true };
  },
});

export const releaseJobLeaseInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    leaseToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      return null;
    }
    if (job.runLeaseToken !== args.leaseToken) {
      return null;
    }

    await ctx.db.patch(args.researchJobId, {
      runLeaseToken: undefined,
      runLeaseExpiresAt: undefined,
    });

    return null;
  },
});

export const scheduleRetryInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    taskKey: v.optional(v.string()),
    error: v.string(),
    errorCode: v.string(),
    delayMs: v.number(),
  },
  returns: v.object({
    nextRunAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const delayMs = Math.max(0, args.delayMs);
    const nextRunAt = now + delayMs;

    await patchJobAndRecordStageEvent(ctx, {
      researchJobId: args.researchJobId,
      status: "planned",
      stage: "Retry scheduled",
      error: args.error,
      lastErrorCode: args.errorCode,
      nextRunAt,
    });

    if (args.taskKey) {
      const taskKey = args.taskKey;
      const task = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_taskKey", (q) => q.eq("jobId", args.researchJobId).eq("key", taskKey))
        .unique();

      if (task) {
        await ctx.db.patch(task._id, {
          status: "queued",
          error: undefined,
          errorCode: args.errorCode,
          nextRunAt,
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: now,
        });
      }
    }

    await ctx.scheduler.runAfter(delayMs, internal.research.runJobInternal, {
      researchJobId: args.researchJobId,
    });

    return { nextRunAt };
  },
});

export const patchJobInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("awaiting_input"),
        v.literal("planned"),
        v.literal("running"),
        v.literal("synthesizing"),
        v.literal("verifying"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("expired"),
      ),
    ),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    error: v.optional(v.union(v.string(), v.null())),
    lastErrorCode: v.optional(v.union(v.string(), v.null())),
    nextRunAt: v.optional(v.union(v.number(), v.null())),
    attemptDelta: v.optional(v.number()),
    startedNow: v.optional(v.boolean()),
    completedNow: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await patchJobAndRecordStageEvent(ctx, args);
    return null;
  },
});

export const patchTaskInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    key: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("timeout"),
    ),
    attemptDelta: v.optional(v.number()),
    output: v.optional(v.string()),
    error: v.optional(v.union(v.string(), v.null())),
    errorCode: v.optional(v.union(v.string(), v.null())),
    nextRunAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("researchTasks")
      .withIndex("by_job_taskKey", (q) => q.eq("jobId", args.researchJobId).eq("key", args.key))
      .unique();

    if (!task) {
      throw new ConvexError("Research task not found");
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      attempt: task.attempt + (args.attemptDelta ?? 0),
      updatedAt: now,
      startedAt: args.status === "running" ? now : task.startedAt,
      completedAt:
        args.status === "completed" ||
        args.status === "failed" ||
        args.status === "skipped" ||
        args.status === "timeout"
          ? now
          : task.completedAt,
    };

    if (args.output !== undefined) {
      patch.output = args.output;
    }
    if (args.error !== undefined) {
      patch.error = args.error ?? undefined;
    }
    if (args.errorCode !== undefined) {
      patch.errorCode = args.errorCode ?? undefined;
    }
    if (args.nextRunAt !== undefined) {
      patch.nextRunAt = args.nextRunAt ?? undefined;
    }

    await ctx.db.patch(task._id, patch);
    return null;
  },
});

export const addFindingInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    taskKey: v.optional(v.string()),
    title: v.string(),
    summary: v.string(),
    confidence: v.number(),
    sourceType: v.union(v.literal("simulated"), v.literal("web"), v.literal("api")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let taskId: Id<"researchTasks"> | undefined;
    const taskKey = args.taskKey;
    if (taskKey) {
      const task = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_taskKey", (q) => q.eq("jobId", args.researchJobId).eq("key", taskKey))
        .unique();
      taskId = task?._id;
    }

    await ctx.db.insert("findings", {
      jobId: args.researchJobId,
      taskId,
      title: args.title,
      summary: args.summary,
      confidence: args.confidence,
      sourceType: args.sourceType,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const addDialogueEventInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    actor: v.union(v.literal("researcher"), v.literal("chatbot"), v.literal("system")),
    kind: v.union(
      v.literal("status"),
      v.literal("plan"),
      v.literal("quality"),
      v.literal("context"),
      v.literal("decision"),
      v.literal("error"),
    ),
    message: v.string(),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      throw new ConvexError("Research job not found");
    }

    await ctx.db.insert("researchDialogueEvents", {
      jobId: args.researchJobId,
      userId: job.userId,
      threadId: job.threadId,
      actor: args.actor,
      kind: args.kind,
      message: args.message,
      detail: args.detail,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const addSourcesInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    taskKey: v.optional(v.string()),
    sources: v.array(
      v.object({
        rank: v.number(),
        url: v.string(),
        title: v.string(),
        snippet: v.optional(v.string()),
        provider: v.union(v.literal("tavily"), v.literal("fallback")),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let taskId: Id<"researchTasks"> | undefined;
    const taskKey = args.taskKey;
    if (taskKey) {
      const task = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_taskKey", (q) => q.eq("jobId", args.researchJobId).eq("key", taskKey))
        .unique();
      taskId = task?._id;
    }

    const existing = await ctx.db
      .query("sources")
      .withIndex("by_job_rank", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .take(200);
    const seenUrls = new Set(existing.map((source) => source.url));
    const now = Date.now();

    let inserted = 0;
    for (const source of args.sources) {
      if (seenUrls.has(source.url)) {
        continue;
      }
      seenUrls.add(source.url);
      await ctx.db.insert("sources", {
        jobId: args.researchJobId,
        taskId,
        rank: source.rank,
        url: source.url,
        title: source.title,
        snippet: source.snippet,
        provider: source.provider,
        createdAt: now,
      });
      inserted += 1;
    }

    return inserted;
  },
});

export const replaceCandidatesInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    candidates: v.array(
      v.object({
        category: v.union(
          v.literal("cheapest"),
          v.literal("best_value"),
          v.literal("most_convenient"),
        ),
        title: v.string(),
        summary: v.string(),
        confidence: v.number(),
        verificationStatus: v.union(
          v.literal("needs_live_check"),
          v.literal("partially_verified"),
          v.literal("verified"),
        ),
        estimatedTotalUsd: v.number(),
        travelMinutes: v.number(),
        transferCount: v.number(),
        flexibilityScore: v.number(),
        baggageScore: v.number(),
        bookingEaseScore: v.number(),
        freshnessScore: v.number(),
        verifiedAt: v.optional(v.number()),
        recheckAfter: v.number(),
        primarySourceUrl: v.optional(v.string()),
        sourceUrls: v.array(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("candidates")
      .withIndex("by_job_updatedAt", (q) => q.eq("jobId", args.researchJobId))
      .order("desc")
      .take(20);

    await Promise.all(existing.map((candidate) => ctx.db.delete(candidate._id)));

    const now = Date.now();
    for (const candidate of args.candidates) {
      await ctx.db.insert("candidates", {
        jobId: args.researchJobId,
        category: candidate.category,
        title: candidate.title,
        summary: candidate.summary,
        confidence: candidate.confidence,
        verificationStatus: candidate.verificationStatus,
        estimatedTotalUsd: candidate.estimatedTotalUsd,
        travelMinutes: candidate.travelMinutes,
        transferCount: candidate.transferCount,
        flexibilityScore: candidate.flexibilityScore,
        baggageScore: candidate.baggageScore,
        bookingEaseScore: candidate.bookingEaseScore,
        freshnessScore: candidate.freshnessScore,
        verifiedAt: candidate.verifiedAt,
        recheckAfter: candidate.recheckAfter,
        primarySourceUrl: candidate.primarySourceUrl,
        sourceUrls: candidate.sourceUrls,
        createdAt: now,
        updatedAt: now,
      });
    }

    return args.candidates.length;
  },
});

export const replaceRankedResultsInternal = internalMutation({
  args: {
    researchJobId: v.id("researchJobs"),
    rankedResults: v.array(
      v.object({
        category: v.union(
          v.literal("cheapest"),
          v.literal("best_value"),
          v.literal("most_convenient"),
        ),
        rank: v.number(),
        score: v.number(),
        title: v.string(),
        rationale: v.string(),
        verificationStatus: v.union(
          v.literal("needs_live_check"),
          v.literal("partially_verified"),
          v.literal("verified"),
        ),
        verifiedAt: v.optional(v.number()),
        recheckAfter: v.number(),
        sourceUrls: v.array(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rankedResults")
      .withIndex("by_job_rank", (q) => q.eq("jobId", args.researchJobId))
      .order("asc")
      .take(20);
    await Promise.all(existing.map((row) => ctx.db.delete(row._id)));

    const now = Date.now();
    for (const ranked of args.rankedResults) {
      await ctx.db.insert("rankedResults", {
        jobId: args.researchJobId,
        category: ranked.category,
        rank: ranked.rank,
        score: ranked.score,
        title: ranked.title,
        rationale: ranked.rationale,
        verificationStatus: ranked.verificationStatus,
        verifiedAt: ranked.verifiedAt,
        recheckAfter: ranked.recheckAfter,
        sourceUrls: ranked.sourceUrls,
        createdAt: now,
        updatedAt: now,
      });
    }

    return args.rankedResults.length;
  },
});

export const runJobInternal = internalAction({
  args: {
    researchJobId: v.id("researchJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const leaseToken = createLeaseToken();
    const lease = await ctx.runMutation(internal.research.acquireJobLeaseInternal, {
      researchJobId: args.researchJobId,
      leaseToken,
      leaseMs: JOB_LEASE_DURATION_MS,
    });
    if (!lease.acquired) {
      return null;
    }

    try {
      const job = await ctx.runQuery(internal.research.getJobInternal, {
        researchJobId: args.researchJobId,
      });

      if (!job) {
        return null;
      }

      if (job.status !== "planned" && job.status !== "running") {
        return null;
      }

      const goal = await ctx.runQuery(internal.research.getProjectGoalInternal, {
        projectGoalId: job.projectGoalId,
      });
      if (!goal) {
        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "failed",
          stage: "Research failed",
          error: "Project goal not found",
          lastErrorCode: "goal_missing",
          nextRunAt: null,
        });
        return null;
      }

      const goalSlots = await ctx.runQuery(internal.research.listGoalSlotsInternal, {
        projectGoalId: goal._id,
      });

      let activeTaskKey: "plan" | "scan" | "synthesize" | undefined;

      try {
        const plannerHints =
          job.skillHintsSnapshot && job.skillHintsSnapshot.length > 0
            ? job.skillHintsSnapshot
            : await ctx.runQuery(internal.knowledge.getPlannerHintsInternal, {
                domain: goal.domain,
                asOfMs: Date.now(),
              });
        const plannerResult = await generatePlannerPlan({
          prompt: goal.prompt,
          domain: goal.domain,
          constraintSummary: goal.constraintSummary,
          plannerHints,
        });
        const plannerPlan = plannerResult.plan;

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "running",
          stage: "Planning tasks",
          progress: 8,
          attemptDelta: 1,
          startedNow: true,
          error: null,
          lastErrorCode: null,
          nextRunAt: null,
        });
        await ctx.runMutation(internal.research.addDialogueEventInternal, {
          researchJobId: args.researchJobId,
          actor: "researcher",
          kind: "status",
          message: "Started planning research tasks.",
          detail: `Domain=${goal.domain}`,
        });

        activeTaskKey = "plan";
        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "plan",
          status: "running",
          attemptDelta: 1,
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        await sleep(250);
        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "plan",
          status: "completed",
          output:
            plannerResult.mode === "llm"
              ? `Generated LLM planner strategy with ${plannerPlan.subqueries.length} query branch(es).`
              : `Planner fallback strategy active with ${plannerPlan.subqueries.length} deterministic query branch(es).`,
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        activeTaskKey = undefined;

        await ctx.runMutation(internal.research.addFindingInternal, {
          researchJobId: args.researchJobId,
          taskKey: "plan",
          title: plannerResult.mode === "llm" ? "Planner strategy generated" : "Planner fallback strategy used",
          summary: `${plannerPlan.strategy} Primary query: ${plannerPlan.primaryQuery}`,
          confidence: plannerResult.mode === "llm" ? 0.72 : 0.55,
          sourceType: "api",
        });

        if (plannerHints.length > 0) {
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "plan",
            title: "Planner hints injected",
            summary: plannerHints.slice(0, 3).join(" | "),
            confidence: 0.7,
            sourceType: "simulated",
          });
          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "researcher",
            kind: "plan",
            message: "Loaded skill planner hints.",
            detail: `hint_count=${plannerHints.length}`,
          });
        }

        await ctx.runMutation(internal.research.addDialogueEventInternal, {
          researchJobId: args.researchJobId,
          actor: "researcher",
          kind: "plan",
          message:
            plannerResult.mode === "llm"
              ? "Planner produced structured search strategy."
              : "Planner fallback strategy used due to model unavailability/validation errors.",
          detail:
            plannerResult.validationErrors.length > 0
              ? plannerResult.validationErrors.slice(0, 3).join(" | ")
              : plannerPlan.qualityGate,
        });

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          stage: "Scanning candidate sources",
          progress: 42,
        });
        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "scan",
          status: "running",
          attemptDelta: 1,
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        activeTaskKey = "scan";

        const searchQuery = plannerPlan.primaryQuery;
        let webResults: SearchLead[] = [];
        let searchProvider: "tavily" | "fallback" = "fallback";
        let extractedByUrl = new Map<string, string>();

        const runSearchRound = async (query: string, args: { maxResults: number; maxExtract: number }) => {
          try {
            const searchResponse = await searchWebWithTavily(query, args.maxResults);
            const roundResults = searchResponse.results;
            const extractTargets = roundResults.slice(0, args.maxExtract).map((result) => result.url);
            let roundExtracted = new Map<string, string>();
            if (extractTargets.length > 0) {
              const extracted = await extractWithTavily(extractTargets, query);
              roundExtracted = new Map(
                extracted.results
                  .filter((item) => !!item.rawContent)
                  .map((item) => [item.url, item.rawContent ?? ""]),
              );
            }
            return {
              results: roundResults,
              provider: searchResponse.provider,
              extractedByUrl: roundExtracted,
            };
          } catch (error) {
            const message = errorMessage(error);
            if (/TAVILY_API_KEY is not configured/i.test(message)) {
              return {
                results: [] as SearchLead[],
                provider: "fallback" as const,
                extractedByUrl: new Map<string, string>(),
              };
            }
            throw error;
          }
        };

        const firstRound = await runSearchRound(searchQuery, { maxResults: 6, maxExtract: 3 });
        webResults = firstRound.results;
        searchProvider = firstRound.provider;
        extractedByUrl = firstRound.extractedByUrl;

        const firstRoundEvidence = webResults.map((result) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          extractedSummary: summarizeExtractedContent(extractedByUrl.get(result.url)),
        }));
        const promotedFirstRound = promoteSourceEvidence(firstRoundEvidence);
        const roundOneQuality = assessResearchQuality({
          promotedSources: promotedFirstRound,
          totalSourceCount: webResults.length,
          round: 1,
        });
        let finalQuality = roundOneQuality;

        if (webResults.length > 0) {
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "scan",
            title: "Quality assessment (round 1)",
            summary: `${roundOneQuality.reason} Promoted ${promotedFirstRound.length}/${webResults.length} source(s) into compact context.`,
            confidence: clamp(roundOneQuality.score, 0.2, 0.95),
            sourceType: "api",
          });
          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "researcher",
            kind: "quality",
            message: `Round 1 quality score ${(roundOneQuality.score * 100).toFixed(0)} (${roundOneQuality.decision}).`,
            detail: roundOneQuality.reason,
          });
        }

        if (roundOneQuality.decision === "continue") {
          const followupBaseQuery = plannerPlan.fallbackQuery ?? searchQuery;
          const followupQuery = buildFollowupSearchQuery(followupBaseQuery, roundOneQuality);
          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "researcher",
            kind: "decision",
            message: "Quality gate requested a targeted continuation scan.",
            detail: `gaps=${roundOneQuality.gaps.join(",") || "coverage"}`,
          });
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "scan",
            title: "Quality gate triggered continuation round",
            summary: `Running targeted follow-up search for unresolved gaps: ${roundOneQuality.gaps.join(", ") || "coverage"}.`,
            confidence: 0.6,
            sourceType: "api",
          });

          const secondRound = await runSearchRound(followupQuery, { maxResults: 4, maxExtract: 2 });
          if (secondRound.provider === "tavily") {
            searchProvider = "tavily";
          }

          const seenUrls = new Set(webResults.map((result) => result.url));
          for (const result of secondRound.results) {
            if (!seenUrls.has(result.url)) {
              seenUrls.add(result.url);
              webResults.push(result);
            }
          }

          for (const [url, rawContent] of secondRound.extractedByUrl.entries()) {
            if (!extractedByUrl.has(url)) {
              extractedByUrl.set(url, rawContent);
            }
          }

          const secondRoundEvidence = webResults.map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            extractedSummary: summarizeExtractedContent(extractedByUrl.get(result.url)),
          }));
          const promotedSecondRound = promoteSourceEvidence(secondRoundEvidence);
          const roundTwoQuality = assessResearchQuality({
            promotedSources: promotedSecondRound,
            totalSourceCount: webResults.length,
            round: 2,
          });
          finalQuality = roundTwoQuality;

          if (webResults.length > 0) {
            await ctx.runMutation(internal.research.addFindingInternal, {
              researchJobId: args.researchJobId,
              taskKey: "scan",
              title: "Quality assessment (round 2)",
              summary: `${roundTwoQuality.reason} Promoted ${promotedSecondRound.length}/${webResults.length} source(s) into compact context.`,
              confidence: clamp(roundTwoQuality.score, 0.2, 0.95),
              sourceType: "api",
            });
            await ctx.runMutation(internal.research.addDialogueEventInternal, {
              researchJobId: args.researchJobId,
              actor: "researcher",
              kind: "quality",
              message: `Round 2 quality score ${(roundTwoQuality.score * 100).toFixed(0)} (${roundTwoQuality.decision}).`,
              detail: roundTwoQuality.reason,
            });
          }
        }

        if (webResults.length > 0) {
          await ctx.runMutation(internal.research.addSourcesInternal, {
            researchJobId: args.researchJobId,
            taskKey: "scan",
            sources: webResults.map((result, index) => ({
              rank: index + 1,
              url: result.url,
              title: result.title,
              snippet: result.snippet,
              provider: searchProvider,
            })),
          });

          const top = webResults.slice(0, 2);
          for (const result of top) {
            const extractedSummary = summarizeExtractedContent(extractedByUrl.get(result.url));
            await ctx.runMutation(internal.research.addFindingInternal, {
              researchJobId: args.researchJobId,
              taskKey: "scan",
              title: result.title,
              summary:
                extractedSummary ?? result.snippet ?? "Captured a relevant source lead for this query.",
              confidence: 0.62,
              sourceType: "web",
            });
          }

          if (extractedByUrl.size > 0) {
            await ctx.runMutation(internal.research.addFindingInternal, {
              researchJobId: args.researchJobId,
              taskKey: "scan",
              title: "Content extraction pass completed",
              summary: `Extracted enriched content from ${extractedByUrl.size} source page(s) to improve evidence quality.`,
              confidence: 0.68,
              sourceType: "web",
            });
          }
        } else {
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "scan",
            title: "Tavily scan fallback used",
            summary:
              "Tavily returned no usable search results for this run (or API key is missing). Pipeline remained healthy and created a fallback lead.",
            confidence: 0.38,
            sourceType: "simulated",
          });
        }

        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "scan",
          status: "completed",
          output:
            webResults.length > 0
              ? `Collected ${webResults.length} source leads and extracted ${extractedByUrl.size} page summaries after quality-gated scan rounds.`
              : "No parsed web leads; fallback evidence was recorded.",
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        activeTaskKey = undefined;

        const shouldRequestFlexibilityClarification =
          goal.domain === "flight"
          && webResults.length > 0
          && finalQuality.score < QUALITY_CONTINUE_THRESHOLD
          && finalQuality.gaps.includes("numeric_evidence")
          && hasProvidedGoalSlot(goalSlots, "departureDate")
          && hasProvidedGoalSlot(goalSlots, "destination")
          && !hasProvidedGoalSlot(goalSlots, "flexibilityLevel");

        if (shouldRequestFlexibilityClarification) {
          const clarification = await ctx.runMutation(internal.research.requestUserClarificationInternal, {
            researchJobId: args.researchJobId,
            requestedBy: "researcher",
            questions: [
              {
                key: "flexibilityLevel",
                question: "Are your travel dates flexible by plus or minus 3 days?",
                answerType: "boolean",
                required: true,
                reason: "Needed to widen the search window when pricing evidence is thin.",
              },
            ],
          });

          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "chatbot",
            kind: "decision",
            message: "Asked user a clarification to improve price coverage before synthesis.",
            detail: clarification.askedMessage,
          });

          return null;
        }

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "synthesizing",
          stage: "Synthesizing shortlist",
          progress: 76,
        });

        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "synthesize",
          status: "running",
          attemptDelta: 1,
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        activeTaskKey = "synthesize";

        const sourceDocs = await ctx.runQuery(internal.research.listSourcesForJobInternal, {
          researchJobId: args.researchJobId,
          limit: 6,
        });

        const sourceEvidence = sourceDocs.map((source: { title: string; url: string; snippet?: string }) => ({
          title: source.title,
          url: source.url,
          snippet: source.snippet,
          extractedSummary: summarizeExtractedContent(extractedByUrl.get(source.url)),
        }));
        const promotedEvidence = promoteSourceEvidence(sourceEvidence);
        const synthesisEvidence: SourceEvidence[] =
          promotedEvidence.length > 0
            ? promotedEvidence.map((source) => ({
                title: source.title,
                url: source.url,
                snippet: source.snippet,
                extractedSummary: source.extractedSummary,
              }))
            : sourceEvidence.slice(0, MAX_PROMOTED_CONTEXT_SOURCES);

        if (promotedEvidence.length > 0) {
          const reasons = promotedEvidence
            .map((source) => `${source.title}: ${source.signalReasons.slice(0, 3).join(",") || "general_signal"}`)
            .join(" | ");
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "synthesize",
            title: "Promoted evidence context",
            summary: `Promoted ${promotedEvidence.length}/${sourceEvidence.length} sources into synthesis context. ${reasons}`,
            confidence: clamp(
              promotedEvidence.reduce((sum, source) => sum + source.signalScore, 0) / promotedEvidence.length,
              0.3,
              0.95,
            ),
            sourceType: "api",
          });
          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "researcher",
            kind: "context",
            message: `Promoted ${promotedEvidence.length} high-signal source(s) for synthesis context.`,
            detail: reasons,
          });
        }

        const candidateDrafts = buildCandidateDrafts(
          {
            prompt: goal.prompt,
            domain: goal.domain,
            constraintSummary: goal.constraintSummary,
          },
          synthesisEvidence,
        );

        await ctx.runMutation(internal.research.replaceCandidatesInternal, {
          researchJobId: args.researchJobId,
          candidates: candidateDrafts,
        });

        const ranked = buildRankedResultsFromCandidates(candidateDrafts);
        await ctx.runMutation(internal.research.replaceRankedResultsInternal, {
          researchJobId: args.researchJobId,
          rankedResults: ranked,
        });

        await ctx.runMutation(internal.research.addFindingInternal, {
          researchJobId: args.researchJobId,
          taskKey: "synthesize",
          title: "Early shortlist shell",
          summary: createSynthesisSummary(
            synthesisEvidence.map((source) => ({ title: source.title, url: source.url })),
          ),
          confidence: synthesisEvidence.length > 0 ? 0.66 : 0.42,
          sourceType: synthesisEvidence.length > 0 ? "web" : "simulated",
        });

        await ctx.runMutation(internal.research.patchTaskInternal, {
          researchJobId: args.researchJobId,
          key: "synthesize",
          status: "completed",
          output: `Built shortlist from ${synthesisEvidence.length} promoted context source(s).`,
          error: null,
          errorCode: null,
          nextRunAt: null,
        });
        activeTaskKey = undefined;

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "verifying",
          stage: "Verifying freshness",
          progress: 92,
        });
        await sleep(200);

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "completed",
          stage: "Research complete",
          progress: 100,
          error: null,
          lastErrorCode: null,
          nextRunAt: null,
          completedNow: true,
        });
        await ctx.runMutation(internal.research.addDialogueEventInternal, {
          researchJobId: args.researchJobId,
          actor: "researcher",
          kind: "decision",
          message: "Research run completed and shortlist is ready.",
          detail: `candidates=${candidateDrafts.length}; ranked=${ranked.length}`,
        });

        return null;
      } catch (error) {
        const { code, retryable } = classifyResearchError(error);
        const message = errorMessage(error);

        if (activeTaskKey) {
          await ctx.runMutation(internal.research.patchTaskInternal, {
            researchJobId: args.researchJobId,
            key: activeTaskKey,
            status: "failed",
            error: message,
            errorCode: code,
          });
        }

        const latestJob = await ctx.runQuery(internal.research.getJobInternal, {
          researchJobId: args.researchJobId,
        });
        const attempt = latestJob?.attempt ?? job.attempt;

        if (retryable && attempt < MAX_JOB_ATTEMPTS) {
          const delayMs = computeRetryDelayMs(attempt);
          await ctx.runMutation(internal.research.scheduleRetryInternal, {
            researchJobId: args.researchJobId,
            taskKey: activeTaskKey,
            error: message,
            errorCode: code,
            delayMs,
          });
          await ctx.runMutation(internal.research.addDialogueEventInternal, {
            researchJobId: args.researchJobId,
            actor: "system",
            kind: "error",
            message: "Transient research error detected; retry scheduled.",
            detail: `code=${code}; delay_ms=${delayMs}`,
          });
          return null;
        }

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "failed",
          stage: "Research failed",
          error: message,
          lastErrorCode: code,
          nextRunAt: null,
        });
        await ctx.runMutation(internal.research.addDialogueEventInternal, {
          researchJobId: args.researchJobId,
          actor: "system",
          kind: "error",
          message: "Research run failed after retries.",
          detail: `code=${code}; message=${message.slice(0, 220)}`,
        });
        return null;
      }
    } finally {
      await ctx.runMutation(internal.research.releaseJobLeaseInternal, {
        researchJobId: args.researchJobId,
        leaseToken,
      });
    }
  },
});
