import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { continueAwaitingJobForPrompt, createResearchJobForPrompt } from "./research";
import schema from "./schema";
import { modules } from "./test.setup";

const DEMO_USER_ID = "demo-user";
const AUTH_IDENTITY = {
  tokenIdentifier: DEMO_USER_ID,
  subject: DEMO_USER_ID,
  issuer: "https://auth.test",
};

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
  t: Pick<ReturnType<typeof convexTest>, "run">,
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const result = await t.query(api.research.getLatestJobForThread, {
      threadId: "thread-missing",
    });

    expect(result).toBeNull();
  });

  test("runJobInternal exits when another runner already holds the lease", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-lease-guard";

    const researchJobId = await seedJob(t, {
      threadId,
      status: "planned",
      withTasks: true,
    });

    const lease = await t.mutation(internal.research.acquireJobLeaseInternal, {
      researchJobId,
      leaseToken: "external-lock",
      leaseMs: 60_000,
    });
    expect(lease.acquired).toBe(true);

    await t.action(internal.research.runJobInternal, {
      researchJobId,
    });

    const state = await t.run(async (ctx) => {
      const job = await ctx.db.get("researchJobs", researchJobId);
      const tasks = await ctx.db
        .query("researchTasks")
        .withIndex("by_job_order", (q) => q.eq("jobId", researchJobId))
        .order("asc")
        .take(10);
      return { job, tasks };
    });

    expect(state.job?.status).toBe("planned");
    expect(state.job?.attempt).toBe(0);
    expect(state.tasks.every((task) => task.status === "queued")).toBe(true);
  });

  test("runs seeded job to completion with task and finding updates", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
        const stageEvents = await ctx.db
          .query("researchStageEvents")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", researchJobId))
          .order("asc")
          .take(20);
        return { job, findings, sources, candidates, rankedResults, stageEvents };
      });

      expect(persisted.job?.status).toBe("completed");
      expect(persisted.findings.length).toBeGreaterThanOrEqual(3);
      expect(persisted.findings.some((finding) => finding.sourceType === "web")).toBe(true);
      expect(persisted.sources).toHaveLength(2);
      expect(persisted.sources[0]?.provider).toBe("tavily");
      expect(persisted.candidates).toHaveLength(3);
      expect(persisted.rankedResults).toHaveLength(3);
      expect(persisted.stageEvents.length).toBeGreaterThanOrEqual(5);
      expect(persisted.stageEvents[0]?.status).toBe("running");
      expect(persisted.stageEvents.at(-1)?.status).toBe("completed");
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("derives candidate metrics from extracted evidence signals", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-evidence-signals";
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
                  title: "Direct carrier flash sale",
                  url: "https://example.com/lead-direct",
                  content: "From $412 direct flight 11h 20m baggage included",
                },
                {
                  title: "One stop value option",
                  url: "https://example.com/lead-value",
                  content: "$568 one stop 12h 45m flexible change policy",
                },
                {
                  title: "Budget layover option",
                  url: "https://example.com/lead-cheap",
                  content: "$455 two stops 15h 10m non-refundable",
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
                  url: "https://example.com/lead-direct",
                  raw_content: "Book direct on official site. Direct flight 11h 10m. $412 with carry-on included.",
                },
                {
                  url: "https://example.com/lead-value",
                  raw_content: "Flexible fare available at USD 568 with one transfer and 12h 40m travel time.",
                },
                {
                  url: "https://example.com/lead-cheap",
                  raw_content: "Two stops, 15h 5m route from $455, strict non-refundable policy.",
                },
              ],
            }),
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

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });

      expect(latest?.status).toBe("completed");
      expect(latest?.candidates).toHaveLength(3);

      const byCategory = new Map(
        (latest?.candidates ?? []).map((candidate) => [candidate.category, candidate]),
      );
      const cheapest = byCategory.get("cheapest");
      const value = byCategory.get("best_value");
      const convenient = byCategory.get("most_convenient");

      expect(cheapest?.estimatedTotalUsd).toBe(412);
      expect(value?.estimatedTotalUsd).toBe(455);
      expect(convenient?.estimatedTotalUsd).toBe(491);

      expect(convenient?.travelMinutes).toBeLessThanOrEqual(value?.travelMinutes ?? 0);
      expect(value?.travelMinutes).toBeLessThanOrEqual(cheapest?.travelMinutes ?? 0);

      expect(convenient?.transferCount).toBeLessThanOrEqual(value?.transferCount ?? 0);
      expect(value?.transferCount).toBeLessThanOrEqual(cheapest?.transferCount ?? 0);
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("falls back to baseline metrics when evidence has no numeric signals", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-evidence-fallback";
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
                  title: "Generic travel blog",
                  url: "https://example.com/no-signals",
                  content: "General travel advice without fares or schedule numbers.",
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
                  url: "https://example.com/no-signals",
                  raw_content: "Tips about airports and comfort but no price, stop, or duration values.",
                },
              ],
            }),
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

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });

      const byCategory = new Map(
        (latest?.candidates ?? []).map((candidate) => [candidate.category, candidate]),
      );

      expect(byCategory.get("cheapest")?.estimatedTotalUsd).toBe(702);
      expect(byCategory.get("best_value")?.estimatedTotalUsd).toBe(796);
      expect(byCategory.get("most_convenient")?.estimatedTotalUsd).toBe(860);
      expect(byCategory.get("most_convenient")?.transferCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("runs a targeted continuation scan when first round quality is weak", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-quality-continuation";
    const priorApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-tavily-key";

    const searchQueries: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const payload = init?.body && typeof init.body === "string"
          ? (JSON.parse(init.body) as { query?: string; urls?: string[] })
          : undefined;

        if (url.includes("api.tavily.com/search")) {
          const query = payload?.query ?? "";
          searchQueries.push(query);

          if (searchQueries.length === 1) {
            return {
              ok: true,
              json: async () => ({
                results: [
                  {
                    title: "Generic travel guide",
                    url: "https://example.com/weak-signal",
                    content: "Travel tips and destination ideas without concrete pricing.",
                  },
                ],
              }),
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  title: "Official airline flash fare",
                  url: "https://example.com/strong-signal",
                  content: "From $430 nonstop 11h 20m with carry-on included",
                },
              ],
            }),
          } as Response;
        }

        if (url.includes("api.tavily.com/extract")) {
          const extractUrls = payload?.urls ?? [];
          const results = extractUrls.map((itemUrl) => {
            if (itemUrl.includes("weak-signal")) {
              return {
                url: itemUrl,
                raw_content: "Narrative blog advice with no explicit fare or duration numbers.",
              };
            }

            return {
              url: itemUrl,
              raw_content: "Official offer from $430 direct 11h 20m with one carry-on included.",
            };
          });

          return {
            ok: true,
            json: async () => ({ results }),
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

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });
      const persisted = await t.run(async (ctx) => {
        return await ctx.db
          .query("findings")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", researchJobId))
          .order("desc")
          .take(20);
      });

      expect(latest?.status).toBe("completed");
      expect(searchQueries.length).toBeGreaterThanOrEqual(2);
      expect(searchQueries[1]).toContain("price duration layover");
      expect(latest?.sources.length).toBeGreaterThanOrEqual(2);
      expect(
        persisted.some((finding) => finding.title === "Quality gate triggered continuation round"),
      ).toBe(true);
      expect(
        persisted.some((finding) => finding.title === "Quality assessment (round 2)"),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("requests flexibility clarification when quality remains thin", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-quality-clarification";
    const priorApiKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "test-tavily-key";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const payload = init?.body && typeof init.body === "string"
          ? (JSON.parse(init.body) as { query?: string; urls?: string[] })
          : undefined;

        if (url.includes("api.tavily.com/search")) {
          const query = payload?.query ?? "";
          if (query.includes("official booking fare rules")) {
            return {
              ok: true,
              json: async () => ({
                results: [
                  {
                    title: "Weak signal source B",
                    url: "https://example.com/weak-b",
                    content: "General travel narrative without concrete fares.",
                  },
                ],
              }),
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  title: "Weak signal source A",
                  url: "https://example.com/weak-a",
                  content: "Planning advice with no prices, durations, or transfers.",
                },
              ],
            }),
          } as Response;
        }

        if (url.includes("api.tavily.com/extract")) {
          const extractUrls = payload?.urls ?? [];
          return {
            ok: true,
            json: async () => ({
              results: extractUrls.map((itemUrl) => ({
                url: itemUrl,
                raw_content: "Contextual travel writeup without actionable fare metrics.",
              })),
            }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
    );

    try {
      const started = await t.mutation(internal.research.startResearchFromOpsInternal, {
        userId: DEMO_USER_ID,
        threadId,
        promptMessageId: "pm-quality-clarification",
        prompt: "Find me options to Frankfurt",
        domain: "flight",
        selectedSkillSlugs: ["skills"],
        criteria: [
          { key: "origin", value: "Manila" },
          { key: "destination", value: "Frankfurt" },
          { key: "departureDate", value: "2026-08-11" },
          { key: "budget", value: "900" },
          { key: "nationality", value: "Filipino" },
        ],
        skillHintsSnapshot: ["[skills] Keep constraints explicit"],
      });

      expect(started.jobStatus).toBe("planned");

      await t.action(internal.research.runJobInternal, {
        researchJobId: started.researchJobId,
      });

      const latest = await t.query(api.research.getLatestJobForThread, {
        threadId,
      });
      const pending = await t.query(api.research.getPendingClarificationForThread, {
        threadId,
      });

      expect(latest?.status).toBe("awaiting_input");
      expect(latest?.followUpQuestion?.toLowerCase()).toContain("flexible");
      expect(pending).not.toBeNull();
      expect(pending?.questions[0]?.key.toLowerCase()).toBe("flexibilitylevel");
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

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

  test("startResearchFromOpsInternal requires at least one selected skill", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await expect(
      t.mutation(internal.research.startResearchFromOpsInternal, {
        userId: DEMO_USER_ID,
        threadId: "thread-start-ops-invalid",
        promptMessageId: "pm-start-ops-invalid",
        prompt: "Find me the best flight options",
        domain: "flight",
        selectedSkillSlugs: [],
        criteria: [
          { key: "origin", value: "Manila" },
          { key: "destination", value: "Frankfurt" },
          { key: "departureDate", value: "2026-08-11" },
          { key: "budget", value: "900" },
          { key: "nationality", value: "Filipino" },
        ],
        skillHintsSnapshot: [],
      }),
    ).rejects.toThrowError("At least one skill is required to start research");
  });

  test("startResearchFromOpsInternal pins selected skills and hints on new job", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const started = await t.mutation(internal.research.startResearchFromOpsInternal, {
      userId: DEMO_USER_ID,
      threadId: "thread-start-ops",
      promptMessageId: "pm-start-ops",
      prompt: "Find me flight options to Frankfurt",
      domain: "flight",
      selectedSkillSlugs: ["skills", "flights", "skills"],
      criteria: [
        { key: "origin", value: "Manila" },
        { key: "destination", value: "Frankfurt" },
        { key: "departureDate", value: "2026-08-11" },
        { key: "nationality", value: "Filipino" },
      ],
      skillHintsSnapshot: ["[skills] Verify constraints before ranking", "[flights] Compare baggage rules"],
      skillPackDigest: "skills:v1|flights:v2",
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: "thread-start-ops",
    });

    const persisted = await t.run(async (ctx) => {
      const job = await ctx.db.get(started.researchJobId);
      const goal = await ctx.db.get(started.projectGoalId);
      return { job, goal };
    });

    expect(started.jobStatus).toBe("awaiting_input");
    expect(started.missingFields).toContain("budget");
    expect(latest?.status).toBe("awaiting_input");
    expect(latest?.selectedSkillSlugs).toEqual(["skills", "flights"]);
    expect(persisted.job?.selectedSkillSlugs).toEqual(["skills", "flights"]);
    expect(persisted.job?.skillHintsSnapshot).toEqual([
      "[skills] Verify constraints before ranking",
      "[flights] Compare baggage rules",
    ]);
    expect(persisted.job?.skillPackDigest).toBe("skills:v1|flights:v2");
    expect(persisted.goal?.prompt).toContain("Research criteria:");
  });

  test("requestUserClarificationInternal pauses job with pending request", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const researchJobId = await seedJob(t, {
      threadId: "thread-clarification-request",
      status: "running",
      withTasks: true,
    });

    const created = await t.mutation(internal.research.requestUserClarificationInternal, {
      researchJobId,
      questions: [
        {
          key: "flexibilityLevel",
          question: "Are your dates flexible by +/- 3 days?",
          answerType: "boolean",
          required: true,
          reason: "Can broaden fare scan window",
        },
      ],
    });

    const state = await t.run(async (ctx) => {
      const job = await ctx.db.get(researchJobId);
      const request = await ctx.db.get(created.requestId);
      return { job, request };
    });

    expect(created.askedMessage).toContain("Quick clarification");
    expect(state.job?.status).toBe("awaiting_input");
    expect(state.job?.blockedByRequestId).toBe(created.requestId);
    expect(state.request?.status).toBe("pending");
    expect(state.request?.questions[0]?.key).toBe("flexibilityLevel");
  });

  test("submitClarificationAnswerInternal accepts answers and requeues job", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const researchJobId = await seedJob(t, {
      threadId: "thread-clarification-answer",
      status: "running",
      withTasks: true,
    });

    const created = await t.mutation(internal.research.requestUserClarificationInternal, {
      researchJobId,
      questions: [
        {
          key: "flexibilityLevel",
          question: "Are your dates flexible by +/- 3 days?",
          answerType: "boolean",
          required: true,
        },
      ],
    });

    const submitted = await t.mutation(internal.research.submitClarificationAnswerInternal, {
      requestId: created.requestId,
      answers: [
        {
          key: "flexibilityLevel",
          value: "yes",
        },
      ],
    });

    const state = await t.run(async (ctx) => {
      const job = await ctx.db.get(researchJobId);
      const request = await ctx.db.get(created.requestId);
      const slots = await ctx.db
        .query("projectGoalSlots")
        .withIndex("by_goal_status", (q) => q.eq("projectGoalId", job!.projectGoalId).eq("status", "confirmed"))
        .take(30);
      const slot = slots.find((item) => item.key.toLowerCase() === "flexibilitylevel");
      return { job, request, slot };
    });

    expect(submitted.accepted).toBe(true);
    expect(submitted.resumed).toBe(false);
    expect(state.request?.status).toBe("answered");
    expect(state.job?.status).toBe("planned");
    expect(state.job?.blockedByRequestId).toBeUndefined();
    expect(state.slot?.status).toBe("confirmed");
    expect(state.slot?.value).toBe("yes");
  });

  test("getPendingClarificationForThread returns latest pending request", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-clarification-query";
    const researchJobId = await seedJob(t, {
      threadId,
      status: "running",
      withTasks: true,
    });

    await t.mutation(internal.research.requestUserClarificationInternal, {
      researchJobId,
      questions: [
        {
          key: "preferredCabin",
          question: "Do you prefer economy, premium economy, or business?",
          answerType: "enum",
          choices: ["economy", "premium economy", "business"],
          required: true,
        },
      ],
    });

    const pending = await t.query(api.research.getPendingClarificationForThread, {
      threadId,
    });

    expect(pending).not.toBeNull();
    expect(pending?.researchJobId).toBe(researchJobId);
    expect(pending?.questions[0]?.key).toBe("preferredCabin");
  });

  test("allows manual recheck scheduling for terminal jobs", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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

  test("uses planner fallback strategy when model key is unavailable", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-planner-fallback";
    const priorGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const priorTavilyKey = process.env.TAVILY_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
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
                  title: "Fallback planner source",
                  url: "https://example.com/fallback-planner",
                  content: "Fare from $420 direct 11h 10m with one carry-on.",
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
                  url: "https://example.com/fallback-planner",
                  raw_content: "Official fare from $420 direct 11h 10m baggage included.",
                },
              ],
            }),
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

      const findings = await t.query(api.research.listFindingsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 20,
          cursor: null,
        },
      });
      const dialogue = await t.query(api.research.listDialogueEventsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 10,
          cursor: null,
        },
      });

      expect(findings.page.some((item) => item.title === "Planner fallback strategy used")).toBe(true);
      expect(
        dialogue.page.some((event) => event.kind === "plan" && event.message.toLowerCase().includes("fallback")),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      if (priorGoogleKey === undefined) {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = priorGoogleKey;
      }
      if (priorTavilyKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorTavilyKey;
      }
    }
  });

  test("paginates tasks and findings by job", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
        const stageEvents = await ctx.db
          .query("researchStageEvents")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", researchJobId))
          .order("desc")
          .take(8);
        return { job, scanTask, stageEvents };
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
      expect(state.stageEvents[0]?.status).toBe("planned");
      expect(state.stageEvents[0]?.stage).toBe("Retry scheduled");
      expect(state.stageEvents[0]?.errorCode).toBe("provider_unavailable");
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("lists stage events through paginated API", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-stage-events-api";
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
                  raw_content: "Extracted content one with richer context.",
                },
              ],
            }),
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

      const page = await t.query(api.research.listStageEventsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 3,
          cursor: null,
        },
      });

      expect(page.page.length).toBe(3);
      expect(page.page[0]?.status).toBe("completed");
      expect(page.page[0]?.createdAt).toBeGreaterThan(0);
      expect(page.continueCursor).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      if (priorApiKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = priorApiKey;
      }
    }
  });

  test("lists dialogue events through paginated API", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const threadId = "thread-dialogue-events-api";
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
                  raw_content: "Extracted content one with richer context.",
                },
              ],
            }),
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

      const page = await t.query(api.research.listDialogueEventsByJob, {
        researchJobId,
        paginationOpts: {
          numItems: 4,
          cursor: null,
        },
      });

      expect(page.page.length).toBeGreaterThan(0);
      expect(page.page[0]?.actor).toBeTruthy();
      expect(page.page[0]?.kind).toBeTruthy();
      expect(
        page.page.some((event: { kind: string }) => event.kind === "decision" || event.kind === "quality"),
      ).toBe(true);
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
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
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
