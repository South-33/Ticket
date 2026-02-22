import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { continueAwaitingJobForPrompt, createResearchJobForPrompt } from "./research";
import schema from "./schema";
import { modules } from "./test.setup";

const DEMO_USER_ID = "demo-user";

type JobStatus =
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

async function seedJob(
  t: ReturnType<typeof convexTest>,
  args?: {
    threadId?: string;
    promptMessageId?: string;
    status?: JobStatus;
    attempt?: number;
    withTasks?: boolean;
    updatedAt?: number;
  },
) {
  const threadId = args?.threadId ?? "thread-default";
  const promptMessageId = args?.promptMessageId ?? `pm-${Math.random().toString(16).slice(2)}`;
  const status = args?.status ?? "planned";
  const attempt = args?.attempt ?? 0;
  const withTasks = args?.withTasks ?? true;
  const updatedAt = args?.updatedAt;

  return await t.run(async (ctx) => {
    const now = Date.now();
    const projectGoalId = await ctx.db.insert("projectGoals", {
      userId: DEMO_USER_ID,
      threadId,
      promptMessageId,
      prompt: "Need a cheaper route with one carry-on",
      domain: "flight",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const researchJobId = await ctx.db.insert("researchJobs", {
      userId: DEMO_USER_ID,
      threadId,
      promptMessageId,
      projectGoalId,
      status,
      stage: "Seeded",
      progress: 0,
      attempt,
      createdAt: now,
      updatedAt: updatedAt ?? now,
    });

    if (withTasks) {
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
    }

    return researchJobId;
  });
}

describe("research pipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns null for threads without jobs", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.research.getLatestJobForThread, {
      threadId: "thread-missing",
    });

    expect(result).toBeNull();
  });

  test("runs seeded job to completion with task and finding updates", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-flow";
    const priorApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-tavily-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.tavily.com/search")) {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  title: "Deal One",
                  url: "https://example.com/deal-1",
                  content: "Cheap fare lead one",
                },
                {
                  title: "Deal Two",
                  url: "https://example.com/deal-2",
                  content: "Cheap fare lead two",
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("api.tavily.com/extract")) {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  url: "https://example.com/deal-1",
                  raw_content: "Extracted content one with richer context and fee caveats.",
                },
                {
                  url: "https://example.com/deal-2",
                  raw_content: "Extracted content two with baggage and timing caveats.",
                },
              ],
            }),
          } as Response;
        }

        if (url.includes("api.tavily.com")) {
          throw new Error(`Unexpected fetch url in test: ${url}`);
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
    );

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });
      expect(latest).not.toBeNull();
      expect(latest?.status).toBe("completed");
      expect(latest?.progress).toBe(100);
      expect(latest?.tasks).toHaveLength(3);
      expect(latest?.tasks.every((task: { status: string }) => task.status === "completed")).toBe(true);
      expect(latest?.findings.length).toBeGreaterThanOrEqual(3);
      expect(latest?.sources).toHaveLength(2);
      expect(latest?.sources[0]?.url).toContain("example.com/deal-1");
      expect(latest?.sources[0]?.provider).toBe("tavily");
      expect(latest?.candidates).toHaveLength(3);
      expect(latest?.rankedResults).toHaveLength(3);
      expect(latest?.candidates[0]?.estimatedTotalUsd).toBeGreaterThan(0);
      expect(latest?.candidates[0]?.recheckAfter).toBeGreaterThan(0);
      expect(latest?.rankedResults[0]?.recheckAfter).toBeGreaterThan(0);
      expect(
        latest?.findings.some(
          (finding: { title: string }) => finding.title === "Content extraction pass completed",
        ),
      ).toBe(true);

      const persisted = await t.run(async (ctx) => {
        const job = await ctx.db.get("researchJobs", researchJobId);
        const findings = await ctx.db
          .query("findings")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", researchJobId))
          .order("asc")
          .take(10);
        const sources = await ctx.db
          .query("sources")
          .withIndex("by_job_rank", (q) => q.eq("jobId", researchJobId))
          .order("asc")
          .take(10);
        const candidates = await ctx.db
          .query("candidates")
          .withIndex("by_job_updatedAt", (q) => q.eq("jobId", researchJobId))
          .order("desc")
          .take(10);
        const rankedResults = await ctx.db
          .query("rankedResults")
          .withIndex("by_job_rank", (q) => q.eq("jobId", researchJobId))
          .order("asc")
          .take(10);
        return { job, findings, sources, candidates, rankedResults };
      });

      expect(persisted.job?.status).toBe("completed");
      expect(persisted.findings.length).toBeGreaterThanOrEqual(3);
      expect(persisted.findings.some((finding) => finding.sourceType === "web")).toBe(true);
      expect(persisted.sources).toHaveLength(2);
      expect(persisted.sources[0]?.provider).toBe("tavily");
      expect(persisted.candidates).toHaveLength(3);
      expect(persisted.rankedResults).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("does not rerun terminal jobs", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-terminal";
    const researchJobId = await seedJob(t, {
      threadId,
      status: "completed",
      attempt: 4,
      withTasks: false,
      updatedAt: 123,
    });

    await t.action(internal.research.runJobInternal, {
      researchJobId,
    });

    const after = await t.run(async (ctx) => {
      return await ctx.db.get("researchJobs", researchJobId);
    });

    expect(after?.status).toBe("completed");
    expect(after?.attempt).toBe(4);
    expect(after?.updatedAt).toBe(123);
  });

  test("prefers active jobs over terminal jobs for latest query", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-priority";

    await seedJob(t, {
      threadId,
      status: "completed",
      updatedAt: 200,
    });
    const runningJobId = await seedJob(t, {
      threadId,
      status: "running",
      updatedAt: 100,
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId,
    });

    expect(latest?.researchJobId).toBe(runningJobId);
    expect(latest?.status).toBe("running");
  });

  test("throws when patching a missing task", async () => {
    const t = convexTest(schema, modules);
    const researchJobId = await seedJob(t, {
      threadId: "thread-error",
      withTasks: false,
    });

    await expect(
      t.mutation(internal.research.patchTaskInternal, {
        researchJobId: researchJobId as Id<"researchJobs">,
        key: "missing-task",
        status: "running",
      }),
    ).rejects.toThrowError("Research task not found");
  });

  test("falls back safely when Tavily key is missing", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-no-key";
    const priorApiKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });

      expect(latest?.status).toBe("completed");
      expect(latest?.sources).toHaveLength(0);
      expect(latest?.candidates).toHaveLength(3);
      expect(latest?.rankedResults).toHaveLength(3);
      expect(
        latest?.findings.some((finding: { title: string }) => finding.title === "Tavily scan fallback used"),
      ).toBe(true);
    } finally {
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("creates awaiting_input job when required slots are missing", async () => {
    const t = convexTest(schema, modules);

    const created = await t.run(async (ctx) => {
      return await createResearchJobForPrompt(ctx as unknown as MutationCtx, {
        userId: DEMO_USER_ID,
        threadId: "thread-intake",
        promptMessageId: "pm-intake",
        prompt: "I want a flight to Frankfurt",
      });
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: "thread-intake",
    });

    expect(created.jobStatus).toBe("awaiting_input");
    expect(created.missingFields.length).toBeGreaterThan(0);
    expect(latest?.status).toBe("awaiting_input");
    expect(latest?.followUpQuestion).toBeTruthy();
    expect(latest?.missingFields?.length).toBeGreaterThan(0);
  });

  test("continues awaiting_input job and auto-resumes when slots are provided", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);

    const created = await t.run(async (ctx) => {
      return await createResearchJobForPrompt(ctx as unknown as MutationCtx, {
        userId: DEMO_USER_ID,
        threadId: "thread-resume",
        promptMessageId: "pm-resume-1",
        prompt: "I want a flight to Frankfurt",
      });
    });

    const continued = await t.run(async (ctx) => {
      return await continueAwaitingJobForPrompt(ctx as unknown as MutationCtx, {
        userId: DEMO_USER_ID,
        threadId: "thread-resume",
        promptMessageId: "pm-resume-2",
        prompt: "From Manila to Frankfurt on 2026-08-11 budget 900 nationality is Filipino",
      });
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: "thread-resume",
    });

    expect(continued).not.toBeNull();
    expect(continued?.researchJobId).toBe(created.researchJobId);
    expect(continued?.jobStatus).toBe("planned");
    expect(continued?.missingFields).toHaveLength(0);
    expect(latest?.status).toBe("planned");
    expect(latest?.missingFields).toHaveLength(0);
  });

  test("allows manual recheck scheduling for terminal jobs", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const researchJobId = await seedJob(t, {
      threadId: "thread-manual-recheck",
      status: "completed",
      withTasks: true,
    });

    const requested = await t.mutation(api.research.requestLiveRecheck, {
      researchJobId,
    });

    const jobState = await t.run(async (ctx) => {
      const job = await ctx.db.get("researchJobs", researchJobId);
      const tasks = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_order", (q) => q.eq("jobId", researchJobId))
        .order("asc")
        .take(10);
      return { job, tasks };
    });

    expect(requested.scheduled).toBe(true);
    expect(requested.status).toBe("planned");
    expect(jobState.job?.status).toBe("planned");
    expect(jobState.job?.stage).toBe("Manual live recheck queued");
    expect(jobState.tasks.every((task) => task.status === "queued")).toBe(true);
  });

  test("paginates jobs and enforces page-size limits", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-pagination-jobs";

    await seedJob(t, { threadId, status: "completed", updatedAt: 100 });
    await seedJob(t, { threadId, status: "running", updatedAt: 200 });
    await seedJob(t, { threadId, status: "planned", updatedAt: 300 });

    const first = await t.query(api.research.listJobsByThread, {
      threadId,
      paginationOpts: {
        numItems: 2,
        cursor: null,
      },
    });

    expect(first.page).toHaveLength(2);
    expect(first.page[0]?.status).toBe("planned");
    expect(first.page[1]?.status).toBe("running");
    expect(first.isDone).toBe(false);

    const second = await t.query(api.research.listJobsByThread, {
      threadId,
      paginationOpts: {
        numItems: 2,
        cursor: first.continueCursor,
      },
    });

    expect(second.page).toHaveLength(1);
    expect(second.page[0]?.status).toBe("completed");
    expect(second.isDone).toBe(true);

    await expect(
      t.query(api.research.listJobsByThread, {
        threadId,
        paginationOpts: {
          numItems: 51,
          cursor: null,
        },
      }),
    ).rejects.toThrowError("paginationOpts.numItems must be between 1 and 50");
  });

  test("injects knowledge planner hints into plan findings", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-knowledge";
    const researchJobId = await seedJob(t, {
      threadId,
      status: "planned",
      withTasks: true,
    });

    await t.run(async (ctx) => {
      const now = Date.now();
      const docId = await ctx.db.insert("knowledgeDocs", {
        slug: "flights-core",
        title: "Flights Core",
        kind: "flights",
        status: "active",
        summary: "Flight booking playbook",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("knowledgeItems", {
        docId,
        key: "fare-rule",
        content: "Prefer direct carriers first for hidden-fee detection.",
        confidence: 0.84,
        priority: 90,
        status: "active",
        sourceUrls: ["https://example.com/playbook"],
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.action(internal.research.runJobInternal, {
      researchJobId,
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId,
    });

    expect(
      latest?.findings.some((finding: { title: string }) => finding.title === "Planner hints injected"),
    ).toBe(true);
  });

  test("paginates ranked results by job", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-ranked-pagination";
    const priorApiKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const first = await t.query(api.research.listRankedResultsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      });

      expect(first.page).toHaveLength(2);
      expect(first.page[0]?.rank).toBe(1);
      expect(first.page[1]?.rank).toBe(2);
      expect(first.isDone).toBe(false);

      const second = await t.query(api.research.listRankedResultsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 2,
          cursor: first.continueCursor,
        },
      });

      expect(second.page).toHaveLength(1);
      expect(second.page[0]?.rank).toBe(3);
      expect(second.isDone).toBe(true);
    } finally {
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("paginates tasks and findings by job", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-task-finding-pagination";
    const priorApiKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const taskPage = await t.query(api.research.listTasksByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      });

      expect(taskPage.page).toHaveLength(2);
      expect(taskPage.page[0]?.order).toBe(0);
      expect(taskPage.page[1]?.order).toBe(1);

      const findingPage = await t.query(api.research.listFindingsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      });

      expect(findingPage.page.length).toBeGreaterThan(0);
      expect(findingPage.page.length).toBeLessThanOrEqual(2);
      expect(findingPage.page[0]?.title).toBeTruthy();
    } finally {
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("schedules retry metadata on transient provider failure", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-retry-once";
    const priorApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-tavily-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.tavily.com/search")) {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
    );

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const state = await t.run(async (ctx) => {
        const job = await ctx.db.get("researchJobs", researchJobId);
        const scanTask = await ctx.db
          .query("researchTasks")
          .withIndex("by_job_taskKey", (q) => q.eq("jobId", researchJobId).eq("key", "scan"))
          .unique();
        return { job, scanTask };
      });

      expect(state.job?.status).toBe("planned");
      expect(state.job?.stage).toBe("Retry scheduled");
      expect(state.job?.attempt).toBe(1);
      expect(state.job?.lastErrorCode).toBe("provider_unavailable");
      expect(state.job?.nextRunAt).toBeGreaterThan(Date.now());

      expect(state.scanTask?.status).toBe("queued");
      expect(state.scanTask?.attempt).toBe(1);
      expect(state.scanTask?.errorCode).toBe("provider_unavailable");
      expect(state.scanTask?.nextRunAt).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("fails terminally after max retry attempts", async () => {
    const t = convexTest(schema, modules);
    const threadId = "thread-retry-terminal";
    const priorApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-tavily-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("api.tavily.com/search")) {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
    );

    try {
      const researchJobId = await seedJob(t, {
        threadId,
        status: "planned",
        withTasks: true,
      });

      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });
      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });
      await t.action(internal.research.runJobInternal, {
        researchJobId,
      });

      const job = await t.run(async (ctx) => {
        return await ctx.db.get("researchJobs", researchJobId);
      });

      expect(job?.status).toBe("failed");
      expect(job?.attempt).toBe(3);
      expect(job?.lastErrorCode).toBe("provider_unavailable");
      expect(job?.nextRunAt).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });
});
