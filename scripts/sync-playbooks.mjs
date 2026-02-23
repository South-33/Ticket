import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const ROOT = process.cwd();

function loadEnvFromFile(fileName) {
  try {
    const envText = readFileSync(join(ROOT, fileName), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore missing env file
  }
}

loadEnvFromFile(".env.local");
loadEnvFromFile(".env");

const PLAYBOOK_SPECS = [
  {
    slug: "general",
    fileName: "general.md",
    title: "General Playbook",
    description: "Always-on cross-domain guidance and playbook catalog.",
    kind: "general",
    scope: "always",
    riskClass: "safe",
  },
  {
    slug: "flights",
    fileName: "flights.md",
    title: "Flights Playbook",
    description: "Flight search workflow, tactics, validation, and ranking rules.",
    kind: "flights",
    scope: "conditional",
    riskClass: "safe",
  },
  {
    slug: "train",
    fileName: "train.md",
    title: "Train Playbook",
    description: "Rail search workflow, route checks, and fare strategy guidance.",
    kind: "train",
    scope: "conditional",
    riskClass: "safe",
  },
  {
    slug: "concert",
    fileName: "concert.md",
    title: "Concert Playbook",
    description: "Event ticket search strategy, verification checks, and ranking rules.",
    kind: "concert",
    scope: "conditional",
    riskClass: "safe",
  },
  {
    slug: "flights_grey_tactics",
    fileName: "flights_grey_tactics.md",
    title: "Flights Grey Tactics",
    description: "Opt-in grey-area flight tactics with explicit risk caveats.",
    kind: "flights_grey_tactics",
    scope: "opt_in",
    riskClass: "grey",
  },
];

const entries = PLAYBOOK_SPECS.map((spec) => {
  const filePath = join(ROOT, "playbooks", spec.fileName);
  const contentMarkdown = readFileSync(filePath, "utf8");
  return {
    slug: spec.slug,
    title: spec.title,
    description: spec.description,
    kind: spec.kind,
    scope: spec.scope,
    riskClass: spec.riskClass,
    status: "active",
    sourceFile: `playbooks/${spec.fileName}`,
    contentMarkdown,
  };
});

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!convexUrl) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) for playbook sync.");
  process.exit(1);
}

const client = new ConvexHttpClient(convexUrl);
const syncToken = process.env.PLAYBOOK_SYNC_TOKEN;

for (const entry of entries) {
  await client.mutation(api.playbooks.syncPlaybookFromSource, {
    syncToken,
    entry,
  });
}

console.log(`[playbooks:sync] synced ${entries.length} playbooks`);
