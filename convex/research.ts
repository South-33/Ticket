import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

function detectDomain(prompt: string) {
  const value = prompt.toLowerCase();
  const hasFlight = /(flight|airport|layover|airline|fare)/.test(value);
  const hasTrain = /(train|rail|station|eurail)/.test(value);
  const hasConcert = /(concert|show|gig|ticketmaster|seatgeek|event)/.test(value);

  const count = Number(hasFlight) + Number(hasTrain) + Number(hasConcert);
  if (count >= 2) {
    return "mixed" as const;
  }
  if (hasFlight) {
    return "flight" as const;
  }
  if (hasTrain) {
    return "train" as const;
  }
  if (hasConcert) {
    return "concert" as const;
  }
  return "general" as const;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const projectGoalId = await ctx.db.insert("projectGoals", {
    userId: args.userId,
    threadId: args.threadId,
    promptMessageId: args.promptMessageId,
    prompt: args.prompt,
    domain,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });

  const researchJobId = await ctx.db.insert("researchJobs", {
    userId: args.userId,
    threadId: args.threadId,
    promptMessageId: args.promptMessageId,
    projectGoalId,
    status: "planned",
    stage: "Queued",
    progress: 0,
    attempt: 0,
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
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert("researchTasks", {
      jobId: researchJobId,
      key: "scan",
      label: "Scan candidate sources",
      order: 1,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert("researchTasks", {
      jobId: researchJobId,
      key: "synthesize",
      label: "Synthesize shortlist",
      order: 2,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  await ctx.scheduler.runAfter(0, internal.research.runJobInternal, {
    researchJobId,
  });

  return {
    researchJobId,
    projectGoalId,
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
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      updatedAt: v.number(),
      tasks: v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          status: v.string(),
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

    const [tasks, findings] = await Promise.all([
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
    ]);

    return {
      researchJobId: selectedJob._id,
      status: selectedJob.status,
      stage: selectedJob.stage,
      progress: selectedJob.progress,
      error: selectedJob.error,
      startedAt: selectedJob.startedAt,
      completedAt: selectedJob.completedAt,
      updatedAt: selectedJob.updatedAt,
      tasks: tasks.map((task) => ({
        key: task.key,
        label: task.label,
        status: task.status,
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
    };
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
    error: v.optional(v.string()),
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
      patch.error = args.error;
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
    output: v.optional(v.string()),
    error: v.optional(v.string()),
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
    await ctx.db.patch(task._id, {
      status: args.status,
      output: args.output,
      error: args.error,
      updatedAt: now,
      startedAt: args.status === "running" ? now : task.startedAt,
      completedAt:
        args.status === "completed" ||
        args.status === "failed" ||
        args.status === "skipped" ||
        args.status === "timeout"
          ? now
          : task.completedAt,
    });
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
    if (args.taskKey) {
      const task = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_taskKey", (q) => q.eq("jobId", args.researchJobId).eq("key", args.taskKey!))
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

    try {
      await ctx.runMutation(internal.research.patchJobInternal, {
        researchJobId: args.researchJobId,
        status: "running",
        stage: "Planning tasks",
        progress: 8,
        attemptDelta: 1,
        startedNow: true,
      });

      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "plan",
        status: "running",
      });
      await sleep(450);
      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "plan",
        status: "completed",
        output: "Generated branches for route checks, deal checks, and constraints.",
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
      });
      await sleep(500);

      await ctx.runMutation(internal.research.addFindingInternal, {
        researchJobId: args.researchJobId,
        taskKey: "scan",
        title: "Nearby-airport branch detected",
        summary: "Found a lower median fare trend when allowing nearby airports for departure and arrival.",
        confidence: 0.72,
        sourceType: "simulated",
      });

      await ctx.runMutation(internal.research.addFindingInternal, {
        researchJobId: args.researchJobId,
        taskKey: "scan",
        title: "Split-ticket branch worth evaluating",
        summary: "Potential savings from split itineraries with longer layovers; needs live fare verification.",
        confidence: 0.64,
        sourceType: "simulated",
      });

      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "scan",
        status: "completed",
        output: "Collected preliminary evidence from simulated branches.",
      });

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
      });
      await sleep(500);
      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "synthesize",
        status: "completed",
        output: "Prepared ranked shortlist shell (cheapest/value/convenience).",
      });

      await ctx.runMutation(internal.research.patchJobInternal, {
        researchJobId: args.researchJobId,
        status: "verifying",
        stage: "Verifying freshness",
        progress: 92,
      });
      await sleep(350);

      await ctx.runMutation(internal.research.patchJobInternal, {
        researchJobId: args.researchJobId,
        status: "completed",
        stage: "Research complete",
        progress: 100,
        completedNow: true,
      });

      return null;
    } catch (error) {
      await ctx.runMutation(internal.research.patchJobInternal, {
        researchJobId: args.researchJobId,
        status: "failed",
        stage: "Research failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
});
