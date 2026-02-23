import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { getAuthUserIdOrThrow } from "./auth";

const LEGACY_GENERAL_SLUG = "skills";
const GENERAL_SLUG = "general";
const MAX_PAGE_SIZE = 50;

function assertPageSize(numItems: number) {
  if (numItems < 1 || numItems > MAX_PAGE_SIZE) {
    throw new ConvexError(`paginationOpts.numItems must be between 1 and ${MAX_PAGE_SIZE}`);
  }
}

function normalizePlaybookSlug(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === LEGACY_GENERAL_SLUG) {
    return GENERAL_SLUG;
  }
  return normalized;
}

function resolvePlaybookSlugsForDomain(domain: string) {
  if (domain === "flight") {
    return [GENERAL_SLUG, "flights"];
  }
  if (domain === "train") {
    return [GENERAL_SLUG, "train"];
  }
  if (domain === "concert") {
    return [GENERAL_SLUG, "concert"];
  }
  if (domain === "mixed") {
    return [GENERAL_SLUG, "flights", "train", "concert"];
  }
  return [GENERAL_SLUG];
}

async function requirePlaybookWriteAccess(ctx: MutationCtx) {
  const userId = await getAuthUserIdOrThrow(ctx);
  const allowList = (process.env.PLAYBOOK_EDITOR_IDS ?? process.env.KNOWLEDGE_EDITOR_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (allowList.length > 0 && !allowList.includes(userId)) {
    throw new ConvexError("Not authorized to curate playbooks");
  }

  return userId;
}

type UpsertPlaybookArgs = {
  slug: string;
  title: string;
  description?: string;
  kind: "general" | "flights" | "train" | "concert" | "flights_grey_tactics";
  scope: "always" | "conditional" | "opt_in";
  riskClass: "safe" | "grey";
  status: "draft" | "active" | "archived";
  contentMarkdown: string;
  sourceFile?: string;
};

async function upsertPlaybookRecord(
  ctx: MutationCtx,
  args: UpsertPlaybookArgs,
  userId?: string,
) {
  const now = Date.now();
  const slug = normalizePlaybookSlug(args.slug);
  const existing = await ctx.db
    .query("playbooks")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();

  if (!existing) {
    return await ctx.db.insert("playbooks", {
      slug,
      title: args.title.trim(),
      description: args.description?.trim(),
      kind: args.kind,
      scope: args.scope,
      riskClass: args.riskClass,
      status: args.status,
      contentMarkdown: args.contentMarkdown,
      sourceFile: args.sourceFile,
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.patch(existing._id, {
    title: args.title.trim(),
    description: args.description?.trim(),
    kind: args.kind,
    scope: args.scope,
    riskClass: args.riskClass,
    status: args.status,
    contentMarkdown: args.contentMarkdown,
    sourceFile: args.sourceFile,
    updatedByUserId: userId,
    updatedAt: now,
  });

  return existing._id;
}

export const upsertPlaybook = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(
      v.literal("general"),
      v.literal("flights"),
      v.literal("train"),
      v.literal("concert"),
      v.literal("flights_grey_tactics"),
    ),
    scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
    riskClass: v.union(v.literal("safe"), v.literal("grey")),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    contentMarkdown: v.string(),
    sourceFile: v.optional(v.string()),
  },
  returns: v.id("playbooks"),
  handler: async (ctx, args) => {
    const userId = await requirePlaybookWriteAccess(ctx);
    return upsertPlaybookRecord(ctx, args, userId);
  },
});

export const syncPlaybookFromSource = mutation({
  args: {
    syncToken: v.optional(v.string()),
    entry: v.object({
      slug: v.string(),
      title: v.string(),
      description: v.optional(v.string()),
      kind: v.union(
        v.literal("general"),
        v.literal("flights"),
        v.literal("train"),
        v.literal("concert"),
        v.literal("flights_grey_tactics"),
      ),
      scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
      riskClass: v.union(v.literal("safe"), v.literal("grey")),
      status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
      contentMarkdown: v.string(),
      sourceFile: v.optional(v.string()),
    }),
  },
  returns: v.id("playbooks"),
  handler: async (ctx, args) => {
    const expectedToken = (process.env.PLAYBOOK_SYNC_TOKEN ?? "").trim();
    if (expectedToken.length > 0 && args.syncToken !== expectedToken) {
      throw new ConvexError("Invalid playbook sync token");
    }
    return await upsertPlaybookRecord(ctx, args.entry);
  },
});

export const listPlaybooks = query({
  args: {
    kind: v.optional(
      v.union(
        v.literal("general"),
        v.literal("flights"),
        v.literal("train"),
        v.literal("concert"),
        v.literal("flights_grey_tactics"),
      ),
    ),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("playbooks"),
        slug: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        kind: v.union(
          v.literal("general"),
          v.literal("flights"),
          v.literal("train"),
          v.literal("concert"),
          v.literal("flights_grey_tactics"),
        ),
        scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
        riskClass: v.union(v.literal("safe"), v.literal("grey")),
        status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
        contentMarkdown: v.string(),
        sourceFile: v.optional(v.string()),
        updatedAt: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertPageSize(args.paginationOpts.numItems);
    const result = args.status
      ? await ctx.db
        .query("playbooks")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .paginate(args.paginationOpts)
      : await ctx.db.query("playbooks").withIndex("by_status_updatedAt").order("desc").paginate(args.paginationOpts);

    const page = args.kind
      ? result.page.filter((doc) => doc.kind === args.kind)
      : result.page;

    return {
      page: page.map((doc) => ({
        _id: doc._id,
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        kind: doc.kind,
        scope: doc.scope,
        riskClass: doc.riskClass,
        status: doc.status,
        contentMarkdown: doc.contentMarkdown,
        sourceFile: doc.sourceFile,
        updatedAt: doc.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getPlaybookForEditor = query({
  args: {
    playbookId: v.id("playbooks"),
  },
  returns: v.union(
    v.object({
      _id: v.id("playbooks"),
      slug: v.string(),
      title: v.string(),
      description: v.optional(v.string()),
      kind: v.union(
        v.literal("general"),
        v.literal("flights"),
        v.literal("train"),
        v.literal("concert"),
        v.literal("flights_grey_tactics"),
      ),
      scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
      riskClass: v.union(v.literal("safe"), v.literal("grey")),
      status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
      contentMarkdown: v.string(),
      sourceFile: v.optional(v.string()),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const playbook = await ctx.db.get(args.playbookId);
    if (!playbook) {
      return null;
    }
    return {
      _id: playbook._id,
      slug: playbook.slug,
      title: playbook.title,
      description: playbook.description,
      kind: playbook.kind,
      scope: playbook.scope,
      riskClass: playbook.riskClass,
      status: playbook.status,
      contentMarkdown: playbook.contentMarkdown,
      sourceFile: playbook.sourceFile,
      updatedAt: playbook.updatedAt,
    };
  },
});

export const syncPlaybooksFromSourceInternal = internalMutation({
  args: {
    entries: v.array(
      v.object({
        slug: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        kind: v.union(
          v.literal("general"),
          v.literal("flights"),
          v.literal("train"),
          v.literal("concert"),
          v.literal("flights_grey_tactics"),
        ),
        scope: v.union(v.literal("always"), v.literal("conditional"), v.literal("opt_in")),
        riskClass: v.union(v.literal("safe"), v.literal("grey")),
        status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
        contentMarkdown: v.string(),
        sourceFile: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    upserted: v.number(),
  }),
  handler: async (ctx, args) => {
    let upserted = 0;

    for (const entry of args.entries) {
      await upsertPlaybookRecord(ctx, entry);

      upserted += 1;
    }

    return { upserted };
  },
});

export const getSkillCatalogForChatInternal = internalQuery({
  args: {
    asOfMs: v.number(),
    maxGeneralHints: v.optional(v.number()),
  },
  returns: v.object({
    availableSkills: v.array(
      v.object({
        slug: v.string(),
        kind: v.string(),
        title: v.string(),
        summary: v.optional(v.string()),
      }),
    ),
    generalHints: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const active = await ctx.db
      .query("playbooks")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "active"))
      .order("desc")
      .take(40);

    const availableSkills = active.map((doc) => ({
      slug: normalizePlaybookSlug(doc.slug),
      kind: doc.kind,
      title: doc.title,
      summary: doc.description,
    }));

    const general = active.find((doc) => normalizePlaybookSlug(doc.slug) === GENERAL_SLUG);
    const generalHints = general ? [general.contentMarkdown] : [];

    return {
      availableSkills,
      generalHints,
    };
  },
});

export const getSkillPackBySlugsInternal = internalQuery({
  args: {
    skillSlugs: v.array(v.string()),
    asOfMs: v.number(),
    maxItemsPerSkill: v.optional(v.number()),
  },
  returns: v.object({
    selectedSkills: v.array(v.string()),
    hints: v.array(v.string()),
    digest: v.string(),
  }),
  handler: async (ctx, args) => {
    const slugs = Array.from(new Set(args.skillSlugs.map(normalizePlaybookSlug).filter((slug) => slug.length > 0))).slice(0, 8);
    const selectedSkills: string[] = [];
    const hints: string[] = [];
    const digestParts: string[] = [];

    for (const slug of slugs) {
      const doc = await ctx.db
        .query("playbooks")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!doc || doc.status !== "active") {
        continue;
      }
      selectedSkills.push(slug);
      hints.push(`[${slug}]\n${doc.contentMarkdown}`);
      digestParts.push(`${slug}:${doc.updatedAt}`);
    }

    return {
      selectedSkills,
      hints,
      digest: digestParts.join("|"),
    };
  },
});

export const getPlannerHintsInternal = internalQuery({
  args: {
    domain: v.string(),
    asOfMs: v.number(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const slugs = resolvePlaybookSlugsForDomain(args.domain);
    const hints: string[] = [];

    for (const slug of slugs) {
      const playbook = await ctx.db
        .query("playbooks")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!playbook || playbook.status !== "active") {
        continue;
      }
      hints.push(`[${slug}]\n${playbook.contentMarkdown}`);
    }

    return hints;
  },
});
