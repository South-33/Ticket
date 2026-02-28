import { describe, expect, test } from "vitest";
import type { UIMessage } from "@convex-dev/agent/react";
import {
  buildLatestTurnSnapshot,
  getMessageIdentity,
  resolveSelectedVariantId,
  type AssistantVariant,
} from "./latest-turn";

function makeMessage(args: {
  id: string;
  role: "user" | "assistant" | "system";
  status?: UIMessage["status"];
  text?: string;
  order: number;
  stepOrder?: number;
  reasoning?: string;
}) {
  const parts: UIMessage["parts"] = args.reasoning
    ? [{ type: "reasoning", text: args.reasoning } as UIMessage["parts"][number]]
    : [{ type: "text", text: args.text ?? "" } as UIMessage["parts"][number]];

  return {
    id: args.id,
    role: args.role,
    parts,
    key: `k-${args.id}`,
    order: args.order,
    stepOrder: args.stepOrder ?? 0,
    status: args.status ?? "success",
    agentName: "chat",
    text: args.text ?? "",
    _creationTime: args.order,
  } as unknown as UIMessage;
}

describe("latest-turn", () => {
  const makeVariant = (id: string): AssistantVariant => ({
    id,
    message: makeMessage({ id: `m-${id}`, role: "assistant", order: 1, text: id }),
    isTransient: false,
    hasRenderableContent: true,
    hasReasoning: false,
  });

  test("builds persisted/transient variants for latest user turn", () => {
    const messages: UIMessage[] = [
      makeMessage({ id: "u1", role: "user", order: 1, text: "hi" }),
      makeMessage({ id: "a1", role: "assistant", order: 1, text: "one" }),
      makeMessage({ id: "u2", role: "user", order: 2, text: "retry me" }),
      makeMessage({ id: "a2", role: "assistant", order: 2, text: "old", status: "success" }),
      makeMessage({ id: "a3", role: "assistant", order: 2, text: "", status: "pending" }),
    ];

    const snapshot = buildLatestTurnSnapshot(messages);

    expect(snapshot.latestUserMessage?.id).toBe("u2");
    expect(snapshot.historyMessages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(snapshot.persistedVariants.map((variant) => variant.id)).toEqual(["a2"]);
    expect(snapshot.transientVariants.map((variant) => variant.id)).toEqual(["a3"]);
    expect(snapshot.latestPersistedVariant?.id).toBe("a2");
    expect(snapshot.latestTransientVariant?.id).toBe("a3");
  });

  test("treats reasoning-only assistant as renderable persisted variant", () => {
    const messages: UIMessage[] = [
      makeMessage({ id: "u1", role: "user", order: 1, text: "hi" }),
      makeMessage({ id: "a1", role: "assistant", order: 1, text: "", reasoning: "Thinking" }),
    ];

    const snapshot = buildLatestTurnSnapshot(messages);
    expect(snapshot.persistedVariants).toHaveLength(1);
    expect(snapshot.persistedVariants[0]?.hasReasoning).toBe(true);
  });

  test("resolves selected id deterministically", () => {
    const variants = [
      makeVariant("a1"),
      makeVariant("a2"),
    ];

    expect(resolveSelectedVariantId({ previousSelectedVariantId: null, persistedVariants: variants })).toBe("a2");
    expect(resolveSelectedVariantId({ previousSelectedVariantId: "a1", persistedVariants: variants })).toBe("a1");
    expect(
      resolveSelectedVariantId({
        previousSelectedVariantId: "missing",
        persistedVariants: variants,
      }),
    ).toBe("a2");
    expect(
      resolveSelectedVariantId({
        previousSelectedVariantId: "a1",
        persistedVariants: [...variants, makeVariant("a3")],
        freezeAutoLatest: true,
        previousVariantCount: 2,
      }),
    ).toBe("a1");
  });

  test("falls back to key when id missing", () => {
    const message = makeMessage({ id: "x", role: "assistant", order: 1, text: "ok" });
    delete (message as { id?: string }).id;
    expect(getMessageIdentity(message)).toBe("k-x");
  });
});
