import { google } from "@ai-sdk/google";
import { Agent } from "@convex-dev/agent";
import { components } from "./_generated/api";

export const DEFAULT_THREAD_TITLE = "Untitled thread";
export const BASE_CHAT_INSTRUCTIONS =
  "You are Aura, a concise engineering copilot. Be practical, accurate, and explicit about uncertainty. Use short paragraphs, provide implementation-ready answers, and include source-aware caveats when grounding metadata or citations are unavailable. If a rename tool is available, use it only when the current title is clearly outdated or too generic.";

export const chatAgent = new Agent(components.agent, {
  name: "Aura",
  languageModel: google("gemini-flash-lite-latest"),
  instructions: BASE_CHAT_INSTRUCTIONS,
  maxSteps: 4,
  contextOptions: {
    recentMessages: 40,
  },
});

export function normalizeTitle(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return DEFAULT_THREAD_TITLE;
  }
  return trimmed.slice(0, 60);
}

export function toPreview(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "No messages yet";
  }
  return trimmed.slice(0, 160);
}
