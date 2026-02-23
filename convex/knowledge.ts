import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { getAuthUserIdOrThrow } from "./auth";

type DocKind = "skills" | "flights" | "train" | "concert";

const MAX_PAGE_SIZE = 50;

function assertPageSize(numItems: number) {
  if (numItems < 1 || numItems > MAX_PAGE_SIZE) {
    throw new ConvexError(`paginationOpts.numItems must be between 1 and ${MAX_PAGE_SIZE}`);
  }
}

function uniqueSourceUrls(urls: string[]) {
  return Array.from(new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0)));
}

function validateKnowledgeItem(args: {
  confidence: number;
  priority: number;
  status: "draft" | "active" | "stale";
  sourceUrls: string[];
}) {
  if (args.confidence < 0 || args.confidence > 1) {
    throw new ConvexError("confidence must be between 0 and 1");
  }
  if (args.priority < 0 || args.priority > 100) {
    throw new ConvexError("priority must be between 0 and 100");
  }

  const uniqueUrls = uniqueSourceUrls(args.sourceUrls);
  if (args.status === "active" && args.priority >= 90 && uniqueUrls.length < 2) {
    throw new ConvexError("high-priority active tactics require at least 2 corroborating source URLs");
  }
}

function toDocKindsForDomain(domain: string): DocKind[] {
  if (domain === "flight") {
    return ["skills", "flights"];
  }
  if (domain === "train") {
    return ["skills", "train"];
  }
  if (domain === "concert") {
    return ["skills", "concert"];
  }
  if (domain === "mixed") {
    return ["skills", "flights", "train", "concert"];
  }
  return ["skills"];
}

async function requireKnowledgeWriteAccess(ctx: MutationCtx) {
  const userId = await getAuthUserIdOrThrow(ctx);
  const allowed = (process.env.KNOWLEDGE_EDITOR_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (allowed.length > 0 && !allowed.includes(userId)) {
    throw new ConvexError("Not authorized to curate knowledge");
  }

  return userId;
}

export const upsertKnowledgeDoc = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    kind: v.union(v.literal("skills"), v.literal("flights"), v.literal("train"), v.literal("concert")),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    summary: v.optional(v.string()),
  },
  returns: v.id("knowledgeDocs"),
  handler: async (ctx, args) => {
    const userId = await requireKnowledgeWriteAccess(ctx);
    const existing = await ctx.db
      .query("knowledgeDocs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    const now = Date.now();

    if (!existing) {
      return await ctx.db.insert("knowledgeDocs", {
        slug: args.slug,
        title: args.title,
        kind: args.kind,
        status: args.status,
        summary: args.summary,
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(existing._id, {
      title: args.title,
      kind: args.kind,
      status: args.status,
      summary: args.summary,
      updatedByUserId: userId,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const addKnowledgeItem = mutation({
  args: {
    docId: v.id("knowledgeDocs"),
    key: v.string(),
    content: v.string(),
    confidence: v.number(),
    priority: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("stale")),
    sourceUrls: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("knowledgeItems"),
  handler: async (ctx, args) => {
    const userId = await requireKnowledgeWriteAccess(ctx);
    validateKnowledgeItem(args);
    const sourceUrls = uniqueSourceUrls(args.sourceUrls);

    const doc = await ctx.db.get(args.docId);
    if (!doc) {
      throw new ConvexError("Knowledge doc not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("knowledgeItems")
      .withIndex("by_doc_key", (q) => q.eq("docId", args.docId).eq("key", args.key))
      .unique();

    if (!existing) {
      return await ctx.db.insert("knowledgeItems", {
        docId: args.docId,
        key: args.key,
        content: args.content,
        confidence: args.confidence,
        priority: args.priority,
        status: args.status,
        sourceUrls,
        expiresAt: args.expiresAt,
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(existing._id, {
      content: args.content,
      confidence: args.confidence,
      priority: args.priority,
      status: args.status,
      sourceUrls,
      expiresAt: args.expiresAt,
      updatedByUserId: userId,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const updateKnowledgeItem = mutation({
  args: {
    itemId: v.id("knowledgeItems"),
    content: v.optional(v.string()),
    confidence: v.optional(v.number()),
    priority: v.optional(v.number()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"), v.literal("stale"))),
    sourceUrls: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireKnowledgeWriteAccess(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new ConvexError("Knowledge item not found");
    }

    const nextConfidence = args.confidence ?? item.confidence;
    const nextPriority = args.priority ?? item.priority;
    const nextStatus = args.status ?? item.status;
    const nextSourceUrls = args.sourceUrls ? uniqueSourceUrls(args.sourceUrls) : item.sourceUrls;

    validateKnowledgeItem({
      confidence: nextConfidence,
      priority: nextPriority,
      status: nextStatus,
      sourceUrls: nextSourceUrls,
    });

    await ctx.db.patch(item._id, {
      content: args.content ?? item.content,
      confidence: nextConfidence,
      priority: nextPriority,
      status: nextStatus,
      sourceUrls: nextSourceUrls,
      expiresAt: args.expiresAt === null ? undefined : args.expiresAt ?? item.expiresAt,
      updatedByUserId: userId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const linkKnowledgeDocs = mutation({
  args: {
    fromDocId: v.id("knowledgeDocs"),
    toDocId: v.id("knowledgeDocs"),
    label: v.string(),
  },
  returns: v.id("knowledgeLinks"),
  handler: async (ctx, args) => {
    const userId = await requireKnowledgeWriteAccess(ctx);
    const [fromDoc, toDoc] = await Promise.all([ctx.db.get(args.fromDocId), ctx.db.get(args.toDocId)]);
    if (!fromDoc || !toDoc) {
      throw new ConvexError("Knowledge doc link target missing");
    }

    const existingLinks = await ctx.db
      .query("knowledgeLinks")
      .withIndex("by_fromDoc", (q) => q.eq("fromDocId", args.fromDocId))
      .take(60);
    const duplicate = existingLinks.find(
      (link) => link.toDocId === args.toDocId && link.label.toLowerCase() === args.label.toLowerCase(),
    );
    if (duplicate) {
      return duplicate._id;
    }

    return await ctx.db.insert("knowledgeLinks", {
      fromDocId: args.fromDocId,
      toDocId: args.toDocId,
      label: args.label,
      createdByUserId: userId,
      createdAt: Date.now(),
    });
  },
});

export const listKnowledgeDocs = query({
  args: {
    kind: v.optional(v.union(v.literal("skills"), v.literal("flights"), v.literal("train"), v.literal("concert"))),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await getAuthUserIdOrThrow(ctx);
    assertPageSize(args.paginationOpts.numItems);

    if (args.kind && args.status) {
      return await ctx.db
        .query("knowledgeDocs")
        .withIndex("by_kind_status_updatedAt", (q) =>
          q.eq("kind", args.kind ?? "skills").eq("status", args.status ?? "draft"),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }

    if (args.status) {
      return await ctx.db
        .query("knowledgeDocs")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", args.status ?? "draft"))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("knowledgeDocs")
      .withIndex("by_updatedAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listKnowledgeItemsByDoc = query({
  args: {
    docId: v.id("knowledgeDocs"),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"), v.literal("stale"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await getAuthUserIdOrThrow(ctx);
    assertPageSize(args.paginationOpts.numItems);

    if (args.status) {
      return await ctx.db
        .query("knowledgeItems")
        .withIndex("by_doc_status_priority", (q) => q.eq("docId", args.docId).eq("status", args.status ?? "draft"))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("knowledgeItems")
      .withIndex("by_doc_updatedAt", (q) => q.eq("docId", args.docId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listKnowledgeLinksByDoc = query({
  args: {
    docId: v.id("knowledgeDocs"),
  },
  returns: v.array(
    v.object({
      linkId: v.id("knowledgeLinks"),
      fromDocId: v.id("knowledgeDocs"),
      toDocId: v.id("knowledgeDocs"),
      label: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await getAuthUserIdOrThrow(ctx);
    const [outgoing, incoming] = await Promise.all([
      ctx.db
        .query("knowledgeLinks")
        .withIndex("by_fromDoc", (q) => q.eq("fromDocId", args.docId))
        .take(40),
      ctx.db
        .query("knowledgeLinks")
        .withIndex("by_toDoc", (q) => q.eq("toDocId", args.docId))
        .take(40),
    ]);

    return [...outgoing, ...incoming]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((link) => ({
        linkId: link._id,
        fromDocId: link.fromDocId,
        toDocId: link.toDocId,
        label: link.label,
        createdAt: link.createdAt,
      }));
  },
});

export const getKnowledgeDocForEditor = query({
  args: {
    docId: v.id("knowledgeDocs"),
  },
  returns: v.union(
    v.null(),
    v.object({
      doc: v.object({
        id: v.id("knowledgeDocs"),
        slug: v.string(),
        title: v.string(),
        kind: v.union(v.literal("skills"), v.literal("flights"), v.literal("train"), v.literal("concert")),
        status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
        summary: v.optional(v.string()),
        updatedAt: v.number(),
      }),
      activeItemCount: v.number(),
      staleItemCount: v.number(),
      latestItemUpdatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await getAuthUserIdOrThrow(ctx);
    const doc = await ctx.db.get(args.docId);
    if (!doc) {
      return null;
    }

    const [activeItems, staleItems, latestItem] = await Promise.all([
      ctx.db
        .query("knowledgeItems")
        .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "active"))
        .take(200),
      ctx.db
        .query("knowledgeItems")
        .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "stale"))
        .take(200),
      ctx.db
        .query("knowledgeItems")
        .withIndex("by_doc_updatedAt", (q) => q.eq("docId", doc._id))
        .order("desc")
        .take(1),
    ]);

    return {
      doc: {
        id: doc._id,
        slug: doc.slug,
        title: doc.title,
        kind: doc.kind,
        status: doc.status,
        summary: doc.summary,
        updatedAt: doc.updatedAt,
      },
      activeItemCount: activeItems.length,
      staleItemCount: staleItems.length,
      latestItemUpdatedAt: latestItem[0]?.updatedAt,
    };
  },
});

export const generateKnowledgeMarkdown = query({
  args: {
    slug: v.string(),
    asOfMs: v.number(),
  },
  returns: v.object({
    markdown: v.string(),
    activeItems: v.number(),
  }),
  handler: async (ctx, args) => {
    await getAuthUserIdOrThrow(ctx);
    const doc = await ctx.db
      .query("knowledgeDocs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!doc) {
      throw new ConvexError("Knowledge doc not found");
    }

    const items = await ctx.db
      .query("knowledgeItems")
      .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "active"))
      .order("desc")
      .take(200);

    const filtered = items.filter((item) => !item.expiresAt || item.expiresAt >= args.asOfMs);
    const lines = [
      `# ${doc.title}`,
      "",
      doc.summary ? doc.summary : "Curated playbook entries.",
      "",
      ...filtered.flatMap((item) => [
        `## ${item.key}`,
        item.content,
        `- Priority: ${item.priority}`,
        `- Confidence: ${item.confidence}`,
        item.expiresAt ? `- Expires: ${new Date(item.expiresAt).toISOString()}` : "- Expires: none",
        item.sourceUrls.length > 0 ? `- Sources: ${item.sourceUrls.join(", ")}` : "- Sources: none",
        "",
      ]),
    ];

    return {
      markdown: lines.join("\n"),
      activeItems: filtered.length,
    };
  },
});

export const runKnowledgeMaintenance = mutation({
  args: {
    asOfMs: v.optional(v.number()),
    maxDocs: v.optional(v.number()),
    maxItemsPerDoc: v.optional(v.number()),
  },
  returns: v.object({
    docsVisited: v.number(),
    itemsStaled: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireKnowledgeWriteAccess(ctx);
    return await staleExpiredKnowledgeItems(ctx, {
      asOfMs: args.asOfMs ?? Date.now(),
      maxDocs: args.maxDocs ?? 80,
      maxItemsPerDoc: args.maxItemsPerDoc ?? 120,
    });
  },
});

async function staleExpiredKnowledgeItems(
  ctx: MutationCtx,
  args: { asOfMs: number; maxDocs: number; maxItemsPerDoc: number },
) {
  const docs = await ctx.db
    .query("knowledgeDocs")
    .withIndex("by_status_updatedAt", (q) => q.eq("status", "active"))
    .order("desc")
    .take(args.maxDocs);

  let itemsStaled = 0;
  for (const doc of docs) {
    const activeItems = await ctx.db
      .query("knowledgeItems")
      .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "active"))
      .take(args.maxItemsPerDoc);

    for (const item of activeItems) {
      if (!item.expiresAt || item.expiresAt >= args.asOfMs) {
        continue;
      }

      await ctx.db.patch(item._id, {
        status: "stale",
        updatedAt: args.asOfMs,
      });
      itemsStaled += 1;
    }
  }

  return {
    docsVisited: docs.length,
    itemsStaled,
  };
}

export const markExpiredKnowledgeItemsStaleInternal = internalMutation({
  args: {
    asOfMs: v.number(),
    maxDocs: v.number(),
    maxItemsPerDoc: v.number(),
  },
  returns: v.object({
    docsVisited: v.number(),
    itemsStaled: v.number(),
  }),
  handler: async (ctx, args) => {
    return await staleExpiredKnowledgeItems(ctx, args);
  },
});

export const getPlaybookByDomain = query({
  args: {
    domain: v.string(),
    asOfMs: v.number(),
  },
  returns: v.array(
    v.object({
      docSlug: v.string(),
      key: v.string(),
      content: v.string(),
      confidence: v.number(),
      priority: v.number(),
      sourceUrls: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const kinds = toDocKindsForDomain(args.domain);
    const output: Array<{
      docSlug: string;
      key: string;
      content: string;
      confidence: number;
      priority: number;
      sourceUrls: string[];
    }> = [];

    for (const kind of kinds) {
      const docs = await ctx.db
        .query("knowledgeDocs")
        .withIndex("by_kind_status_updatedAt", (q) => q.eq("kind", kind).eq("status", "active"))
        .order("desc")
        .take(4);

      for (const doc of docs) {
        const items = await ctx.db
          .query("knowledgeItems")
          .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "active"))
          .order("desc")
          .take(20);

        for (const item of items) {
          if (item.expiresAt && item.expiresAt < args.asOfMs) {
            continue;
          }
          output.push({
            docSlug: doc.slug,
            key: item.key,
            content: item.content,
            confidence: item.confidence,
            priority: item.priority,
            sourceUrls: item.sourceUrls,
          });
        }
      }
    }

    return output.sort((a, b) => b.priority - a.priority).slice(0, 40);
  },
});

export const getPlannerHintsInternal = internalQuery({
  args: {
    domain: v.string(),
    asOfMs: v.number(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const kinds = toDocKindsForDomain(args.domain);
    const hints: Array<{ docSlug: string; content: string; priority: number }> = [];

    for (const kind of kinds) {
      const docs = await ctx.db
        .query("knowledgeDocs")
        .withIndex("by_kind_status_updatedAt", (q) => q.eq("kind", kind).eq("status", "active"))
        .order("desc")
        .take(3);

      for (const doc of docs) {
        const items = await ctx.db
          .query("knowledgeItems")
          .withIndex("by_doc_status_priority", (q) => q.eq("docId", doc._id).eq("status", "active"))
          .order("desc")
          .take(8);

        for (const item of items) {
          if (item.expiresAt && item.expiresAt < args.asOfMs) {
            continue;
          }
          hints.push({
            docSlug: doc.slug,
            content: item.content,
            priority: item.priority,
          });
        }
      }
    }

    return hints
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 8)
      .map((item) => `[${item.docSlug}] ${item.content}`);
  },
});
