import type { UIMessage } from "@convex-dev/agent/react";

export type AssistantVariant = {
  id: string;
  message: UIMessage;
  isTransient: boolean;
  hasRenderableContent: boolean;
  hasReasoning: boolean;
};

export type LatestTurnSnapshot = {
  historyMessages: UIMessage[];
  latestUserMessage: UIMessage | null;
  latestTurnAssistantMessages: UIMessage[];
  persistedVariants: AssistantVariant[];
  transientVariants: AssistantVariant[];
  latestPersistedVariant: AssistantVariant | null;
  latestTransientVariant: AssistantVariant | null;
};

export function getMessageIdentity(message: UIMessage) {
  return message.id ?? message.key;
}

function getMessageReasoningText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
    .trim();
}

function hasRenderableAssistantContent(message: UIMessage) {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.status === "failed") {
    return true;
  }
  const plainText = (message.text ?? "").trim();
  if (plainText.length > 0) {
    return true;
  }
  return getMessageReasoningText(message).length > 0;
}

export function buildLatestTurnSnapshot(messages: UIMessage[]): LatestTurnSnapshot {
  let latestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      latestUserIndex = i;
      break;
    }
  }

  if (latestUserIndex < 0) {
    return {
      historyMessages: messages,
      latestUserMessage: null,
      latestTurnAssistantMessages: [],
      persistedVariants: [],
      transientVariants: [],
      latestPersistedVariant: null,
      latestTransientVariant: null,
    };
  }

  const latestUserMessage = messages[latestUserIndex] ?? null;
  const latestTurnAssistantMessages: UIMessage[] = [];
  for (let i = latestUserIndex + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === "user") {
      break;
    }
    if (message.role === "assistant") {
      latestTurnAssistantMessages.push(message);
    }
  }

  const variants = latestTurnAssistantMessages.map<AssistantVariant>((message) => {
    const isTransient = message.status === "pending" || message.status === "streaming";
    const hasReasoning = getMessageReasoningText(message).length > 0;
    return {
      id: getMessageIdentity(message),
      message,
      isTransient,
      hasRenderableContent: hasRenderableAssistantContent(message),
      hasReasoning,
    };
  });

  const persistedVariants = variants.filter((variant) => !variant.isTransient && variant.hasRenderableContent);
  const transientVariants = variants.filter((variant) => variant.isTransient);

  return {
    historyMessages: messages.slice(0, latestUserIndex + 1),
    latestUserMessage,
    latestTurnAssistantMessages,
    persistedVariants,
    transientVariants,
    latestPersistedVariant: persistedVariants.at(-1) ?? null,
    latestTransientVariant: transientVariants.at(-1) ?? null,
  };
}

export function resolveSelectedVariantId(args: {
  previousSelectedVariantId: string | null;
  persistedVariants: AssistantVariant[];
  freezeAutoLatest?: boolean;
  previousVariantCount?: number;
}) {
  const { previousSelectedVariantId, persistedVariants, freezeAutoLatest = false, previousVariantCount = 0 } = args;
  if (persistedVariants.length === 0) {
    return null;
  }

  if (previousSelectedVariantId) {
    const stillExists = persistedVariants.some((variant) => variant.id === previousSelectedVariantId);
    if (stillExists) {
      return previousSelectedVariantId;
    }
  }

  if (freezeAutoLatest && previousVariantCount < persistedVariants.length) {
    return previousSelectedVariantId ?? persistedVariants.at(-1)?.id ?? null;
  }

  return persistedVariants.at(-1)?.id ?? null;
}
