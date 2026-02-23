import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserIdOrThrow } from "./auth";

type ProfileFieldKey =
  | "displayName"
  | "homeCity"
  | "homeAirport"
  | "nationality"
  | "ageBand"
  | "budgetBand"
  | "preferredCabin"
  | "flexibilityLevel"
  | "loyaltyPrograms";

function normalizeKey(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function normalizeProfileField(input: string): ProfileFieldKey | null {
  const key = normalizeKey(input);
  const aliases: Record<string, ProfileFieldKey> = {
    name: "displayName",
    display_name: "displayName",
    displayname: "displayName",
    home_city: "homeCity",
    city: "homeCity",
    home_airport: "homeAirport",
    airport: "homeAirport",
    nationality: "nationality",
    age: "ageBand",
    age_band: "ageBand",
    budget: "budgetBand",
    budget_band: "budgetBand",
    preferred_cabin: "preferredCabin",
    cabin: "preferredCabin",
    flexibility: "flexibilityLevel",
    flexibility_level: "flexibilityLevel",
    loyalty_programs: "loyaltyPrograms",
    loyalty: "loyaltyPrograms",
  };
  return aliases[key] ?? null;
}

const memoryOperationValidator = v.object({
  action: v.union(v.literal("add"), v.literal("update"), v.literal("delete"), v.literal("noop")),
  store: v.union(v.literal("fact"), v.literal("preference"), v.literal("profile")),
  key: v.string(),
  value: v.optional(v.string()),
  confidence: v.optional(v.number()),
  reason: v.optional(v.string()),
  sensitive: v.optional(v.boolean()),
});

function toMarkdown(args: {
  profile: {
    displayName?: string;
    homeCity?: string;
    homeAirport?: string;
    nationality?: string;
    ageBand?: string;
    budgetBand?: string;
    preferredCabin?: string;
    flexibilityLevel?: string;
    loyaltyPrograms: string[];
  } | null;
  facts: Array<{ key: string; value: string; status: string; confidence: number }>;
  preferences: Array<{ key: string; value: string }>;
}) {
  const lines: string[] = ["# user.md", "", "## Profile"];
  if (!args.profile) {
    lines.push("- Not set");
  } else {
    lines.push(`- displayName: ${args.profile.displayName ?? ""}`);
    lines.push(`- homeCity: ${args.profile.homeCity ?? ""}`);
    lines.push(`- homeAirport: ${args.profile.homeAirport ?? ""}`);
    lines.push(`- nationality: ${args.profile.nationality ?? ""}`);
    lines.push(`- ageBand: ${args.profile.ageBand ?? ""}`);
    lines.push(`- budgetBand: ${args.profile.budgetBand ?? ""}`);
    lines.push(`- preferredCabin: ${args.profile.preferredCabin ?? ""}`);
    lines.push(`- flexibilityLevel: ${args.profile.flexibilityLevel ?? ""}`);
    lines.push(`- loyaltyPrograms: ${args.profile.loyaltyPrograms.join(", ")}`);
  }

  lines.push("", "## Facts");
  if (args.facts.length === 0) {
    lines.push("- None");
  } else {
    for (const fact of args.facts) {
      lines.push(`- ${fact.key}: ${fact.value} (${fact.status}, conf=${fact.confidence.toFixed(2)})`);
    }
  }

  lines.push("", "## Preferences (Untrusted Hints)");
  if (args.preferences.length === 0) {
    lines.push("- None");
  } else {
    for (const preference of args.preferences) {
      lines.push(`- ${preference.key}: ${preference.value}`);
    }
  }
  return lines.join("\n");
}

async function persistSnapshotForUser(ctx: MutationCtx, userId: string) {
  const [profile, facts, preferences, snapshots] = await Promise.all([
    ctx.db.query("userProfiles").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", userId).eq("status", "confirmed"))
      .order("desc")
      .take(80),
    ctx.db
      .query("userPreferenceNotes")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60),
    ctx.db
      .query("userMemorySnapshots")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1),
  ]);

  const markdown = toMarkdown({
    profile,
    facts: facts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      status: fact.status,
      confidence: fact.confidence,
    })),
    preferences: preferences.map((preference) => ({
      key: preference.key,
      value: preference.value,
    })),
  });

  const version = (snapshots[0]?.version ?? 0) + 1;
  await ctx.db.insert("userMemorySnapshots", {
    userId,
    version,
    markdown,
    createdAt: Date.now(),
  });

  return {
    version,
    markdown,
  };
}

export const getUserMemory = query({
  args: {},
  returns: v.object({
    profile: v.union(
      v.null(),
      v.object({
        displayName: v.optional(v.string()),
        homeCity: v.optional(v.string()),
        homeAirport: v.optional(v.string()),
        nationality: v.optional(v.string()),
        ageBand: v.optional(v.string()),
        budgetBand: v.optional(v.string()),
        preferredCabin: v.optional(v.string()),
        flexibilityLevel: v.optional(v.string()),
        loyaltyPrograms: v.array(v.string()),
        updatedAt: v.number(),
      }),
    ),
    facts: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
        sourceType: v.string(),
        confidence: v.number(),
        status: v.string(),
        isSensitive: v.boolean(),
        updatedAt: v.number(),
      }),
    ),
    preferences: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
        updatedAt: v.number(),
      }),
    ),
    latestSnapshot: v.union(
      v.null(),
      v.object({
        version: v.number(),
        markdown: v.string(),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const [profile, facts, preferences, snapshots] = await Promise.all([
      ctx.db.query("userProfiles").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
      ctx.db
        .query("userMemoryFacts")
        .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", userId).eq("status", "confirmed"))
        .order("desc")
        .take(40),
      ctx.db
        .query("userPreferenceNotes")
        .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
        .order("desc")
        .take(40),
      ctx.db
        .query("userMemorySnapshots")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
        .order("desc")
        .take(1),
    ]);

    return {
      profile: profile
        ? {
            displayName: profile.displayName,
            homeCity: profile.homeCity,
            homeAirport: profile.homeAirport,
            nationality: profile.nationality,
            ageBand: profile.ageBand,
            budgetBand: profile.budgetBand,
            preferredCabin: profile.preferredCabin,
            flexibilityLevel: profile.flexibilityLevel,
            loyaltyPrograms: profile.loyaltyPrograms,
            updatedAt: profile.updatedAt,
          }
        : null,
      facts: facts.map((fact) => ({
        key: fact.key,
        value: fact.value,
        sourceType: fact.sourceType,
        confidence: fact.confidence,
        status: fact.status,
        isSensitive: fact.isSensitive,
        updatedAt: fact.updatedAt,
      })),
      preferences: preferences.map((preference) => ({
        key: preference.key,
        value: preference.value,
        updatedAt: preference.updatedAt,
      })),
      latestSnapshot: snapshots[0]
        ? {
            version: snapshots[0].version,
            markdown: snapshots[0].markdown,
            createdAt: snapshots[0].createdAt,
          }
        : null,
    };
  },
});

export const listMemoryOpAudit = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      action: v.union(v.literal("add"), v.literal("update"), v.literal("delete"), v.literal("noop")),
      store: v.union(v.literal("fact"), v.literal("preference"), v.literal("profile")),
      key: v.string(),
      value: v.optional(v.string()),
      confidence: v.number(),
      outcome: v.union(v.literal("applied"), v.literal("skipped")),
      reason: v.string(),
      threadId: v.optional(v.string()),
      promptMessageId: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const events = await ctx.db
      .query("memoryOpAuditEvents")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    return events.map((event) => ({
      action: event.action,
      store: event.store,
      key: event.key,
      value: event.value,
      confidence: event.confidence,
      outcome: event.outcome,
      reason: event.reason,
      threadId: event.threadId,
      promptMessageId: event.promptMessageId,
      createdAt: event.createdAt,
    }));
  },
});

export const upsertUserProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    homeCity: v.optional(v.string()),
    homeAirport: v.optional(v.string()),
    nationality: v.optional(v.string()),
    ageBand: v.optional(v.string()),
    budgetBand: v.optional(v.string()),
    preferredCabin: v.optional(v.string()),
    flexibilityLevel: v.optional(v.string()),
    loyaltyPrograms: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("userProfiles", {
        userId,
        displayName: args.displayName,
        homeCity: args.homeCity,
        homeAirport: args.homeAirport,
        nationality: args.nationality,
        ageBand: args.ageBand,
        budgetBand: args.budgetBand,
        preferredCabin: args.preferredCabin,
        flexibilityLevel: args.flexibilityLevel,
        loyaltyPrograms: args.loyaltyPrograms ?? [],
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(existing._id, {
      displayName: args.displayName ?? existing.displayName,
      homeCity: args.homeCity ?? existing.homeCity,
      homeAirport: args.homeAirport ?? existing.homeAirport,
      nationality: args.nationality ?? existing.nationality,
      ageBand: args.ageBand ?? existing.ageBand,
      budgetBand: args.budgetBand ?? existing.budgetBand,
      preferredCabin: args.preferredCabin ?? existing.preferredCabin,
      flexibilityLevel: args.flexibilityLevel ?? existing.flexibilityLevel,
      loyaltyPrograms: args.loyaltyPrograms ?? existing.loyaltyPrograms,
      updatedAt: now,
    });
    return null;
  },
});

export const upsertUserMemoryFact = mutation({
  args: {
    key: v.string(),
    value: v.string(),
    sourceType: v.union(v.literal("user_confirmed"), v.literal("inferred"), v.literal("imported")),
    confidence: v.number(),
    status: v.union(v.literal("proposed"), v.literal("confirmed"), v.literal("rejected"), v.literal("stale")),
    isSensitive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    if (args.isSensitive && args.status === "confirmed" && args.sourceType !== "user_confirmed") {
      throw new ConvexError("Sensitive facts must be explicitly user confirmed");
    }

    const existing = await ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
      .order("desc")
      .take(1);

    const now = Date.now();
    const fact = existing[0];
    if (!fact) {
      await ctx.db.insert("userMemoryFacts", {
        userId,
        key: args.key,
        value: args.value,
        sourceType: args.sourceType,
        confidence: args.confidence,
        status: args.status,
        isSensitive: args.isSensitive,
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(fact._id, {
      value: args.value,
      sourceType: args.sourceType,
      confidence: args.confidence,
      status: args.status,
      isSensitive: args.isSensitive,
      updatedAt: now,
    });
    return null;
  },
});

export const confirmSensitiveFact = mutation({
  args: {
    key: v.string(),
    value: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const fact = await ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
      .order("desc")
      .take(1);

    if (!fact[0]) {
      throw new ConvexError("Fact not found");
    }

    await ctx.db.patch(fact[0]._id, {
      value: args.value,
      status: "confirmed",
      sourceType: "user_confirmed",
      confidence: 1,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const removeUserMemoryFact = mutation({
  args: {
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const now = Date.now();
    const facts = await ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
      .take(50);

    await Promise.all(
      facts.map((fact) =>
        ctx.db.patch(fact._id, {
          status: "stale",
          updatedAt: now,
        }),
      ),
    );

    return null;
  },
});

export const upsertUserPreferenceNote = mutation({
  args: {
    key: v.string(),
    value: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const key = args.key.trim().toLowerCase();
    const value = args.value.trim();
    if (!key || !value) {
      throw new ConvexError("Preference key and value are required");
    }

    const existing = await ctx.db
      .query("userPreferenceNotes")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key))
      .unique();
    const now = Date.now();

    if (!existing) {
      await ctx.db.insert("userPreferenceNotes", {
        userId,
        key,
        value,
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(existing._id, {
      value,
      updatedAt: now,
    });

    return null;
  },
});

export const removeUserPreferenceNote = mutation({
  args: {
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const key = args.key.trim().toLowerCase();
    if (!key) {
      return null;
    }

    const existing = await ctx.db
      .query("userPreferenceNotes")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return null;
  },
});

export const generateUserMemorySnapshot = mutation({
  args: {},
  returns: v.object({
    version: v.number(),
    markdown: v.string(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    return await persistSnapshotForUser(ctx, userId);
  },
});

export const generateUserMemorySnapshotInternal = internalMutation({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    version: v.number(),
    markdown: v.string(),
  }),
  handler: async (ctx, args) => {
    return await persistSnapshotForUser(ctx, args.userId);
  },
});

export const getConfirmedFactsInternal = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      value: v.string(),
      isSensitive: v.boolean(),
      confidence: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const facts = await ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", args.userId).eq("status", "confirmed"))
      .order("desc")
      .take(60);

    return facts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      isSensitive: fact.isSensitive,
      confidence: fact.confidence,
    }));
  },
});

export const getUserProfileInternal = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      displayName: v.optional(v.string()),
      homeCity: v.optional(v.string()),
      homeAirport: v.optional(v.string()),
      nationality: v.optional(v.string()),
      ageBand: v.optional(v.string()),
      budgetBand: v.optional(v.string()),
      preferredCabin: v.optional(v.string()),
      flexibilityLevel: v.optional(v.string()),
      loyaltyPrograms: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!profile) {
      return null;
    }

    return {
      displayName: profile.displayName,
      homeCity: profile.homeCity,
      homeAirport: profile.homeAirport,
      nationality: profile.nationality,
      ageBand: profile.ageBand,
      budgetBand: profile.budgetBand,
      preferredCabin: profile.preferredCabin,
      flexibilityLevel: profile.flexibilityLevel,
      loyaltyPrograms: profile.loyaltyPrograms,
    };
  },
});

export const getUserPreferenceHintsInternal = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      value: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const preferences = await ctx.db
      .query("userPreferenceNotes")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(40);

    return preferences.map((preference) => ({
      key: preference.key,
      value: preference.value,
    }));
  },
});

export const applyMemoryOpsInternal = internalMutation({
  args: {
    userId: v.string(),
    operations: v.array(memoryOperationValidator),
    source: v.optional(
      v.object({
        threadId: v.string(),
        promptMessageId: v.string(),
      }),
    ),
  },
  returns: v.object({
    applied: v.number(),
    added: v.number(),
    updated: v.number(),
    deleted: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    let added = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;
    const now = Date.now();
    const maxOps = 8;

    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const writeAudit = async (entry: {
      action: "add" | "update" | "delete" | "noop";
      store: "fact" | "preference" | "profile";
      key: string;
      value?: string;
      confidence: number;
      outcome: "applied" | "skipped";
      reason: string;
    }) => {
      await ctx.db.insert("memoryOpAuditEvents", {
        userId: args.userId,
        threadId: args.source?.threadId,
        promptMessageId: args.source?.promptMessageId,
        action: entry.action,
        store: entry.store,
        key: entry.key,
        value: entry.value,
        confidence: entry.confidence,
        outcome: entry.outcome,
        reason: entry.reason.slice(0, 220),
        createdAt: now,
      });
    };

    for (const operation of args.operations.slice(0, maxOps)) {
      const action = operation.action;
      const value = operation.value?.trim();
      const confidence = Math.max(0, Math.min(1, operation.confidence ?? 0.66));
      const rawKey = normalizeKey(operation.key);
      const key = rawKey || "invalid_key";

      if (action === "noop") {
        skipped += 1;
        await writeAudit({
          action,
          store: operation.store,
          key,
          value,
          confidence,
          outcome: "skipped",
          reason: operation.reason?.trim() || "noop action",
        });
        continue;
      }

      if (!rawKey) {
        skipped += 1;
        await writeAudit({
          action,
          store: operation.store,
          key,
          value,
          confidence,
          outcome: "skipped",
          reason: "invalid normalized key",
        });
        continue;
      }

      if (operation.store === "fact") {
        const existing = await ctx.db
          .query("userMemoryFacts")
          .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", rawKey))
          .order("desc")
          .take(1);
        const existingFact = existing[0];

        if (action === "delete") {
          if (confidence < 0.9 || !existingFact) {
            skipped += 1;
            await writeAudit({
              action,
              store: operation.store,
              key: rawKey,
              value,
              confidence,
              outcome: "skipped",
              reason: !existingFact ? "fact not found for delete" : "delete confidence below 0.9",
            });
            continue;
          }
          const facts = await ctx.db
            .query("userMemoryFacts")
            .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", rawKey))
            .take(50);
          await Promise.all(
            facts.map((fact) =>
              ctx.db.patch(fact._id, {
                status: "stale",
                updatedAt: now,
              }),
            ),
          );
          deleted += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "deleted fact",
          });
          continue;
        }

        if (!value) {
          skipped += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "skipped",
            reason: "missing fact value",
          });
          continue;
        }

        const isSensitive =
          operation.sensitive
          || /(^|_)(nationality|passport|visa|age|age_band|dob|birth_date)(_|$)/.test(key);
        const status = isSensitive ? "proposed" : "confirmed";
        const safeConfidence = isSensitive ? Math.min(confidence, 0.6) : Math.max(0.45, confidence);

        const protectedConfirmedFact =
          !!existingFact
          && existingFact.status === "confirmed"
          && existingFact.sourceType === "user_confirmed"
          && existingFact.confidence >= 0.85
          && (existingFact.isSensitive || isSensitive);
        if (protectedConfirmedFact) {
          skipped += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "skipped",
            reason: "protected confirmed user fact",
          });
          continue;
        }

        if (!existingFact) {
          await ctx.db.insert("userMemoryFacts", {
            userId: args.userId,
            key: rawKey,
            value,
            sourceType: "inferred",
            confidence: safeConfidence,
            status,
            isSensitive,
            createdAt: now,
            updatedAt: now,
          });
          added += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence: safeConfidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "added inferred fact",
          });
        } else {
          await ctx.db.patch(existingFact._id, {
            value,
            sourceType: "inferred",
            confidence: safeConfidence,
            status,
            isSensitive,
            updatedAt: now,
          });
          updated += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence: safeConfidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "updated inferred fact",
          });
        }
        continue;
      }

      if (operation.store === "preference") {
        const existing = await ctx.db
          .query("userPreferenceNotes")
          .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", rawKey))
          .unique();

        if (action === "delete") {
          if (!existing || confidence < 0.6) {
            skipped += 1;
            await writeAudit({
              action,
              store: operation.store,
              key: rawKey,
              value,
              confidence,
              outcome: "skipped",
              reason: !existing ? "preference not found for delete" : "delete confidence below 0.6",
            });
            continue;
          }
          await ctx.db.delete(existing._id);
          deleted += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "deleted preference",
          });
          continue;
        }

        if (!value) {
          skipped += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "skipped",
            reason: "missing preference value",
          });
          continue;
        }

        if (!existing) {
          await ctx.db.insert("userPreferenceNotes", {
            userId: args.userId,
            key: rawKey,
            value,
            createdAt: now,
            updatedAt: now,
          });
          added += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "added preference",
          });
        } else {
          await ctx.db.patch(existing._id, {
            value,
            updatedAt: now,
          });
          updated += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "applied",
            reason: operation.reason?.trim() || "updated preference",
          });
        }
        continue;
      }

      const profileField = normalizeProfileField(rawKey);
      if (!profileField) {
        skipped += 1;
        await writeAudit({
          action,
          store: operation.store,
          key: rawKey,
          value,
          confidence,
          outcome: "skipped",
          reason: "unknown profile key",
        });
        continue;
      }

      if (!profile) {
        profile = await ctx.db.insert("userProfiles", {
          userId: args.userId,
          loyaltyPrograms: [],
          createdAt: now,
          updatedAt: now,
        }).then((id) => ctx.db.get(id));
      }
      if (!profile) {
        skipped += 1;
        await writeAudit({
          action,
          store: operation.store,
          key: rawKey,
          value,
          confidence,
          outcome: "skipped",
          reason: "profile unavailable",
        });
        continue;
      }

      if (action === "delete") {
        if (confidence < 0.9) {
          skipped += 1;
          await writeAudit({
            action,
            store: operation.store,
            key: rawKey,
            value,
            confidence,
            outcome: "skipped",
            reason: "delete confidence below 0.9",
          });
          continue;
        }

        await ctx.db.patch(profile._id, {
          [profileField]: profileField === "loyaltyPrograms" ? [] : undefined,
          updatedAt: now,
        });
        deleted += 1;
        profile = await ctx.db.get(profile._id);
        await writeAudit({
          action,
          store: operation.store,
          key: rawKey,
          value,
          confidence,
          outcome: "applied",
          reason: operation.reason?.trim() || "cleared profile field",
        });
        continue;
      }

      if (!value) {
        skipped += 1;
        await writeAudit({
          action,
          store: operation.store,
          key: rawKey,
          value,
          confidence,
          outcome: "skipped",
          reason: "missing profile value",
        });
        continue;
      }

      await ctx.db.patch(profile._id, {
        [profileField]:
          profileField === "loyaltyPrograms"
            ? value
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
                .slice(0, 12)
            : value,
        updatedAt: now,
      });
      updated += 1;
      profile = await ctx.db.get(profile._id);
      await writeAudit({
        action,
        store: operation.store,
        key: rawKey,
        value,
        confidence,
        outcome: "applied",
        reason: operation.reason?.trim() || "updated profile field",
      });
    }

    return {
      applied: added + updated + deleted,
      added,
      updated,
      deleted,
      skipped,
    };
  },
});
