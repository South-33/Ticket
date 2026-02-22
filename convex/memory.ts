import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserIdOrThrow } from "./auth";

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
  return lines.join("\n");
}

async function persistSnapshotForUser(ctx: MutationCtx, userId: string) {
  const [profile, facts, snapshots] = await Promise.all([
    ctx.db.query("userProfiles").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
    ctx.db
      .query("userMemoryFacts")
      .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", userId).eq("status", "confirmed"))
      .order("desc")
      .take(80),
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
    const [profile, facts, snapshots] = await Promise.all([
      ctx.db.query("userProfiles").withIndex("by_userId", (q) => q.eq("userId", userId)).unique(),
      ctx.db
        .query("userMemoryFacts")
        .withIndex("by_user_status_updatedAt", (q) => q.eq("userId", userId).eq("status", "confirmed"))
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
