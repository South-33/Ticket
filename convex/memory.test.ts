import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const AUTH_IDENTITY = {
  tokenIdentifier: "demo-user",
  subject: "demo-user",
  issuer: "https://auth.test",
};

describe("memory guards", () => {
  test("rejects inferred confirmation for sensitive facts", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await expect(
      t.mutation(api.memory.upsertUserMemoryFact, {
        key: "nationality",
        value: "Filipino",
        sourceType: "inferred",
        confidence: 0.8,
        status: "confirmed",
        isSensitive: true,
      }),
    ).rejects.toThrowError("Sensitive facts must be explicitly user confirmed");
  });

  test("allows explicit user confirmation for sensitive facts", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "nationality",
      value: "Filipino",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: true,
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    expect(
      memory.facts.some(
        (fact: { key: string; status: string }) => fact.key === "nationality" && fact.status === "confirmed",
      ),
    ).toBe(true);
  });
});
