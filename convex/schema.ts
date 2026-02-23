import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  threadState: defineTable({
    threadId: v.string(),
    userId: v.string(),
    title: v.string(),
    titleUpdatedAt: v.optional(v.number()),
    preview: v.string(),
    lastMessageAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_user_lastMessageAt", ["userId", "lastMessageAt"]),

  threadSkillPacks: defineTable({
    threadId: v.string(),
    userId: v.string(),
    skillSlug: v.string(),
    status: v.union(v.literal("active"), v.literal("expired")),
    totalUserTurns: v.number(),
    remainingUserTurns: v.number(),
    loadedAt: v.number(),
    refreshedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_thread_status_updatedAt", ["threadId", "status", "updatedAt"])
    .index("by_thread_skill", ["threadId", "skillSlug"])
    .index("by_user_thread_status_updatedAt", ["userId", "threadId", "status", "updatedAt"]),

  projectGoals: defineTable({
    userId: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
    prompt: v.string(),
    domain: v.union(
      v.literal("flight"),
      v.literal("train"),
      v.literal("concert"),
      v.literal("mixed"),
      v.literal("general"),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("awaiting_input"),
      v.literal("ready"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    mode: v.optional(v.union(v.literal("fast"), v.literal("balanced"), v.literal("deep"))),
    missingFields: v.optional(v.array(v.string())),
    followUpQuestion: v.optional(v.string()),
    constraintSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_promptMessageId", ["promptMessageId"]),

  researchJobs: defineTable({
    userId: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
    projectGoalId: v.id("projectGoals"),
    status: v.union(
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
    stage: v.string(),
    progress: v.number(),
    attempt: v.number(),
    runLeaseToken: v.optional(v.string()),
    runLeaseExpiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    missingFields: v.optional(v.array(v.string())),
    followUpQuestion: v.optional(v.string()),
    selectedSkillSlugs: v.optional(v.array(v.string())),
    skillHintsSnapshot: v.optional(v.array(v.string())),
    skillPackDigest: v.optional(v.string()),
    blockedByRequestId: v.optional(v.id("researchClarificationRequests")),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_thread_updatedAt", ["threadId", "updatedAt"])
    .index("by_user_thread_updatedAt", ["userId", "threadId", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_promptMessageId", ["promptMessageId"]),

  researchClarificationRequests: defineTable({
    jobId: v.id("researchJobs"),
    userId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("pending"), v.literal("answered"), v.literal("expired"), v.literal("cancelled")),
    requestedBy: v.union(v.literal("researcher"), v.literal("system")),
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
    answers: v.optional(
      v.array(
        v.object({
          key: v.string(),
          value: v.string(),
        }),
      ),
    ),
    askedMessage: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    answeredAt: v.optional(v.number()),
  })
    .index("by_job_createdAt", ["jobId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_thread_status_createdAt", ["threadId", "status", "createdAt"]),

  researchStageEvents: defineTable({
    jobId: v.id("researchJobs"),
    userId: v.string(),
    threadId: v.string(),
    status: v.union(
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
    stage: v.string(),
    progress: v.number(),
    attempt: v.number(),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_job_createdAt", ["jobId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"]),

  researchDialogueEvents: defineTable({
    jobId: v.id("researchJobs"),
    userId: v.string(),
    threadId: v.string(),
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
    createdAt: v.number(),
  })
    .index("by_job_createdAt", ["jobId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_actor_createdAt", ["actor", "createdAt"]),

  projectGoalSlots: defineTable({
    projectGoalId: v.id("projectGoals"),
    key: v.string(),
    value: v.optional(v.string()),
    status: v.union(v.literal("missing"), v.literal("provided"), v.literal("confirmed")),
    sourceType: v.union(v.literal("prompt"), v.literal("memory"), v.literal("user_confirmed")),
    isSensitive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_goal_key", ["projectGoalId", "key"])
    .index("by_goal_status", ["projectGoalId", "status"]),

  researchTasks: defineTable({
    jobId: v.id("researchJobs"),
    key: v.string(),
    label: v.string(),
    order: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("timeout"),
    ),
    output: v.optional(v.string()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    attempt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_job_order", ["jobId", "order"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_taskKey", ["jobId", "key"]),

  findings: defineTable({
    jobId: v.id("researchJobs"),
    taskId: v.optional(v.id("researchTasks")),
    title: v.string(),
    summary: v.string(),
    confidence: v.number(),
    sourceType: v.union(v.literal("simulated"), v.literal("web"), v.literal("api")),
    createdAt: v.number(),
  }).index("by_job_createdAt", ["jobId", "createdAt"]),

  sources: defineTable({
    jobId: v.id("researchJobs"),
    taskId: v.optional(v.id("researchTasks")),
    rank: v.number(),
    url: v.string(),
    title: v.string(),
    snippet: v.optional(v.string()),
    provider: v.union(v.literal("tavily"), v.literal("fallback")),
    createdAt: v.number(),
  })
    .index("by_job_rank", ["jobId", "rank"])
    .index("by_job_createdAt", ["jobId", "createdAt"]),

  candidates: defineTable({
    jobId: v.id("researchJobs"),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_category", ["jobId", "category"])
    .index("by_job_updatedAt", ["jobId", "updatedAt"]),

  rankedResults: defineTable({
    jobId: v.id("researchJobs"),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_rank", ["jobId", "rank"])
    .index("by_job_category", ["jobId", "category"]),

  userProfiles: defineTable({
    userId: v.string(),
    displayName: v.optional(v.string()),
    homeCity: v.optional(v.string()),
    homeAirport: v.optional(v.string()),
    nationality: v.optional(v.string()),
    ageBand: v.optional(v.string()),
    budgetBand: v.optional(v.string()),
    preferredCabin: v.optional(v.string()),
    flexibilityLevel: v.optional(v.string()),
    loyaltyPrograms: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  userMemoryFacts: defineTable({
    userId: v.string(),
    key: v.string(),
    value: v.string(),
    sourceType: v.union(v.literal("user_confirmed"), v.literal("inferred"), v.literal("imported")),
    confidence: v.number(),
    status: v.union(
      v.literal("proposed"),
      v.literal("confirmed"),
      v.literal("rejected"),
      v.literal("stale"),
    ),
    isSensitive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_key", ["userId", "key"])
    .index("by_user_status_updatedAt", ["userId", "status", "updatedAt"]),

  userMemorySnapshots: defineTable({
    userId: v.string(),
    version: v.number(),
    markdown: v.string(),
    createdAt: v.number(),
  }).index("by_user_createdAt", ["userId", "createdAt"]),

  userPreferenceNotes: defineTable({
    userId: v.string(),
    key: v.string(),
    value: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_key", ["userId", "key"])
    .index("by_user_updatedAt", ["userId", "updatedAt"]),

  memoryOpAuditEvents: defineTable({
    userId: v.string(),
    threadId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    action: v.union(v.literal("add"), v.literal("update"), v.literal("delete"), v.literal("noop")),
    store: v.union(v.literal("fact"), v.literal("preference"), v.literal("profile")),
    key: v.string(),
    value: v.optional(v.string()),
    confidence: v.number(),
    outcome: v.union(v.literal("applied"), v.literal("skipped")),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"]),

  assistantEnvelopeValidationEvents: defineTable({
    userId: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
    attempt: v.number(),
    valid: v.boolean(),
    errorCount: v.number(),
    errors: v.array(v.string()),
    contractVersionSeen: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_user_createdAt", ["userId", "createdAt"]),

  playbooks: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(
      v.literal("general"),
      v.literal("flights"),
      v.literal("train"),
      v.literal("concert"),
      v.literal("flights_grey_tactics"),
    ),
    scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
    riskClass: v.union(v.literal("safe"), v.literal("grey")),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    contentMarkdown: v.string(),
    sourceFile: v.optional(v.string()),
    createdByUserId: v.optional(v.string()),
    updatedByUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_kind_status_updatedAt", ["kind", "status", "updatedAt"])
    .index("by_scope_status_updatedAt", ["scope", "status", "updatedAt"]),
});
