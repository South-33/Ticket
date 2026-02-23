import { convexTest } from "convex-test";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const DEMO_USER_ID = "demo-user";
const AUTH_IDENTITY = {
  tokenIdentifier: DEMO_USER_ID,
  subject: DEMO_USER_ID,
  issuer: "https://auth.test",
};

describe("chat intake flow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sendPrompt defers research start and still schedules memory snapshot", async () => {
    vi.useFakeTimers();
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});

    const sent = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "I want a flight to Frankfurt",
    });

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: created.threadId,
    });
    const memory = await t.query(api.memory.getUserMemory, {});

    expect(sent.researchJobId).toBeNull();
    expect(latest).toBeNull();
    expect(memory.latestSnapshot).not.toBeNull();
    expect(memory.latestSnapshot?.markdown).toContain("# user.md");
  });

  test("sendPrompt does not create research job until ResearchOps.start", async () => {
    vi.useFakeTimers();
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});

    const first = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "I want a flight to Frankfurt",
    });
    const latestAfterFirst = await t.query(api.research.getLatestJobForThread, {
      threadId: created.threadId,
    });

    const second = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "From Manila to Frankfurt on 2026-08-11 budget 900 nationality is Filipino",
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: created.threadId,
    });

    expect(first.researchJobId).toBeNull();
    expect(second.researchJobId).toBeNull();
    expect(latestAfterFirst).toBeNull();
    expect(latest).toBeNull();
  });

  test("sendPrompt does not create research job for non-research small talk", async () => {
    vi.useFakeTimers();
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});
    const sent = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "hello",
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: created.threadId,
    });

    expect(sent.researchJobId).toBeNull();
    expect(latest).toBeNull();
  });

  test("sendPrompt does not overwrite confirmed sensitive memory with inferred slots", async () => {
    vi.useFakeTimers();
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "nationality",
      value: "Filipino",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: true,
    });

    const created = await t.mutation(api.chat.createThread, {});
    await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "Need a flight from Manila to Tokyo on 2026-11-03 budget 850 nationality is Canadian",
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    const nationality = memory.facts.find((fact: { key: string }) => fact.key === "nationality");

    expect(nationality?.value).toBe("Filipino");
    expect(nationality?.sourceType).toBe("user_confirmed");
    expect(nationality?.status).toBe("confirmed");
  });

  test("setThreadTitleFromToolInternal accepts immediate consecutive renames", async () => {
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});

    const firstRename = await t.mutation(internal.chat.setThreadTitleFromToolInternal, {
      threadId: created.threadId,
      title: "Trip to paris on friday",
    });
    const secondRename = await t.mutation(internal.chat.setThreadTitleFromToolInternal, {
      threadId: created.threadId,
      title: "Cheapest Manila to Tokyo Flight",
    });
    const threads = await t.query(api.chat.listThreads, {});
    const thread = threads.find((item) => item.threadId === created.threadId);

    expect(firstRename.changed).toBe(true);
    expect(firstRename.title).toBe("Paris Trip for Friday");
    expect(secondRename.changed).toBe(true);
    expect(thread?.title).toBe("Cheapest Manila to Tokyo Flight");
  });

  test("postPendingClarificationPromptInternal mirrors pending clarification into chat", async () => {
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});
    const started = await t.mutation(internal.research.startResearchFromOpsInternal, {
      userId: DEMO_USER_ID,
      threadId: created.threadId,
      promptMessageId: "pm-clarification-immediate",
      prompt: "Find me flight options to Frankfurt",
      domain: "flight",
      selectedSkillSlugs: ["general"],
      criteria: [
        { key: "origin", value: "Manila" },
        { key: "destination", value: "Frankfurt" },
        { key: "departureDate", value: "2026-08-11" },
      ],
      skillHintsSnapshot: ["[general] Keep constraints explicit"],
    });

    const pendingRequest = await t.mutation(internal.research.requestUserClarificationInternal, {
      researchJobId: started.researchJobId,
      questions: [
        {
          key: "flexibilityLevel",
          question: "Are your dates flexible by +/- 3 days?",
          answerType: "boolean",
          required: true,
        },
      ],
    });

    const posted = await t.action(internal.chat.postPendingClarificationPromptInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
      requestId: pendingRequest.requestId,
    });

    const pending = await t.query(api.research.getPendingClarificationForThread, {
      threadId: created.threadId,
    });
    const threads = await t.query(api.chat.listThreads, {});
    const thread = threads.find((item) => item.threadId === created.threadId);

    expect(posted.posted).toBe(true);
    expect(pending).not.toBeNull();
    expect(thread?.preview).toContain("Quick clarification before I continue");
  });

  test("generateReplyInternal routes single-question clarification answers and resumes research", async () => {
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});
    const started = await t.mutation(internal.research.startResearchFromOpsInternal, {
      userId: DEMO_USER_ID,
      threadId: created.threadId,
      promptMessageId: "pm-clarification-start",
      prompt: "Find me flight options to Frankfurt",
      domain: "flight",
      selectedSkillSlugs: ["general"],
      criteria: [
        { key: "origin", value: "Manila" },
        { key: "destination", value: "Frankfurt" },
        { key: "departureDate", value: "2026-08-11" },
        { key: "budget", value: "900" },
        { key: "nationality", value: "Filipino" },
      ],
      skillHintsSnapshot: ["[general] Keep constraints explicit"],
    });

    await t.mutation(internal.research.requestUserClarificationInternal, {
      researchJobId: started.researchJobId,
      questions: [
        {
          key: "flexibilityLevel",
          question: "Are your dates flexible by +/- 3 days?",
          answerType: "boolean",
          required: true,
        },
      ],
    });

    const sent = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "yes",
    });

    await t.action(internal.chat.generateReplyInternal, {
      threadId: created.threadId,
      promptMessageId: sent.promptMessageId,
      prompt: "yes",
    });

    const pending = await t.query(api.research.getPendingClarificationForThread, {
      threadId: created.threadId,
    });
    const threads = await t.query(api.chat.listThreads, {});
    const thread = threads.find((item) => item.threadId === created.threadId);

    expect(pending).toBeNull();
    expect(thread?.preview).toContain("Thanks, got it");
  });
});
