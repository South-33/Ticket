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
      v.literal("ready"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_thread_updatedAt", ["threadId", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_promptMessageId", ["promptMessageId"]),

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
});
