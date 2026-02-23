import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const AUTH_IDENTITY = {
  tokenIdentifier: "demo-user",
  subject: "demo-user",
  issuer: "https://auth.test",
};

describe("knowledge curation", () => {
  test("requires auth for knowledge mutations", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.knowledge.upsertKnowledgeDoc, {
        slug: "flights-core",
        title: "Flights Core",
        kind: "flights",
        status: "draft",
      }),
    ).rejects.toThrowError("Not authenticated");
  });

  test("upserts knowledge item by doc + key", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const docId = await t.mutation(api.knowledge.upsertKnowledgeDoc, {
      slug: "flights-core",
      title: "Flights Core",
      kind: "flights",
      status: "active",
      summary: "flight playbook",
    });

    const firstItemId = await t.mutation(api.knowledge.addKnowledgeItem, {
      docId,
      key: "fare-rule",
      content: "Check direct carrier fare families first.",
      confidence: 0.8,
      priority: 72,
      status: "active",
      sourceUrls: ["https://example.com/a", "https://example.com/b"],
    });

    const secondItemId = await t.mutation(api.knowledge.addKnowledgeItem, {
      docId,
      key: "fare-rule",
      content: "Check direct carrier fare families before aggregator fallbacks.",
      confidence: 0.84,
      priority: 74,
      status: "active",
      sourceUrls: ["https://example.com/a", "https://example.com/b"],
    });

    const page = await t.query(api.knowledge.listKnowledgeItemsByDoc, {
      docId,
      paginationOpts: {
        numItems: 10,
        cursor: null,
      },
    });

    expect(secondItemId).toBe(firstItemId);
    expect(page.page).toHaveLength(1);
    expect(page.page[0]?.content).toContain("aggregator");
    expect(page.page[0]?.priority).toBe(74);
  });

  test("rejects high-priority active item without corroborating sources", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const docId = await t.mutation(api.knowledge.upsertKnowledgeDoc, {
      slug: "skills-core",
      title: "Skills Core",
      kind: "skills",
      status: "active",
      summary: "global heuristics",
    });

    await expect(
      t.mutation(api.knowledge.addKnowledgeItem, {
        docId,
        key: "unsupported-high-priority",
        content: "Always do this with no corroboration.",
        confidence: 0.9,
        priority: 95,
        status: "active",
        sourceUrls: ["https://example.com/only-one"],
      }),
    ).rejects.toThrowError("high-priority active tactics require at least 2 corroborating source URLs");
  });

  test("stales expired items and markdown only includes active non-expired entries", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const docId = await t.mutation(api.knowledge.upsertKnowledgeDoc, {
      slug: "flights-carry-on",
      title: "Flights Carry-on",
      kind: "flights",
      status: "active",
      summary: "carry-on strategy",
    });

    const now = Date.now();
    await t.mutation(api.knowledge.addKnowledgeItem, {
      docId,
      key: "expired-rule",
      content: "Expired tactic should be downgraded.",
      confidence: 0.7,
      priority: 60,
      status: "active",
      sourceUrls: ["https://example.com/a", "https://example.com/b"],
      expiresAt: now - 5_000,
    });
    await t.mutation(api.knowledge.addKnowledgeItem, {
      docId,
      key: "active-rule",
      content: "This tactic should remain active.",
      confidence: 0.78,
      priority: 67,
      status: "active",
      sourceUrls: ["https://example.com/c", "https://example.com/d"],
      expiresAt: now + 60_000,
    });

    const maintenance = await t.mutation(api.knowledge.runKnowledgeMaintenance, {
      asOfMs: now,
      maxDocs: 20,
      maxItemsPerDoc: 50,
    });

    const markdown = await t.query(api.knowledge.generateKnowledgeMarkdown, {
      slug: "flights-carry-on",
      asOfMs: now,
    });

    const activePage = await t.query(api.knowledge.listKnowledgeItemsByDoc, {
      docId,
      status: "active",
      paginationOpts: {
        numItems: 10,
        cursor: null,
      },
    });

    const stalePage = await t.query(api.knowledge.listKnowledgeItemsByDoc, {
      docId,
      status: "stale",
      paginationOpts: {
        numItems: 10,
        cursor: null,
      },
    });

    expect(maintenance.itemsStaled).toBeGreaterThanOrEqual(1);
    expect(markdown.activeItems).toBe(1);
    expect(markdown.markdown).toContain("active-rule");
    expect(markdown.markdown).not.toContain("expired-rule");
    expect(activePage.page).toHaveLength(1);
    expect(stalePage.page).toHaveLength(1);
  });

  test("builds chat skill pack from skills plus domain playbooks", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);
    const now = Date.now();

    const skillsDocId = await t.mutation(api.knowledge.upsertKnowledgeDoc, {
      slug: "skills",
      title: "Global Skills",
      kind: "skills",
      status: "active",
      summary: "global guidance",
    });
    const flightsDocId = await t.mutation(api.knowledge.upsertKnowledgeDoc, {
      slug: "flights",
      title: "Flight Playbook",
      kind: "flights",
      status: "active",
      summary: "flight tactics",
    });

    await t.mutation(api.knowledge.addKnowledgeItem, {
      docId: skillsDocId,
      key: "global-checklist",
      content: "Always verify booking constraints before final shortlist.",
      confidence: 0.8,
      priority: 60,
      status: "active",
      sourceUrls: ["https://example.com/a", "https://example.com/b"],
    });
    await t.mutation(api.knowledge.addKnowledgeItem, {
      docId: flightsDocId,
      key: "fare-family-check",
      content: "Compare fare families for baggage and change rules.",
      confidence: 0.9,
      priority: 88,
      status: "active",
      sourceUrls: ["https://example.com/c", "https://example.com/d"],
    });
    await t.mutation(api.knowledge.addKnowledgeItem, {
      docId: flightsDocId,
      key: "expired-item",
      content: "Do not include this expired tactic.",
      confidence: 0.7,
      priority: 99,
      status: "active",
      sourceUrls: ["https://example.com/e", "https://example.com/f"],
      expiresAt: now - 1,
    });

    const pack = await t.query(internal.knowledge.getSkillPackForChatInternal, {
      domain: "flight",
      asOfMs: now,
      maxDocs: 6,
      maxItems: 24,
    });

    expect(pack.domain).toBe("flight");
    expect(pack.docs.some((doc) => doc.slug === "skills")).toBe(true);
    expect(pack.docs.some((doc) => doc.slug === "flights")).toBe(true);
    expect(pack.items.some((item) => item.key === "fare-family-check")).toBe(true);
    expect(pack.items.some((item) => item.key === "global-checklist")).toBe(true);
    expect(pack.items.some((item) => item.key === "expired-item")).toBe(false);
    expect(pack.items[0]?.priority).toBeGreaterThanOrEqual(pack.items[1]?.priority ?? 0);
  });
});
