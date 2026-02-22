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
    error: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    missingFields: v.optional(v.array(v.string())),
    followUpQuestion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_thread_updatedAt", ["threadId", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_promptMessageId", ["promptMessageId"]),

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

  knowledgeDocs: defineTable({
    slug: v.string(),
    title: v.string(),
    kind: v.union(v.literal("skills"), v.literal("flights"), v.literal("train"), v.literal("concert")),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    summary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_kind_status", ["kind", "status"]),

  knowledgeItems: defineTable({
    docId: v.id("knowledgeDocs"),
    key: v.string(),
    content: v.string(),
    confidence: v.number(),
    priority: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("stale")),
    sourceUrls: v.array(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_doc_status_priority", ["docId", "status", "priority"])
    .index("by_doc_updatedAt", ["docId", "updatedAt"]),

  knowledgeLinks: defineTable({
    fromDocId: v.id("knowledgeDocs"),
    toDocId: v.id("knowledgeDocs"),
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_fromDoc", ["fromDocId"])
    .index("by_toDoc", ["toDocId"]),
});
