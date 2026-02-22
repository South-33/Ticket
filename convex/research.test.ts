import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    }

    return researchJobId;
  });
}

describe("research pipeline", () => {
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const html = [
          '<div class="result"><div><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdeal-1">Deal One</a><a class="result__snippet">Cheap fare lead one</a></div></div>',
          '<div class="result"><div><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdeal-2">Deal Two</a><a class="result__snippet">Cheap fare lead two</a></div></div>',
        ].join("\n");

        return {
          ok: true,
          text: async () => html,
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
        return { job, findings, sources };
      });

      expect(persisted.job?.status).toBe("completed");
      expect(persisted.findings.length).toBeGreaterThanOrEqual(3);
      expect(persisted.findings.some((finding) => finding.sourceType === "web")).toBe(true);
      expect(persisted.sources).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
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
});
