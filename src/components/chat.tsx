"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import {
  ChatsCircle,
  List,
  NotePencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@convex/_generated/api";
import { ChatCanvas } from "@/components/chat-canvas";

function formatLastSeen(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function getReasoningText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
    .trim();
}

function hasVisibleAssistantContent(message: UIMessage) {
  if (message.role !== "assistant") {
    return false;
  }

  if ((message.text ?? "").trim().length > 0) {
    return true;
  }

  return getReasoningText(message).length > 0;
}

function MessageBubble({ message }: { message: UIMessage }) {
  const [visibleText] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });

  if (message.role === "system") {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="fade-rise mb-6 flex w-full justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--ink)] px-5 py-3 font-sans text-sm leading-relaxed text-white shadow-md">
          {message.text}
        </div>
      </div>
    );
  }

  const showSafetyFallback =
    message.status === "failed" && (message.text ?? "").trim().length === 0;
  const assistantText = showSafetyFallback
    ? "Response blocked by safety policies or model filtering."
    : visibleText;
  const reasoningText = getReasoningText(message);

  if (assistantText.trim().length === 0 && reasoningText.length === 0) {
    return null;
  }

  return (
    <div className="fade-rise mb-6 flex w-full justify-start">
      <div className="glass-bubble relative max-w-[86%] overflow-hidden rounded-2xl rounded-bl-sm px-6 py-4 font-mono text-sm leading-loose text-[var(--ink)] shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1 bg-[var(--ink)]/10" />
        {reasoningText.length > 0 ? (
          <details className="reasoning-block mb-3" open={message.status === "streaming"}>
            <summary>Thinking summary</summary>
            <div className="markdown-content mt-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningText}</ReactMarkdown>
            </div>
          </details>
        ) : null}
        {assistantText.trim().length > 0 ? (
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantText}</ReactMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Chat() {
  const threads = useQuery(api.chat.listThreads);
  const createThread = useMutation(api.chat.createThread);
  const renameThread = useMutation(api.chat.renameThread);
  const deleteThread = useMutation(api.chat.deleteThread);
  const sendPrompt = useMutation(api.chat.sendPrompt).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isComposingNewThread, setIsComposingNewThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const chatScrollerRef = useRef<HTMLDivElement | null>(null);

  const startNewThreadDraft = useCallback(() => {
    setIsComposingNewThread(true);
    setActiveThreadId(null);
    setIsSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!threads) {
      return;
    }

    if (isComposingNewThread) {
      return;
    }

    if (activeThreadId && threads.some((thread) => thread.threadId === activeThreadId)) {
      return;
    }

    if (threads.length > 0) {
      setActiveThreadId(threads[0].threadId);
      return;
    }
  }, [activeThreadId, isComposingNewThread, threads]);

  const activeThread = useMemo(
    () => threads?.find((thread) => thread.threadId === activeThreadId),
    [activeThreadId, threads],
  );
  const activeThreadIdForMessages = activeThread?.threadId ?? null;

  const messageFeed = useUIMessages(
    api.chat.listMessages,
    activeThreadIdForMessages ? { threadId: activeThreadIdForMessages } : "skip",
    { initialNumItems: 40, stream: true },
  );

  const messages = messageFeed.results;
  const visibleMessages = useMemo(
    () => (isComposingNewThread || !activeThreadIdForMessages ? [] : messages),
    [activeThreadIdForMessages, isComposingNewThread, messages],
  );
  const showWelcomeHero = visibleMessages.length === 0;
  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const hasVisibleStreamingAssistant = visibleMessages.some(
    (message) => message.status === "streaming" && hasVisibleAssistantContent(message),
  );

  useEffect(() => {
    const scroller = chatScrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [activeThreadIdForMessages, isStreaming, visibleMessages]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isSubmitting) {
      return;
    }

    setDraft("");
    setIsSubmitting(true);
    try {
      let threadId = activeThreadIdForMessages;
      if (!threadId) {
        const created = await createThread({});
        threadId = created.threadId;
        setIsComposingNewThread(false);
        setActiveThreadId(threadId);
      }

      await sendPrompt({ threadId, prompt });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameThread = async (threadId: string, currentTitle: string) => {
    const title = window.prompt("Rename thread", currentTitle)?.trim();
    if (!title) {
      return;
    }

    await renameThread({ threadId, title });
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) {
      return;
    }

    await deleteThread({ threadId });
    if (activeThreadId === threadId) {
      setIsComposingNewThread(false);
      setActiveThreadId(null);
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--bg-color)] text-[var(--ink)]">
      <div className="bg-grid" />
      <ChatCanvas />

      {isSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/20 backdrop-blur-[1px] md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      ) : null}

      <div className="relative z-30 mx-auto flex h-full w-full max-w-[1680px] gap-4 p-4 sm:px-8 sm:py-6">
        <aside
          className={clsx(
            "glass-bubble fixed inset-y-0 left-0 z-30 flex w-[300px] flex-col border-r border-black/5 p-4 transition-transform duration-300 md:static md:w-[320px] md:translate-x-0 md:rounded-3xl md:border",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--ink-light)]">
                Thread Memory
              </p>
              <h2 className="mt-1 font-serif text-2xl">Aura</h2>
            </div>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full text-[var(--ink-light)] hover:bg-black/5 md:hidden"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close thread panel"
            >
              <X size={18} />
            </button>
          </div>

          <button
            type="button"
            className="mb-4 inline-flex items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] shadow-[0_6px_18px_rgba(0,0,0,0.05)] transition hover:-translate-y-px hover:shadow-[0_8px_22px_rgba(0,0,0,0.08)]"
            onClick={startNewThreadDraft}
          >
            <Plus size={16} />
            New Thread
          </button>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {threads === undefined ? (
              <p className="pt-4 text-sm text-[var(--ink-light)]/70">Loading threads...</p>
            ) : threads.length === 0 ? (
              <p className="pt-4 text-sm text-[var(--ink-light)]/70">
                No threads yet. Start one from the button above.
              </p>
            ) : (
              threads.map((thread) => {
                const isActive = thread.threadId === activeThreadId;
                return (
                  <div
                    key={thread.threadId}
                    className={clsx(
                      "group rounded-2xl border px-3 py-3 transition",
                      isActive
                        ? "border-black/20 bg-white"
                        : "border-transparent bg-white/40 hover:border-black/10",
                    )}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        setIsComposingNewThread(false);
                        setActiveThreadId(thread.threadId);
                        setIsSidebarOpen(false);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-medium text-[var(--ink)]">
                          {thread.title}
                        </p>
                        <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--ink-light)]/70">
                          {formatLastSeen(thread.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--ink-light)]/80">
                        {thread.preview}
                      </p>
                    </button>

                    <div className="mt-3 flex items-center justify-end gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-full text-[var(--ink-light)] hover:bg-black/5"
                        onClick={() => void handleRenameThread(thread.threadId, thread.title)}
                        aria-label="Rename thread"
                      >
                        <NotePencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-full text-[var(--ink-light)] hover:bg-black/5"
                        onClick={() => void handleDeleteThread(thread.threadId)}
                        aria-label="Delete thread"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main className="glass-bubble relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-black/5 p-4 sm:p-6">
          <header className={clsx("shrink-0", showWelcomeHero ? "mb-4" : "mb-2")}>
            <div className="mb-2 flex items-center justify-start md:hidden">
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-[var(--ink)] shadow-sm md:hidden"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open thread panel"
              >
                <List size={18} />
              </button>
            </div>

            {showWelcomeHero ? (
              <>
                <h1 className="text-center font-serif text-4xl leading-[0.9] tracking-tight sm:text-6xl">
                  Aura
                  <span className="mt-2 block font-mono text-2xl text-[var(--ink-light)] sm:text-4xl">
                    Intelligence
                  </span>
                </h1>
                <p className="mt-4 text-center text-xs font-mono uppercase tracking-wider text-[var(--ink-light)]/70">
                  {activeThread?.title ?? "New chat"}
                </p>
              </>
            ) : (
              <p className="text-center text-[11px] font-mono uppercase tracking-[0.24em] text-[var(--ink-light)]/65">
                {activeThread?.title ?? "New chat"}
              </p>
            )}
          </header>

          <section
            ref={chatScrollerRef}
            className="min-h-0 flex-1 overflow-y-auto px-1 pb-24 pt-2 sm:px-4"
          >
            {visibleMessages.length === 0 ? (
              <div className="mt-14 text-center text-xs font-mono uppercase tracking-widest text-[var(--ink-light)]/55">
                System initialized. Awaiting input...
              </div>
            ) : (
              visibleMessages.map((message) => <MessageBubble key={message.key} message={message} />)
            )}

            {isStreaming && !hasVisibleStreamingAssistant ? (
              <div className="mb-6 flex w-full justify-start">
                <div className="glass-bubble flex h-11 items-center gap-1.5 rounded-2xl rounded-bl-sm px-5 py-4">
                  <div className="typing-dot size-1.5 rounded-full bg-[var(--ink)]/60" />
                  <div className="typing-dot size-1.5 rounded-full bg-[var(--ink)]/60" />
                  <div className="typing-dot size-1.5 rounded-full bg-[var(--ink)]/60" />
                </div>
              </div>
            ) : null}
          </section>

          <footer className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/95 to-transparent pb-5 pt-10">
            <div className="px-2 sm:px-4">
              <form onSubmit={handleSend} className="relative flex items-center">
                <div className="glow-wrapper w-full rounded-full bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                  <div className="flex items-center">
                    <input
                      type="text"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      autoComplete="off"
                      placeholder="Initialize query..."
                      className="w-full rounded-full bg-transparent px-6 py-4 font-mono text-sm text-[var(--ink)] placeholder:text-[var(--ink-light)]/40 focus:outline-none"
                      disabled={isSubmitting}
                    />
                    <button
                      type="submit"
                      className="mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white transition hover:bg-[var(--ink-light)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSubmitting || draft.trim().length === 0}
                      aria-label="Send message"
                    >
                      <ChatsCircle size={17} weight="fill" />
                    </button>
                  </div>
                </div>
              </form>
              <p className="mt-2 text-center text-[10px] font-mono text-[var(--ink-light)]/55">
                Aura may generate inaccurate responses. Verify critical logic and citations.
              </p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
