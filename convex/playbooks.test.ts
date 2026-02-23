import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const AUTH_IDENTITY = {
  tokenIdentifier: "test-user|editor",
  issuer: "https://example.test",
  subject: "user_editor",
};

describe("playbook curation", () => {
  test("upserts and lists playbooks", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const playbookId = await t.mutation(api.playbooks.upsertPlaybook, {
      slug: "general",
      title: "General Playbook",
      description: "Always-on guidance",
      kind: "general",
      scope: "always",
      riskClass: "safe",
      status: "active",
      contentMarkdown: "# general",
      sourceFile: "playbooks/general.md",
    });

    const listed = await t.query(api.playbooks.listPlaybooks, {
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
    });

    const editorDoc = await t.query(api.playbooks.getPlaybookForEditor, {
      playbookId,
    });

    expect(listed.page.some((doc) => doc.slug === "general")).toBe(true);
    expect(editorDoc?.contentMarkdown).toBe("# general");
  });

  test("builds chat catalog and skill pack from active playbooks", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    await t.mutation(api.playbooks.upsertPlaybook, {
      slug: "general",
      title: "General",
      description: "General summary",
      kind: "general",
      scope: "always",
      riskClass: "safe",
      status: "active",
      contentMarkdown: "General guidance",
    });
    await t.mutation(api.playbooks.upsertPlaybook, {
      slug: "flights",
      title: "Flights",
      description: "Flights summary",
      kind: "flights",
      scope: "conditional",
      riskClass: "safe",
      status: "active",
      contentMarkdown: "Flights guidance",
    });

    const catalog = await t.query(internal.playbooks.getSkillCatalogForChatInternal, {
      asOfMs: Date.now(),
      maxGeneralHints: 10,
    });
    const pack = await t.query(internal.playbooks.getSkillPackBySlugsInternal, {
      skillSlugs: ["skills", "flights"],
      asOfMs: Date.now(),
    });

    expect(catalog.availableSkills.some((doc) => doc.slug === "general")).toBe(true);
    expect(catalog.generalHints.length).toBe(1);
    expect(pack.selectedSkills).toEqual(["general", "flights"]);
    expect(pack.hints.some((hint) => hint.includes("[general]"))).toBe(true);
  });

  test("syncPlaybooksFromSourceInternal upserts markdown sources", async () => {
    const t = convexTest(schema, modules).withIdentity(AUTH_IDENTITY);

    const synced = await t.mutation(internal.playbooks.syncPlaybooksFromSourceInternal, {
      entries: [
        {
          slug: "general",
          title: "General Playbook",
          description: "Synced general",
          kind: "general",
          scope: "always",
          riskClass: "safe",
          status: "active",
          sourceFile: "playbooks/general.md",
          contentMarkdown: "# general sync",
        },
      ],
    });

    const listed = await t.query(api.playbooks.listPlaybooks, {
      paginationOpts: {
        numItems: 10,
        cursor: null,
      },
    });

    expect(synced.upserted).toBe(1);
    expect(listed.page[0]?.slug).toBe("general");
    expect(listed.page[0]?.contentMarkdown).toBe("# general sync");
  });
});
