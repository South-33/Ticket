import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  threadState: defineTable({
    threadId: v.string(),
    userId: v.string(),
    title: v.string(),
    titleUpdatedAt: v.optional(v.number()),
    preview: v.string(),
    lastMessageAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_user_lastMessageAt", ["userId", "lastMessageAt"]),
});
