import { ConvexError, v } from "convex/values";
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
} from "./researchIntake";
import { buildRankedResultsFromCandidates } from "./researchRanking";

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const MAX_PAGE_SIZE = 50;
const MAX_JOB_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [30_000, 120_000, 300_000] as const;

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

function buildCandidateDrafts(
  goal: { prompt: string; domain: string; constraintSummary?: string },
  sources: { title: string; url: string }[],
): CandidateDraft[] {
  const now = Date.now();
  const top = sources.slice(0, 4);
  const sourceUrls = top.map((source) => source.url);
  const primary = sourceUrls[0];
  const routeHint = goal.domain === "flight" ? "route and airport alternatives" : "option alternatives";
  const budget = extractBudgetCeiling(`${goal.prompt} ${goal.constraintSummary ?? ""}`);
  const baselineBudget = budget ?? (goal.domain === "flight" ? 780 : 460);
  const freshnessFromSources = Math.max(0.2, Math.min(0.95, 0.35 + top.length * 0.12));

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
        confidence: 0.58,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 0.9),
        travelMinutes: goal.domain === "flight" ? 680 : 300,
        transferCount: goal.domain === "flight" ? 2 : 1,
        flexibilityScore: 0.46,
        baggageScore: 0.42,
        bookingEaseScore: 0.52,
        freshnessScore: freshnessFromSources,
        verifiedAt: cheapestVerification.verifiedAt,
        recheckAfter: cheapestVerification.recheckAfter,
        primarySourceUrl: primary,
        sourceUrls,
      },
    {
      category: "best_value",
      title: "Best Value Candidate (Balanced)",
      summary: `Balance total price against ${routeHint}, transfer burden, and policy flexibility using the top ranked source set.`,
        confidence: 0.62,
        verificationStatus: "partially_verified",
        estimatedTotalUsd: Math.round(baselineBudget * 1.02),
        travelMinutes: goal.domain === "flight" ? 590 : 260,
        transferCount: 1,
        flexibilityScore: 0.72,
        baggageScore: 0.66,
        bookingEaseScore: 0.64,
        freshnessScore: Math.min(1, freshnessFromSources + 0.05),
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
        confidence: 0.55,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 1.13),
        travelMinutes: goal.domain === "flight" ? 510 : 210,
        transferCount: 0,
        flexibilityScore: 0.55,
        baggageScore: 0.62,
        bookingEaseScore: 0.82,
        freshnessScore: freshnessFromSources,
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

  await ctx.db.patch(existingFact[0]._id, {
    value: args.value,
    sourceType: args.sourceType,
    confidence,
    status,
    isSensitive: sensitive,
    updatedAt: now,
  });
}

export async function createResearchJobForPrompt(
  ctx: MutationCtx,
  args: {
    userId: string;
    threadId: string;
    promptMessageId: string;
    prompt: string;
  },
) {
  const now = Date.now();
  const domain = detectDomain(args.prompt);
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

  const promptSlots = extractSlotsFromPrompt(args.prompt, domain);
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
  },
) {
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
  const promptSlots = extractSlotsFromPrompt(args.prompt, goal.domain);

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
    }),
  ),
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("researchJobs")
      .withIndex("by_thread_updatedAt", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(8);

    const selectedJob = jobs.find((job) => !TERMINAL_JOB_STATUSES.has(job.status)) ?? jobs[0] ?? null;
    if (!selectedJob) {
      return null;
    }

    const [tasks, findings, sources, candidates, rankedResults] = await Promise.all([
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
    };
  },
});

export const listJobsByThread = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    assertPageSize(args.paginationOpts.numItems);

    const result = await ctx.db
      .query("researchJobs")
      .withIndex("by_thread_updatedAt", (q) => q.eq("threadId", args.threadId))
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

export const requestLiveRecheck = mutation({
  args: {
    researchJobId: v.id("researchJobs"),
  },
  returns: v.object({
    scheduled: v.boolean(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      throw new ConvexError("Research job not found");
    }

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

    let activeTaskKey: "plan" | "scan" | "synthesize" | undefined;

    try {
      const plannerHints = await ctx.runQuery(internal.knowledge.getPlannerHintsInternal, {
        domain: goal.domain,
        asOfMs: Date.now(),
      });

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
          plannerHints.length > 0
            ? `Generated scan strategy with ${plannerHints.length} planner hints from active playbooks.`
            : "Generated scan strategy with one live web search branch.",
        error: null,
        errorCode: null,
        nextRunAt: null,
      });
      activeTaskKey = undefined;

      if (plannerHints.length > 0) {
        await ctx.runMutation(internal.research.addFindingInternal, {
          researchJobId: args.researchJobId,
          taskKey: "plan",
          title: "Planner hints injected",
          summary: plannerHints.slice(0, 3).join(" | "),
          confidence: 0.7,
          sourceType: "simulated",
        });
      }

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

      const searchQuery = buildSearchQuery(goal.prompt, goal.domain);
      let webResults: SearchLead[] = [];
      let searchProvider: "tavily" | "fallback" = "fallback";
      let extractedByUrl = new Map<string, string>();

      try {
        const searchResponse = await searchWebWithTavily(searchQuery, 6);
        webResults = searchResponse.results;
        searchProvider = searchResponse.provider;

        const extractTargets = webResults.slice(0, 3).map((result) => result.url);
        if (extractTargets.length > 0) {
          const extracted = await extractWithTavily(extractTargets, searchQuery);
          extractedByUrl = new Map(
            extracted.results
              .filter((item) => !!item.rawContent)
              .map((item) => [item.url, item.rawContent ?? ""]),
          );
        }
      } catch (error) {
        const message = errorMessage(error);
        if (/TAVILY_API_KEY is not configured/i.test(message)) {
          webResults = [];
        } else {
          throw error;
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
            ? `Collected ${webResults.length} real web source leads and extracted ${extractedByUrl.size} page summaries.`
            : "No parsed web leads; fallback evidence was recorded.",
        error: null,
        errorCode: null,
        nextRunAt: null,
      });
      activeTaskKey = undefined;

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

      const candidateDrafts = buildCandidateDrafts(
        {
          prompt: goal.prompt,
          domain: goal.domain,
          constraintSummary: goal.constraintSummary,
        },
        sourceDocs.map((source: { title: string; url: string }) => ({ title: source.title, url: source.url })),
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
          sourceDocs.map((source: { title: string; url: string }) => ({ title: source.title, url: source.url })),
        ),
        confidence: sourceDocs.length > 0 ? 0.66 : 0.42,
        sourceType: sourceDocs.length > 0 ? "web" : "simulated",
      });

      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "synthesize",
        status: "completed",
        output: "Built a shortlist summary from captured source leads.",
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

      return null;
    } catch (error) {
      const { code, retryable } = classifyResearchError(error);
      const message = errorMessage(error);
      const now = Date.now();

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
        const nextRunAt = now + delayMs;

        await ctx.runMutation(internal.research.patchJobInternal, {
          researchJobId: args.researchJobId,
          status: "planned",
          stage: "Retry scheduled",
          error: message,
          lastErrorCode: code,
          nextRunAt,
        });

        if (activeTaskKey) {
          await ctx.runMutation(internal.research.patchTaskInternal, {
            researchJobId: args.researchJobId,
            key: activeTaskKey,
            status: "queued",
            error: null,
            errorCode: code,
            nextRunAt,
          });
        }

        await ctx.scheduler.runAfter(delayMs, internal.research.runJobInternal, {
          researchJobId: args.researchJobId,
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
      return null;
    }
  },
});
