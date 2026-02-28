import { convexTest } from "convex-test";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { buildSystemPrompt, validateAssistantEnvelope } from "./chat";

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

  test("sendPrompt defers research start without forcing memory snapshot writes", async () => {
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
    expect(memory.latestSnapshot).toBeNull();
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

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
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

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
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

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
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
    vi.useFakeTimers();
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

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    const pending = await t.query(api.research.getPendingClarificationForThread, {
      threadId: created.threadId,
    });
    const threads = await t.query(api.chat.listThreads, {});
    const thread = threads.find((item) => item.threadId === created.threadId);

    expect(pending).toBeNull();
    expect(["Thanks, got it. I will continue the research now.", "I ran into a model error. Please try again in a moment."]).toContain(thread?.preview);
  });

  test("validateAssistantEnvelope accepts tool-only output when tools are present", () => {
    const parsed = validateAssistantEnvelope('<SkillOps>{"action":"load","skills":["flights"]}</SkillOps>');

    expect(parsed.errors).toEqual([]);
    expect(parsed.envelope.response).toBe("");
    expect(parsed.envelope.skillOps.action).toBe("load");
  });

  test("buildSystemPrompt includes playbook alias and user markdown disambiguation rules", () => {
    const prompt = buildSystemPrompt({
      currentTitle: "Trip planning",
      latestUserPrompt: "Can you use flights.md for this?",
      currentUtcIso: "2026-02-23T00:00:00.000Z",
      profile: null,
      confirmedFacts: [],
      preferenceHints: [],
      skillCatalog: {
        availableSkills: [
          {
            slug: "general",
            kind: "general",
            title: "General Playbook",
            summary: "Always-on guidance",
          },
        ],
        generalHints: [],
      },
      activeSkillPacks: [],
      activeSkillHints: [],
      forceDirectReply: false,
    });

    expect(prompt).toContain("treat them as playbook aliases");
    expect(prompt).toContain("analyze the user-provided content directly");
  });

  test("thread skill packs decrement per user prompt turn", async () => {
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});

    await t.mutation(api.playbooks.upsertPlaybook, {
      slug: "flights",
      title: "Flights",
      description: "flight tactics",
      kind: "flights",
      scope: "conditional",
      riskClass: "safe",
      status: "active",
      contentMarkdown: "# flights\n\nFlight playbook",
    });

    const loaded = await t.mutation(internal.chat.applySkillOpsInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
      skillOps: {
        action: "load",
        skills: ["flights"],
        ttlUserTurns: 3,
      },
    });

    expect(loaded.loaded).toEqual(["flights"]);

    await t.mutation(internal.chat.decrementThreadSkillPacksForTurnInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
    });

    const activeAfterOne = await t.query(internal.chat.getActiveThreadSkillPacksInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
    });

    expect(activeAfterOne).toHaveLength(1);
    expect(activeAfterOne[0]?.remainingUserTurns).toBe(2);

    await t.mutation(internal.chat.decrementThreadSkillPacksForTurnInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
    });
    await t.mutation(internal.chat.decrementThreadSkillPacksForTurnInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
    });

    const activeAfterExpiry = await t.query(internal.chat.getActiveThreadSkillPacksInternal, {
      threadId: created.threadId,
      userId: DEMO_USER_ID,
    });

    expect(activeAfterExpiry).toHaveLength(0);
  });
});
