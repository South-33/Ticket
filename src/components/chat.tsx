"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { SignInButton, UserProfile, useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@convex/_generated/api";
import { ChatCanvas } from "@/components/chat-canvas";

function SidebarUser() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const cachedAvatarUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("aura:lastAvatarUrl");
  }, []);

  const cachedInitials = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("aura:lastAvatarInitial");
  }, []);

  const initials =
    user?.firstName?.[0] ??
    user?.emailAddresses?.[0]?.emailAddress?.[0] ??
    cachedInitials?.[0] ??
    "?";
  const avatarUrl = user?.imageUrl ?? cachedAvatarUrl;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (user?.imageUrl) {
      window.localStorage.setItem("aura:lastAvatarUrl", user.imageUrl);
    }

    if (initials && initials !== "?") {
      window.localStorage.setItem("aura:lastAvatarInitial", initials);
    }
  }, [initials, user?.imageUrl]);

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setOpen(false);
      setIsClosing(false);
    }, 250);
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <div className="sidebar-user">
        <button
          className="sidebar-avatar-btn"
          onClick={() => setOpen(true)}
          title="Manage account"
          type="button"
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={initials}
              className="sidebar-avatar-img"
              width={28}
              height={28}
              unoptimized
            />
          ) : (
            <span className="sidebar-avatar-initials">{initials.toUpperCase()}</span>
          )}
        </button>
      </div>

      {open && createPortal(
        <div
          className="user-modal-backdrop"
          data-closing={isClosing ? "true" : undefined}
          onClick={closeModal}
        >
          <div className="user-modal-content" onClick={(e) => e.stopPropagation()}>
            <UserProfile routing="hash" />
            <div className="user-modal-footer">
              <button
                className="user-modal-signout"
                type="button"
                onClick={() => {
                  window.localStorage.removeItem("aura:lastAvatarUrl");
                  window.localStorage.removeItem("aura:lastAvatarInitial");
                  window.localStorage.removeItem(SIDEBAR_LAST_USER_ID_KEY);
                  signOut();
                }}
              >
                Sign Out _&gt;
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const INTRO_RESPONSE =
  "I can help you find better flight deals with AI-assisted deep research.\n\n" +
  "I compare route combinations, scan timing windows, cross-check fare rules, and verify options before recommending them. " +
  "I can also prioritize what matters most to you: lowest price, shortest duration, fewer layovers, or flexible change policies.\n\n" +
  "Share your route, dates, and constraints, and I will return a clear, verifiable shortlist.";

const TYPEWRITER_INITIAL_DELAY_MS = 0;
const TYPEWRITER_MIN_DELAY_MS = 0;
const TYPEWRITER_VARIANCE_MS = 2;
const TYPEWRITER_PUNCTUATION_PAUSE_MS = 25;
const THREAD_SWITCH_FADE_MS = 500;
const THREAD_SWITCH_REVEAL_DELAY_MS = 120;
const THREAD_SWITCH_FAILSAFE_MS = 5000;

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const SIDEBAR_HISTORY_CACHE_KEY_PREFIX = "aura:sidebarHistory:v1";
const SIDEBAR_LAST_USER_ID_KEY = "aura:lastUserId";
const MAX_CACHED_SIDEBAR_THREADS = 8;

const TERMINAL_RESEARCH_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

type CachedSidebarThread = {
  threadId: string;
  title: string;
};

const subscribeNoop = () => {
  return () => {};
};

function getSidebarHistoryCacheKey(userId: string | undefined) {
  return `${SIDEBAR_HISTORY_CACHE_KEY_PREFIX}:${userId ?? "anon"}`;
}

function readCachedSidebarThreads(cacheKey: string): CachedSidebarThread[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const threadId = (item as Record<string, unknown>).threadId;
        const title = (item as Record<string, unknown>).title;
        if (typeof threadId !== "string" || typeof title !== "string") {
          return null;
        }
        return { threadId, title };
      })
      .filter((item): item is CachedSidebarThread => item !== null)
      .slice(0, MAX_CACHED_SIDEBAR_THREADS);
  } catch {
    return [];
  }
}

function writeCachedSidebarThreads(cacheKey: string, threads: CachedSidebarThread[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(threads.slice(0, MAX_CACHED_SIDEBAR_THREADS)));
  } catch {
    // Ignore localStorage write failures.
  }
}

function toResearchStatusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "verifying":
      return "Verifying";
    case "synthesizing":
      return "Synthesizing";
    case "running":
      return "Running";
    case "planned":
      return "Planned";
    case "awaiting_input":
      return "Awaiting Input";
    default:
      return "Queued";
  }
}

function toCandidateLabel(category: string) {
  if (category === "cheapest") {
    return "Cheapest";
  }
  if (category === "best_value") {
    return "Best Value";
  }
  if (category === "most_convenient") {
    return "Most Convenient";
  }
  return category;
}

function formatUtcTimestamp(value: number | undefined) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function freshnessLabel(recheckAfter: number | undefined) {
  if (!recheckAfter) {
    return "unknown";
  }
  return recheckAfter <= Date.now() ? "stale" : "fresh";
}

function getReasoningText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
    .trim();
}

function getReasoningKeyPoints(reasoning: string) {
  const cleaned = reasoning.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [] as string[];
  }

  const blocks = cleaned.split(/\n\s*\n+/);
  const points: string[] = [];

  for (const block of blocks) {
    const firstLine = block.split("\n")[0]?.trim();
    if (!firstLine) {
      continue;
    }

    let point = "";
    const markdownHeading = firstLine.match(/^#{1,6}\s+(.+)$/);
    const boldHeading = firstLine.match(/^\*\*(.+)\*\*$/);

    if (markdownHeading) {
      point = markdownHeading[1].trim();
    } else if (boldHeading) {
      point = boldHeading[1].trim();
    } else if (firstLine.length <= 90 && !/[.!?:;]$/.test(firstLine)) {
      point = firstLine;
    }

    if (!point) {
      continue;
    }

    if (!points.includes(point)) {
      points.push(point);
    }
    if (points.length >= 5) {
      break;
    }
  }

  return points;
}

function Message({ message, index }: { message: UIMessage; index: number }) {
  const reasoning = getReasoningText(message);
  const [visibleText, smoothTextState] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });
  const [visibleReasoning, smoothReasoningState] = useSmoothText(reasoning, {
    startStreaming: message.status === "streaming",
  });
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const isReasoningExpanded = isReasoningOpen;
  const isReasoningTypewriterActive = message.status === "streaming" || smoothReasoningState.isStreaming;
  const displayReasoning = isReasoningTypewriterActive ? visibleReasoning : reasoning;
  const reasoningKeyPoints = useMemo(
    () => getReasoningKeyPoints(displayReasoning),
    [displayReasoning],
  );

  if (message.role === "system") {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="message user" style={{ animationDelay: `${Math.min(index * 0.08, 0.6)}s` }}>
        <div className="message-wrapper">
          <div className="message-meta">User Query</div>
          <div className="message-content">{message.text}</div>
        </div>
      </div>
    );
  }

  const safetyFallback = message.status === "failed" && !(message.text ?? "").trim();
  const displayText = safetyFallback ? "Response blocked by safety policies." : visibleText;
  const isTypewriterActive = message.status === "streaming" || smoothTextState.isStreaming;

  if (!displayText.trim() && !displayReasoning.trim() && !isTypewriterActive && !isReasoningTypewriterActive) {
    return null;
  }

  return (
    <div className="message ai" style={{ animationDelay: `${Math.min(index * 0.08, 0.6)}s` }}>
      {(displayReasoning || isReasoningTypewriterActive) && (
        <div className="reasoning-container">
          <div className={clsx("reasoning-block", isReasoningExpanded && "open")}>
            <button
              className="reasoning-summary"
              onClick={() => setIsReasoningOpen((current) => !current)}
              type="button"
            >
              Synthesis Process
            </button>
            <div className={clsx("reasoning-points-shell", !isReasoningExpanded && "visible")}>
              {reasoningKeyPoints.length > 0 && (
                <ul className="reasoning-points">
                  {reasoningKeyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className={clsx("reasoning-accordion", isReasoningExpanded && "open")}>
              <div className="reasoning-content-wrapper">
                <div className="message-content reasoning-content">
                  {isReasoningTypewriterActive ? (
                    <>
                      <span className="streaming-text">{displayReasoning}</span>
                      <span className="typewriter-cursor reasoning-cursor" />
                    </>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayReasoning.trim()}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="response-container">
        <div className="message-meta">
          {isTypewriterActive ? "Aura Processing" : "Aura Response"}
        </div>
        {(displayText || isTypewriterActive) && (
          <div className="message-content">
            {isTypewriterActive ? (
              <>
                <span className="streaming-text">{displayText}</span>
                <span className="typewriter-cursor" />
              </>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText.trim()}</ReactMarkdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthenticatedChat() {
  const { user } = useUser();
  const threads = useQuery(api.chat.listThreads);
  const createThread = useMutation(api.chat.createThread);
  const deleteThread = useMutation(api.chat.deleteThread);
  const requestLiveRecheck = useMutation(api.research.requestLiveRecheck);
  const sendPrompt = useMutation(api.chat.sendPrompt).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isComposingNew, setIsComposingNew] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [introHtml, setIntroHtml] = useState("");
  const [isIntroTyping, setIsIntroTyping] = useState(false);
  const [isFeedScrolling, setIsFeedScrolling] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [lastKnownUserId, setLastKnownUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(SIDEBAR_LAST_USER_ID_KEY);
  });
  const [cachedSidebarThreads, setCachedSidebarThreads] = useState<CachedSidebarThread[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    const rememberedUserId = window.localStorage.getItem(SIDEBAR_LAST_USER_ID_KEY) ?? undefined;
    return readCachedSidebarThreads(getSidebarHistoryCacheKey(rememberedUserId));
  });

  const sidebarRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const fadingTimerRef = useRef<number | null>(null);
  const dataWaitTimerRef = useRef<number | null>(null);
  const waitingForDataRef = useRef(false);
  const effectiveUserId = user?.id ?? lastKnownUserId ?? undefined;
  const sidebarHistoryCacheKey = useMemo(() => getSidebarHistoryCacheKey(effectiveUserId), [effectiveUserId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!user?.id || user.id === lastKnownUserId) {
      return;
    }
    window.localStorage.setItem(SIDEBAR_LAST_USER_ID_KEY, user.id);
    setLastKnownUserId(user.id);
  }, [lastKnownUserId, user?.id]);

  useEffect(() => {
    setCachedSidebarThreads(readCachedSidebarThreads(sidebarHistoryCacheKey));
  }, [sidebarHistoryCacheKey]);

  useEffect(() => {
    if (!threads) {
      return;
    }

    const compact = threads.map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
    }));
    setCachedSidebarThreads(compact);
    writeCachedSidebarThreads(sidebarHistoryCacheKey, compact);
  }, [threads, sidebarHistoryCacheKey]);

  const sidebarThreads = threads ?? cachedSidebarThreads;


  const switchThread = useCallback(
    (newThreadId: string | null, composingNew: boolean) => {
      if (isFadingOut) return;
      if (!composingNew && newThreadId === activeThreadId && !isComposingNew) return;
      setIsFadingOut(true);
      waitingForDataRef.current = false;
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
      fadingTimerRef.current = window.setTimeout(() => {
        setIsComposingNew(composingNew);
        setActiveThreadId(newThreadId);
        if (composingNew) {
          setSessionVersion((v) => v + 1);
        }
        if (composingNew) {
          // New session: fade out first, then fade straight back in
          setIsFadingOut(false);
        } else {
          // Existing thread: stay invisible until target messages are ready.
          waitingForDataRef.current = true;
          // Failsafe: avoid staying hidden forever if something goes wrong.
          dataWaitTimerRef.current = window.setTimeout(() => {
            waitingForDataRef.current = false;
            setIsFadingOut(false);
          }, THREAD_SWITCH_FAILSAFE_MS);
        }
      }, THREAD_SWITCH_FADE_MS);
    },
    [activeThreadId, isComposingNew, isFadingOut, setSessionVersion, setActiveThreadId, setIsComposingNew],
  );

  const startNew = useCallback(() => {
    switchThread(null, true);
  }, [switchThread]);

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
  const latestResearchJob = useQuery(
    api.research.getLatestJobForThread,
    activeThreadIdForMessages ? { threadId: activeThreadIdForMessages } : "skip",
  );

  const visibleMessages = useMemo(
    () => (isComposingNew || !activeThreadIdForMessages ? [] : messageFeed.results),
    [activeThreadIdForMessages, isComposingNew, messageFeed.results],
  );

  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const showIntro = visibleMessages.length === 0 && !isStreaming;
  const isResearchActive = !!latestResearchJob && !TERMINAL_RESEARCH_STATUSES.has(latestResearchJob.status);

  useEffect(() => {
    document.body.classList.toggle("chat-switching", isFadingOut);
    return () => {
      document.body.classList.remove("chat-switching");
    };
  }, [isFadingOut]);

  // Fade back in once the target thread's messages have loaded and scroll is settled.
  useEffect(() => {
    if (waitingForDataRef.current && visibleMessages.length > 0) {
      waitingForDataRef.current = false;
      if (dataWaitTimerRef.current !== null) {
        window.clearTimeout(dataWaitTimerRef.current);
        dataWaitTimerRef.current = null;
      }
      window.requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.requestAnimationFrame(() => {
          dataWaitTimerRef.current = window.setTimeout(() => {
            setIsFadingOut(false);
            dataWaitTimerRef.current = null;
          }, THREAD_SWITCH_REVEAL_DELAY_MS);
        });
      });
    }
  }, [visibleMessages.length]);

  useEffect(() => {
    if (isFadingOut || waitingForDataRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleMessages.length, introHtml, isStreaming, isFadingOut]);

  useEffect(() => {
    if (!showIntro) {
      setIntroHtml("");
      setIsIntroTyping(false);
      return;
    }

    let cancelled = false;
    let i = 0;
    let textBuffer = "";
    let isTag = false;
    let timer = 0;

    setIntroHtml("");
    setIsIntroTyping(true);

    const typeWriter = () => {
      if (cancelled) {
        return;
      }

      if (i >= INTRO_RESPONSE.length) {
        setIsIntroTyping(false);
        return;
      }

      const char = INTRO_RESPONSE.charAt(i);
      if (char === "<") {
        isTag = true;
      }

      textBuffer += char;
      setIntroHtml(textBuffer.replace(/\n/g, "<br />"));

      if (char === ">") {
        isTag = false;
      }

      i += 1;
      let delay = isTag ? 0 : Math.random() * TYPEWRITER_VARIANCE_MS + TYPEWRITER_MIN_DELAY_MS;
      if (char === "." || char === "\n") {
        delay += TYPEWRITER_PUNCTUATION_PAUSE_MS;
      }

      timer = window.setTimeout(typeWriter, delay);
    };

    timer = window.setTimeout(typeWriter, TYPEWRITER_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showIntro, sessionVersion]);

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
      if (fadingTimerRef.current !== null) window.clearTimeout(fadingTimerRef.current);
      if (dataWaitTimerRef.current !== null) window.clearTimeout(dataWaitTimerRef.current);
    };
  }, []);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "28px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, []);

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isSubmitting) {
      return;
    }

    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "28px";
    }
    setIsSubmitting(true);

    try {
      let threadId = activeThreadIdForMessages;
      if (!threadId) {
        const created = await createThread({});
        threadId = created.threadId;
        setIsComposingNew(false);
        setActiveThreadId(threadId);
      }

      if (!threadId) {
        return;
      }

      await sendPrompt({ threadId, prompt });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (event: React.MouseEvent, threadId: string) => {
    event.stopPropagation();
    if (!window.confirm("Delete this session?")) {
      return;
    }

    await deleteThread({ threadId });
    if (activeThreadId === threadId) {
      setIsComposingNew(false);
      setActiveThreadId(null);
    }
  };

  const handleRecheckNow = async () => {
    if (!latestResearchJob || isResearchActive) {
      return;
    }
    await requestLiveRecheck({
      researchJobId: latestResearchJob.researchJobId,
    });
  };

  const handleFeedScroll = () => {
    setIsFeedScrolling((current) => (current ? current : true));

    if (scrollIdleTimerRef.current !== null) {
      window.clearTimeout(scrollIdleTimerRef.current);
    }

    scrollIdleTimerRef.current = window.setTimeout(() => {
      setIsFeedScrolling(false);
    }, 140);
  };

  return (
    <div className="oracle-shell">
      <div className="noise-overlay" />
      <div className="grid-bg" />
      <ChatCanvas pause={isFeedScrolling} />

      <div className="app-container">
        <aside ref={sidebarRef} className="sidebar">
          <header className="brand">
            <h1>Aura</h1>
            <span>System.v.26</span>
          </header>

          <button className="new-chat-btn" onClick={startNew}>
            <span>New Session</span>
            <span>[+]</span>
          </button>

          <div className="nav-section-title">Context History</div>
          <ul className="history-list" id="historyList">
            {sidebarThreads.length > 0
              ? sidebarThreads.map((thread) => (
                <li className="history-item" key={thread.threadId}>
                  <button
                    className={clsx(
                      "history-link",
                      thread.threadId === activeThreadId && !isComposingNew && "active",
                    )}
                    onClick={() => {
                      switchThread(thread.threadId, false);
                    }}
                  >
                    {thread.title}
                  </button>

                  {threads && (
                    <button
                      className="history-delete"
                      onClick={(event) => {
                        void handleDelete(event, thread.threadId);
                      }}
                      aria-label="Delete session"
                    >
                      [x]
                    </button>
                  )}
                </li>
              ))
              : (
                <li className="history-item">
                  <span className="history-link placeholder">No Sessions yet</span>
                </li>
              )}
          </ul>

          {hasClerk && <SidebarUser />}
        </aside>



        <main className="main-area">


          <div className={clsx("chat-feed", isFadingOut && "fading-out")} id="chatFeed" ref={feedRef} onScroll={handleFeedScroll}>
            {latestResearchJob && (
              <section className="research-status" aria-live="polite">
                <div className="research-status-head">
                  <span>Research Pipeline</span>
                  <span>{latestResearchJob.stage}</span>
                </div>
                <div className="research-status-progress-track">
                  <div
                    className="research-status-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, latestResearchJob.progress))}%` }}
                  />
                </div>
                <div className="research-status-meta">
                  <span>{toResearchStatusLabel(latestResearchJob.status)}</span>
                  <span>{latestResearchJob.progress}%</span>
                </div>
                {(latestResearchJob.lastErrorCode || latestResearchJob.nextRunAt) && (
                  <p className="research-status-runtime">
                    {latestResearchJob.lastErrorCode ? `Code: ${latestResearchJob.lastErrorCode}` : ""}
                    {latestResearchJob.lastErrorCode && latestResearchJob.nextRunAt ? " | " : ""}
                    {latestResearchJob.nextRunAt
                      ? `Next retry: ${formatUtcTimestamp(latestResearchJob.nextRunAt)}`
                      : ""}
                  </p>
                )}
                {latestResearchJob.error && (
                  <p className="research-status-error">{latestResearchJob.error}</p>
                )}
                {!isResearchActive && latestResearchJob.status !== "awaiting_input" && (
                  <button className="research-status-recheck" type="button" onClick={() => void handleRecheckNow()}>
                    Recheck Live Data
                  </button>
                )}
                {latestResearchJob.followUpQuestion && (
                  <p className="research-status-followup">{latestResearchJob.followUpQuestion}</p>
                )}
                {latestResearchJob.missingFields && latestResearchJob.missingFields.length > 0 && (
                  <p className="research-status-missing">
                    Missing: {latestResearchJob.missingFields.join(", ")}
                  </p>
                )}
                {latestResearchJob.tasks.length > 0 && (
                  <ul className="research-status-tasks">
                    {latestResearchJob.tasks.map((task: { key: string; label: string; status: string }) => (
                      <li key={task.key} className={clsx("research-status-task", `status-${task.status}`)}>
                        <span>{task.label}</span>
                        <span>{toResearchStatusLabel(task.status)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!isResearchActive && latestResearchJob.findings.length > 0 && (
                  <div className="research-status-findings">
                    {latestResearchJob.findings.map((finding: { title: string; summary: string; createdAt: number }) => (
                      <p key={`${finding.title}-${finding.createdAt}`}>
                        <strong>{finding.title}:</strong> {finding.summary}
                      </p>
                    ))}
                  </div>
                )}
                {latestResearchJob.sources.length > 0 && (
                  <div className="research-status-sources">
                    {latestResearchJob.sources.map((source: { url: string; rank: number; title: string }) => (
                      <a
                        key={`${source.url}-${source.rank}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        [{source.rank}] {source.title}
                      </a>
                    ))}
                  </div>
                )}
                {!isResearchActive && latestResearchJob.candidates.length > 0 && (
                  <div className="research-candidates">
                    {latestResearchJob.candidates.map(
                      (candidate: {
                        category: string;
                        title: string;
                        summary: string;
                        confidence: number;
                        verificationStatus: string;
                        estimatedTotalUsd: number;
                        travelMinutes: number;
                        transferCount: number;
                        recheckAfter: number;
                        primarySourceUrl?: string;
                        updatedAt: number;
                      }) => (
                        <article key={`${candidate.category}-${candidate.updatedAt}`} className="research-candidate">
                          <div className="research-candidate-head">
                            <span>{toCandidateLabel(candidate.category)}</span>
                            <span>{Math.round(candidate.confidence * 100)}%</span>
                          </div>
                          <h4>{candidate.title}</h4>
                          <p>{candidate.summary}</p>
                          <p className="research-candidate-metrics">
                            ${candidate.estimatedTotalUsd} total - {candidate.travelMinutes}m - {candidate.transferCount} transfer(s)
                          </p>
                          <p className="research-candidate-verification">
                            Verification: {candidate.verificationStatus.replaceAll("_", " ")} ({freshnessLabel(candidate.recheckAfter)})
                          </p>
                          {candidate.primarySourceUrl && (
                            <a href={candidate.primarySourceUrl} target="_blank" rel="noreferrer">
                              Open primary source
                            </a>
                          )}
                        </article>
                      ),
                    )}
                  </div>
                )}
                {!isResearchActive && latestResearchJob.rankedResults.length > 0 && (
                  <div className="research-ranked-results">
                    {latestResearchJob.rankedResults.map(
                      (result: {
                        category: string;
                        rank: number;
                        score: number;
                        title: string;
                        rationale: string;
                        verificationStatus: string;
                        recheckAfter: number;
                        updatedAt: number;
                      }) => (
                        <article key={`${result.category}-${result.rank}-${result.updatedAt}`} className="research-ranked-result">
                          <div>
                            #{result.rank} {toCandidateLabel(result.category)} - {result.score}
                          </div>
                          <p>{result.title}</p>
                          <small>{result.rationale}</small>
                          <small>{result.verificationStatus.replaceAll("_", " ")}</small>
                          <small>freshness: {freshnessLabel(result.recheckAfter)}</small>
                        </article>
                      ),
                    )}
                  </div>
                )}
              </section>
            )}
            {showIntro ? (
              <>
                <div className="message user" style={{ animationDelay: "0.5s" }}>
                  <div className="message-wrapper">
                    <div className="message-meta">User Query</div>
                    <div className="message-content">What do you do?</div>
                  </div>
                </div>

                <div className="message ai" style={{ animationDelay: "0.7s" }}>
                  <div className="response-container">
                    <div className="message-meta">Aura Response</div>
                    <div
                      className="message-content"
                      id="typewriter-target"
                      dangerouslySetInnerHTML={{
                        __html: `${introHtml}${isIntroTyping ? '<span class="typewriter-cursor"></span>' : ""}`,
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              visibleMessages.map((message, index) => (
                <Message key={message.key} message={message} index={index} />
              ))
            )}
          </div>

          <div className="input-wrapper">
            <div className="input-grid">
              <form className="input-container" onSubmit={(event) => void handleSend(event)}>
                <span className="input-prefix">_&gt;</span>
                <span className="input-fade-layer" aria-hidden />

                <textarea
                  id="userInput"
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                  placeholder="Enter command sequence..."
                  onChange={(event) => {
                    setDraft(event.target.value);
                    resizeTextarea();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={isSubmitting}
                />

                <button
                  className="send-btn"
                  id="sendBtn"
                  type="submit"
                  disabled={isSubmitting || !draft.trim()}
                >
                  [ Execute ]
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function Chat() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const hasMounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [cachedSignedInSession] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("aura:lastSignedIn") === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isAuthenticated) {
      window.localStorage.setItem("aura:lastSignedIn", "1");
      return;
    }

    if (!isLoading) {
      window.localStorage.removeItem("aura:lastSignedIn");
    }
  }, [isAuthenticated, isLoading]);

  if (!hasMounted) {
    return (
      <div className="oracle-shell">
        <div className="noise-overlay" />
        <div className="grid-bg" style={{ left: 0 }} />
      </div>
    );
  }

  if (isAuthenticated || (isLoading && cachedSignedInSession)) {
    return <AuthenticatedChat />;
  }

  if (isLoading) {
    return (
      <div className="oracle-shell auth-screen">
        <div className="noise-overlay" />
        <div className="grid-bg" style={{ left: 0 }} />
        <div className="auth-content-wrapper">
          <div className="auth-message-block" key="loading">
            <div className="message-meta">Restoring Session</div>
            <h2 className="auth-title">Aura Access Protocol</h2>
            <div className="message-content">Checking your authentication status...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="oracle-shell auth-screen">
      <div className="noise-overlay" />
      <div className="grid-bg" style={{ left: 0 }} />
      <div className="auth-content-wrapper">
        <div className="auth-message-block" key="signin">
          <div className="message-meta">Sign In Required</div>
          <h2 className="auth-title">Aura Access Protocol</h2>
          <div className="message-content">
            Please authenticate to start travel research and save your preferences.
          </div>
          {hasClerk ? (
            <SignInButton mode="modal">
              <button className="auth-btn" type="button">
                Authenticate _&gt;
              </button>
            </SignInButton>
          ) : (
            <div className="message-content">Set Clerk environment keys to enable sign-in.</div>
          )}
        </div>
      </div>
    </div>
  );
}
