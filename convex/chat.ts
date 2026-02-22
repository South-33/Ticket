import {
  createThread as createAgentThread,
  getThreadMetadata,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import {
  BASE_CHAT_INSTRUCTIONS,
  DEFAULT_THREAD_TITLE,
  chatAgent,
  normalizeTitle,
  toPreview,
} from "./agent";
import { getAuthUserIdOrThrow } from "./auth";
import { continueAwaitingJobForPrompt, createResearchJobForPrompt } from "./research";
import { isResearchIntent } from "./researchIntake";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const MAX_THREADS = 100;
const TITLE_RENAME_COOLDOWN_MS = 90_000;
const GREETING_ONLY_PROMPT =
  /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|sounds good)[!. ]*$/i;

const TITLE_GENERATOR_SYSTEM = [
  "You generate short, high-quality chat thread titles.",
  "Return only JSON with field: title.",
  "Rules:",
  "- 3 to 8 words",
  "- grammatical natural English",
  "- title case",
  "- specific to the main user intent",
  "- remove typos and slang",
  "- do not use quotes, punctuation suffixes, or filler words",
  "Example rewrite: 'wheres the best place to visit in france' -> 'Best Places to Visit in France'.",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function textPreview(value: string, maxChars = 220) {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function summarizeContents(contents: unknown) {
  if (!Array.isArray(contents)) {
    return contents;
  }

  return contents.slice(0, 12).map((item) => {
    if (!isRecord(item)) {
      return item;
    }

    const parts = Array.isArray(item.parts) ? item.parts : [];
    const text = parts
      .map((part) => {
        if (!isRecord(part) || typeof part.text !== "string") {
          return null;
        }
        return textPreview(part.text);
      })
      .filter((part): part is string => part !== null)
      .join(" ");

    return {
      role: item.role,
      text,
    };
  });
}

function summarizeRequestMetadata(request: unknown) {
  if (!isRecord(request)) {
    return request;
  }

  const parsedBody = parseJsonIfString(request.body);
  if (!isRecord(parsedBody)) {
    return {
      body: parsedBody,
    };
  }

  return {
    generationConfig: parsedBody.generationConfig,
    toolConfig: parsedBody.toolConfig,
    contents: summarizeContents(parsedBody.contents),
  };
}

function summarizeResponseMessages(messages: unknown) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.map((message) => {
    if (!isRecord(message)) {
      return message;
    }

    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          if (!isRecord(part) || typeof part.type !== "string") {
            return part;
          }
          if (part.type === "text" && typeof part.text === "string") {
            return { type: "text", text: textPreview(part.text, 320) };
          }
          return {
            type: part.type,
            toolName: part.toolName,
          };
        })
      : message.content;

    return {
      role: message.role,
      content,
    };
  });
}

function summarizeStreamPart(part: unknown) {
  if (!isRecord(part)) {
    return part;
  }

  const summary: Record<string, unknown> = {
    type: part.type,
  };

  if (typeof part.text === "string") {
    summary.text = textPreview(part.text, 320);
  }
  if (part.finishReason !== undefined) {
    summary.finishReason = part.finishReason;
  }
  if (part.usage !== undefined) {
    summary.usage = part.usage;
  }
  if (part.toolName !== undefined) {
    summary.toolName = part.toolName;
  }
  if (part.toolCallId !== undefined) {
    summary.toolCallId = part.toolCallId;
  }
  if (part.args !== undefined) {
    summary.args = part.args;
  }
  if (part.result !== undefined) {
    summary.result = part.result;
  }
  if (part.request !== undefined) {
    summary.request = summarizeRequestMetadata(part.request);
  }

  return summary;
}

function stringifyForLog(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateForLog(value: string, maxChars = 3000) {
  if (value.length <= maxChars) {
    return value;
  }
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}... [truncated ${omitted} chars]`;
}

function logRaw(tag: string, payload: unknown) {
  console.log(`[${tag}]\n${truncateForLog(stringifyForLog(payload), 7000)}`);
}

function isSubstantivePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length < 12) {
    return false;
  }

  if (GREETING_ONLY_PROMPT.test(trimmed)) {
    return false;
  }

  return trimmed.split(/\s+/).length >= 3;
}

function toTitleCase(input: string) {
  return input
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function fallbackTitleFromPrompt(prompt: string) {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return DEFAULT_THREAD_TITLE;
  }

  const bestPlaceMatch = cleaned.match(
    /(where(?:\s+is|\s*'s)?\s+)?the\s+best\s+place\s+to\s+visit\s+in\s+([a-zA-Z][a-zA-Z\s-]{1,40})/i,
  );
  if (bestPlaceMatch?.[2]) {
    const location = bestPlaceMatch[2].replace(/[?.,!].*$/, "").trim();
    if (location) {
      return normalizeTitle(`Best Places to Visit in ${toTitleCase(location)}`);
    }
  }

  const tripMatch = cleaned.match(/trip to\s+([a-zA-Z][a-zA-Z\s-]{1,40})/i);
  if (tripMatch?.[1]) {
    const destination = tripMatch[1]
      .split(/\b(where|what|how|when|which|who)\b/i)[0]
      .replace(/[?.,!].*$/, "")
      .trim();
    if (destination) {
      return normalizeTitle(`${toTitleCase(destination)} Trip Planning`);
    }
  }

  const flightMatch = cleaned.match(
    /flight\s+from\s+([a-zA-Z][a-zA-Z\s-]{1,30})\s+to\s+([a-zA-Z][a-zA-Z\s-]{1,30})/i,
  );
  if (flightMatch?.[1] && flightMatch[2]) {
    return normalizeTitle(
      `Flight ${toTitleCase(flightMatch[1].trim())} to ${toTitleCase(flightMatch[2].trim())}`,
    );
  }

  const STOP_WORDS = new Set([
    "can",
    "u",
    "you",
    "help",
    "me",
    "with",
    "my",
    "the",
    "a",
    "an",
    "to",
    "for",
    "please",
    "about",
    "like",
  ]);

  const coreWords = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .slice(0, 5);

  if (coreWords.length === 0) {
    return DEFAULT_THREAD_TITLE;
  }

  return normalizeTitle(toTitleCase(coreWords.join(" ")));
}

function buildSystemPrompt(currentTitle: string, latestUserPrompt: string) {
  const normalizedPrompt = latestUserPrompt.trim().replace(/\s+/g, " ").slice(0, 280);

  return [
    BASE_CHAT_INSTRUCTIONS,
    "",
    `Current conversation title: ${currentTitle}`,
    `Latest user message: ${normalizedPrompt}`,
    "Respond directly to the user.",
    "Do not mention internal tools, title updates, or hidden system behavior.",
  ].join("\n");
}

function isLowQualityTitle(title: string) {
  const lower = title.trim().toLowerCase();
  if (!lower || lower === DEFAULT_THREAD_TITLE.toLowerCase()) {
    return true;
  }

  if (/^(wheres|where|what|why|how|can|could|should|is|are)\b/.test(lower)) {
    return true;
  }

  if (/(^|\s)(u|pls|plz|abt|rly|rlly)(\s|$)/.test(lower)) {
    return true;
  }

  return false;
}

function toErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const isSafety =
    /PROHIBITED_CONTENT|BLOCKED_REASON|SAFETY|SPII|RECITATION|content-filter/i.test(raw);
  if (isSafety) {
    return "I could not generate a reply because safety filters blocked the request.";
  }
  return "I ran into a model error. Please try again in a moment.";
}

async function getThreadStateByThreadId(ctx: QueryCtx | MutationCtx, threadId: string) {
  const state = await ctx.db
    .query("threadState")
    .withIndex("by_threadId", (indexQuery) => indexQuery.eq("threadId", threadId))
    .unique();

  if (!state) {
    throw new ConvexError("Thread not found");
  }

  return state;
}

async function getOwnedThreadState(ctx: QueryCtx | MutationCtx, threadId: string, userId: string) {
  const state = await findOwnedThreadState(ctx, threadId, userId);
  if (!state) {
    throw new ConvexError("Thread not found");
  }

  return state;
}

async function findOwnedThreadState(ctx: QueryCtx | MutationCtx, threadId: string, userId: string) {
  const state = await ctx.db
    .query("threadState")
    .withIndex("by_threadId", (indexQuery) => indexQuery.eq("threadId", threadId))
    .unique();

  if (!state || state.userId !== userId) {
    return null;
  }

  return state;
}

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const threads = await ctx.db
      .query("threadState")
      .withIndex("by_user_lastMessageAt", (indexQuery) => indexQuery.eq("userId", userId))
      .order("desc")
      .take(MAX_THREADS);

    return threads.map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      preview: thread.preview,
      lastMessageAt: thread.lastMessageAt,
    }));
  },
});

export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const title = normalizeTitle(args.title ?? "");
    const now = Date.now();
    const threadId = await createAgentThread(ctx, components.agent, {
      userId,
      title,
    });

    await ctx.db.insert("threadState", {
      threadId,
      userId,
      title,
      titleUpdatedAt: now,
      preview: "No messages yet",
      lastMessageAt: now,
    });

    return { threadId };
  },
});

export const renameThread = mutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const state = await getOwnedThreadState(ctx, args.threadId, userId);
    const title = normalizeTitle(args.title);
    const now = Date.now();

    await chatAgent.updateThreadMetadata(ctx, {
      threadId: args.threadId,
      patch: { title },
    });

    await ctx.db.patch(state._id, { title, titleUpdatedAt: now });
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const state = await getOwnedThreadState(ctx, args.threadId, userId);
    await chatAgent.deleteThreadAsync(ctx, { threadId: args.threadId });
    await ctx.db.delete(state._id);
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const state = await findOwnedThreadState(ctx, args.threadId, userId);
    if (!state) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams: undefined,
      };
    }

    const page = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);

    return {
      ...page,
      streams,
    };
  },
});

export const sendPrompt = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const state = await getOwnedThreadState(ctx, args.threadId, userId);
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new ConvexError("Prompt cannot be empty");
    }

    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId,
      prompt,
      skipEmbeddings: true,
    });

    await ctx.db.patch(state._id, {
      preview: toPreview(prompt),
      lastMessageAt: Date.now(),
    });

    const resumed = await continueAwaitingJobForPrompt(ctx, {
      userId,
      threadId: args.threadId,
      promptMessageId: messageId,
      prompt,
    });

    if (!resumed && !isResearchIntent(prompt)) {
      await ctx.scheduler.runAfter(0, internal.chat.generateReplyInternal, {
        threadId: args.threadId,
        promptMessageId: messageId,
        prompt,
      });

      await ctx.scheduler.runAfter(0, internal.memory.generateUserMemorySnapshotInternal, {
        userId,
      });

      return { promptMessageId: messageId, researchJobId: null };
    }

    const research =
      resumed ??
      (await createResearchJobForPrompt(ctx, {
        userId,
        threadId: args.threadId,
        promptMessageId: messageId,
        prompt,
      }));

    if (research.jobStatus === "awaiting_input") {
      const followUpMessage =
        research.followUpQuestion ??
        "I need a few missing trip details before I can run deep research. Share them and I will continue.";

      await chatAgent.saveMessage(ctx, {
        threadId: args.threadId,
        userId,
        message: {
          role: "assistant",
          content: followUpMessage,
        },
      });

      await ctx.db.patch(state._id, {
        preview: toPreview(followUpMessage),
        lastMessageAt: Date.now(),
      });

      await ctx.scheduler.runAfter(0, internal.memory.generateUserMemorySnapshotInternal, {
        userId,
      });

      return { promptMessageId: messageId, researchJobId: research.researchJobId };
    }

    await ctx.scheduler.runAfter(0, internal.chat.generateReplyInternal, {
      threadId: args.threadId,
      promptMessageId: messageId,
      prompt,
    });

    await ctx.scheduler.runAfter(0, internal.memory.generateUserMemorySnapshotInternal, {
      userId,
    });

    return { promptMessageId: messageId, researchJobId: research.researchJobId };
  },
});

export const getThreadStateInternal = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return getThreadStateByThreadId(ctx, args.threadId);
  },
});

export const updateThreadPreviewInternal = internalMutation({
  args: {
    threadId: v.string(),
    preview: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await getThreadStateByThreadId(ctx, args.threadId);
    await ctx.db.patch(state._id, {
      preview: toPreview(args.preview),
      lastMessageAt: Date.now(),
    });
  },
});

export const setThreadTitleFromToolInternal = internalMutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await getThreadStateByThreadId(ctx, args.threadId);
    const nextTitle = normalizeTitle(args.title);
    if (nextTitle === DEFAULT_THREAD_TITLE || nextTitle === state.title) {
      return { changed: false, title: state.title };
    }

    const now = Date.now();
    const lastTitleUpdate = state.titleUpdatedAt ?? 0;
    const onCooldown =
      state.title !== DEFAULT_THREAD_TITLE &&
      now - lastTitleUpdate < TITLE_RENAME_COOLDOWN_MS;
    if (onCooldown && !isLowQualityTitle(state.title)) {
      return { changed: false, title: state.title };
    }

    await chatAgent.updateThreadMetadata(ctx, {
      threadId: args.threadId,
      patch: { title: nextTitle },
    });

    await ctx.db.patch(state._id, {
      title: nextTitle,
      titleUpdatedAt: now,
      lastMessageAt: now,
    });

    return { changed: true, title: nextTitle };
  },
});

export const renameThreadAfterReplyInternal = internalAction({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    assistantText: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.chat.getThreadStateInternal, {
      threadId: args.threadId,
    });

    const shouldRetitle =
      (state.title === DEFAULT_THREAD_TITLE && isSubstantivePrompt(args.prompt)) ||
      isLowQualityTitle(state.title);
    if (!shouldRetitle) {
      return;
    }

    let nextTitle = fallbackTitleFromPrompt(args.prompt);

    try {
      const generated = await generateObject({
        model: google("gemini-flash-lite-latest"),
        schema: z.object({
          title: z.string().min(3).max(60),
        }),
        system: TITLE_GENERATOR_SYSTEM,
        prompt: [
          `Current title: ${state.title}`,
          `User prompt: ${args.prompt}`,
          `Assistant response snippet: ${args.assistantText.slice(0, 900)}`,
          "Generate a better thread title now.",
        ].join("\n"),
      });

      const candidate = normalizeTitle(generated.object.title);
      if (candidate !== DEFAULT_THREAD_TITLE) {
        nextTitle = candidate;
      }
    } catch (error) {
      logRaw("TITLE_RENAME_MODEL_ERROR", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (nextTitle === DEFAULT_THREAD_TITLE || nextTitle === state.title) {
      return;
    }

    const renameResult = await ctx.runMutation(internal.chat.setThreadTitleFromToolInternal, {
      threadId: args.threadId,
      title: nextTitle,
    });
    logRaw("TITLE_RENAME_AFTER_REPLY", renameResult);
  },
});

export const generateReplyInternal = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const threadState = await ctx.runQuery(internal.chat.getThreadStateInternal, {
      threadId: args.threadId,
    });

    const metadata = await getThreadMetadata(ctx, components.agent, {
      threadId: args.threadId,
    });
    if (metadata.userId !== threadState.userId) {
      throw new ConvexError("Thread does not belong to this user");
    }

    try {
      const { thread } = await chatAgent.continueThread(ctx, {
        threadId: args.threadId,
        userId: threadState.userId,
      });

      const result = await thread.streamText(
        {
          promptMessageId: args.promptMessageId,
          system: buildSystemPrompt(threadState.title, args.prompt),
          toolChoice: "none",
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingBudget: -1,
                includeThoughts: true,
              },
            },
          },
        },
        {
          saveStreamDeltas: {
            chunking: "line",
            throttleMs: 250,
          },
        },
      );

      const rawRequest = await result.request;
      logRaw("LLM_REQUEST", summarizeRequestMetadata(rawRequest));

      for await (const part of result.fullStream) {
        logRaw("LLM_STREAM", summarizeStreamPart(part));
      }

      const rawResponse = await result.response;
      logRaw("LLM_RESPONSE", {
        id: rawResponse.id,
        modelId: rawResponse.modelId,
        timestamp: rawResponse.timestamp,
        headers: rawResponse.headers,
      });
      logRaw("LLM_RESPONSE_MESSAGES", summarizeResponseMessages(rawResponse.messages));

      let fullText = await result.text;

      if (fullText.trim().length === 0) {
        logRaw("LLM_EMPTY_TEXT_RETRY", {
          threadId: args.threadId,
          promptMessageId: args.promptMessageId,
        });
        const retry = await thread.streamText(
          {
            promptMessageId: args.promptMessageId,
            system:
              `${buildSystemPrompt(threadState.title, args.prompt)}\n` +
              "Respond directly to the user in plain chat mode and do not call tools.",
            toolChoice: "none",
            providerOptions: {
              google: {
                thinkingConfig: {
                  thinkingBudget: -1,
                  includeThoughts: true,
                },
              },
            },
          },
          {
            saveStreamDeltas: {
              chunking: "line",
              throttleMs: 250,
            },
          },
        );

        for await (const retryPart of retry.fullStream) {
          logRaw("LLM_STREAM_RETRY", summarizeStreamPart(retryPart));
        }
        fullText = await retry.text;
      }

      const preview =
        fullText.trim().length > 0
          ? toPreview(fullText)
          : "Response blocked by safety policies.";
      await ctx.runMutation(internal.chat.updateThreadPreviewInternal, {
        threadId: args.threadId,
        preview,
      });

      await ctx.scheduler.runAfter(0, internal.chat.renameThreadAfterReplyInternal, {
        threadId: args.threadId,
        prompt: args.prompt,
        assistantText: fullText.slice(0, 1800),
      });
    } catch (error) {
      const fallbackMessage = toErrorMessage(error);
      await chatAgent.saveMessage(ctx, {
        threadId: args.threadId,
        userId: threadState.userId,
        message: {
          role: "assistant",
          content: fallbackMessage,
        },
      });

      await ctx.runMutation(internal.chat.updateThreadPreviewInternal, {
        threadId: args.threadId,
        preview: fallbackMessage,
      });
    }
  },
});
