import { convexTest } from "convex-test";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const DEMO_USER_ID = "demo-user";

describe("chat intake flow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sendPrompt stores awaiting_input job and schedules memory snapshot", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    registerAgentComponent(t);

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
    const memory = await t.query(api.memory.getUserMemory, {
      userId: DEMO_USER_ID,
    });

    expect(sent.researchJobId).toBe(latest?.researchJobId);
    expect(latest?.status).toBe("awaiting_input");
    expect(latest?.followUpQuestion).toBeTruthy();
    expect(memory.latestSnapshot).not.toBeNull();
    expect(memory.latestSnapshot?.markdown).toContain("# user.md");
  });
});
