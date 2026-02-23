import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const DEMO_USER_ID = "demo-user";
const AUTH_IDENTITY = {
  tokenIdentifier: DEMO_USER_ID,
  subject: DEMO_USER_ID,
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

  test("updates existing confirmed fact via upsert", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "destination",
      value: "paris",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: false,
    });

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "destination",
      value: "paris tomorrow evening",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: false,
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    const destination = memory.facts.find((fact: { key: string }) => fact.key === "destination");
    expect(destination?.value).toBe("paris tomorrow evening");
  });

  test("removes a memory fact from confirmed list", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "origin",
      value: "phnom penh",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: false,
    });

    await t.mutation(api.memory.removeUserMemoryFact, {
      key: "origin",
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    expect(memory.facts.some((fact: { key: string }) => fact.key === "origin")).toBe(false);
  });

  test("upserts and updates preference notes", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserPreferenceNote, {
      key: "seat_preference",
      value: "Aisle for long-haul",
    });

    await t.mutation(api.memory.upsertUserPreferenceNote, {
      key: "seat_preference",
      value: "Window for red-eye",
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    const preference = memory.preferences.find((item: { key: string }) => item.key === "seat_preference");
    expect(preference?.value).toBe("Window for red-eye");
  });

  test("removes preference notes", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserPreferenceNote, {
      key: "food_preference",
      value: "Vegetarian meals when available",
    });

    await t.mutation(api.memory.removeUserPreferenceNote, {
      key: "food_preference",
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    expect(memory.preferences.some((item: { key: string }) => item.key === "food_preference")).toBe(false);
  });

  test("applies memory ops conservatively for deletes", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "origin",
      value: "manila",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: false,
    });

    const result = await t.mutation(internal.memory.applyMemoryOpsInternal, {
      userId: DEMO_USER_ID,
      operations: [
        {
          action: "delete",
          store: "fact",
          key: "origin",
          confidence: 0.5,
        },
        {
          action: "add",
          store: "preference",
          key: "seat_preference",
          value: "aisle",
          confidence: 0.8,
        },
      ],
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    expect(result.deleted).toBe(0);
    expect(memory.facts.some((fact: { key: string }) => fact.key === "origin")).toBe(true);
    expect(memory.preferences.some((item: { key: string }) => item.key === "seat_preference")).toBe(true);
  });

  test("applies high confidence fact delete operation", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.memory.upsertUserMemoryFact, {
      key: "destination",
      value: "paris",
      sourceType: "user_confirmed",
      confidence: 1,
      status: "confirmed",
      isSensitive: false,
    });

    const result = await t.mutation(internal.memory.applyMemoryOpsInternal, {
      userId: DEMO_USER_ID,
      operations: [
        {
          action: "delete",
          store: "fact",
          key: "destination",
          confidence: 0.95,
          reason: "User explicitly corrected destination",
        },
      ],
    });

    const memory = await t.query(api.memory.getUserMemory, {});
    expect(result.deleted).toBe(1);
    expect(memory.facts.some((fact: { key: string }) => fact.key === "destination")).toBe(false);
  });
});
