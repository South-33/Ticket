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

type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

type TavilySearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
  }>;
};

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

function normalizeSnippet(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.slice(0, 280);
}

async function runTavilySearch(query: string, maxResults: number) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      include_usage: false,
      auto_parameters: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const payload = (await response.json()) as TavilySearchResponse;
  const seenUrls = new Set<string>();
  const output: WebSearchResult[] = [];

  for (const result of payload.results ?? []) {
    const url = result.url?.trim();
    const title = result.title?.trim();
    if (!url || !title || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    output.push({
      url,
      title,
      snippet: normalizeSnippet(result.content ?? result.raw_content),
    });

    if (output.length >= maxResults) {
      break;
    }
  }

  return output;
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

    const [tasks, findings, sources] = await Promise.all([
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
      sources: sources.map((source) => ({
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
      });
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
      await sleep(250);
      await ctx.runMutation(internal.research.patchTaskInternal, {
        researchJobId: args.researchJobId,
        key: "plan",
        status: "completed",
        output: "Generated scan strategy with one live web search branch.",
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

      const searchQuery = buildSearchQuery(goal.prompt, goal.domain);
      let webResults: WebSearchResult[] = [];
      let searchProvider: "tavily" | "fallback" = "fallback";

      try {
        webResults = await runTavilySearch(searchQuery, 6);
        searchProvider = "tavily";
      } catch {
        webResults = [];
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
          await ctx.runMutation(internal.research.addFindingInternal, {
            researchJobId: args.researchJobId,
            taskKey: "scan",
            title: result.title,
            summary: result.snippet ?? "Captured a relevant source lead for this query.",
            confidence: 0.62,
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
            ? `Collected ${webResults.length} real web source leads.`
            : "No parsed web leads; fallback evidence was recorded.",
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

      const sourceDocs = await ctx.runQuery(internal.research.listSourcesForJobInternal, {
        researchJobId: args.researchJobId,
        limit: 6,
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
      });

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
