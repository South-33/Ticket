import { convexTest } from "convex-test";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
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

  test("sendPrompt stores awaiting_input job and schedules memory snapshot", async () => {
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

    expect(sent.researchJobId).toBe(latest?.researchJobId);
    expect(latest?.status).toBe("awaiting_input");
    expect(latest?.followUpQuestion).toBeTruthy();
    expect(memory.latestSnapshot).not.toBeNull();
    expect(memory.latestSnapshot?.markdown).toContain("# user.md");
  });

  test("sendPrompt resumes an awaiting_input job on follow-up details", async () => {
    vi.useFakeTimers();
    const testConvex = convexTest(schema, modules);
    registerAgentComponent(testConvex);
    const t = testConvex.withIdentity(AUTH_IDENTITY);

    const created = await t.mutation(api.chat.createThread, {});

    const first = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "I want a flight to Frankfurt",
    });

    const second = await t.mutation(api.chat.sendPrompt, {
      threadId: created.threadId,
      prompt: "From Manila to Frankfurt on 2026-08-11 budget 900 nationality is Filipino",
    });

    const latest = await t.query(api.research.getLatestJobForThread, {
      threadId: created.threadId,
    });

    expect(second.researchJobId).toBe(first.researchJobId);
    expect(latest?.status).toBe("planned");
    expect(latest?.missingFields).toHaveLength(0);
  });
});
