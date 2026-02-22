import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

type DocKind = "skills" | "flights" | "train" | "concert";

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
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(existing._id, {
      title: args.title,
      kind: args.kind,
      status: args.status,
      summary: args.summary,
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
    return await ctx.db.insert("knowledgeItems", {
      docId: args.docId,
      key: args.key,
      content: args.content,
      confidence: args.confidence,
      priority: args.priority,
      status: args.status,
      sourceUrls: args.sourceUrls,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
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
    return await ctx.db.insert("knowledgeLinks", {
      fromDocId: args.fromDocId,
      toDocId: args.toDocId,
      label: args.label,
      createdAt: Date.now(),
    });
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
        .withIndex("by_kind_status", (q) => q.eq("kind", kind).eq("status", "active"))
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
        .withIndex("by_kind_status", (q) => q.eq("kind", kind).eq("status", "active"))
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
