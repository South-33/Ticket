"use client";

import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@convex/_generated/api";
import { ChatCanvas } from "@/components/chat-canvas";

const INTRO_RESPONSE =
  "I can help you find better flight deals with AI-assisted deep research.\n\n" +
  "I compare route combinations, scan timing windows, cross-check fare rules, and verify options before recommending them. " +
  "I can also prioritize what matters most to you: lowest price, shortest duration, fewer layovers, or flexible change policies.\n\n" +
  "Share your route, dates, and constraints, and I will return a clear, verifiable shortlist.";

const TYPEWRITER_INITIAL_DELAY_MS = 0;
const TYPEWRITER_MIN_DELAY_MS = 0;
const TYPEWRITER_VARIANCE_MS = 2;
const TYPEWRITER_PUNCTUATION_PAUSE_MS = 25;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 620;

const PLACEHOLDER_HISTORY = [
  "Top Travel Destinations in Germany",
  "Initial Greeting and Assistance Offer",
  "NYC to Tokyo Fare Strategy",
  "Hidden-City Route Risk Review",
  "Multi-City Combinatorics Test",
  "Weekend Flash Deal Verification",
  "Award Seat Availability Sweep",
  "Baggage and Fare Rule Audit",
];

function getReasoningText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
    .trim();
}

function Message({ message, index }: { message: UIMessage; index: number }) {
  const [visibleText] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });

  if (message.role === "system") {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="message user" style={{ animationDelay: `${Math.min(index * 0.08, 0.6)}s` }}>
        <div className="message-meta">User Query</div>
        <div className="message-content">{message.text}</div>
      </div>
    );
  }

  const reasoning = getReasoningText(message);
  const safetyFallback = message.status === "failed" && !(message.text ?? "").trim();
  const displayText = (safetyFallback ? "Response blocked by safety policies." : visibleText).trim();

  if (!displayText && !reasoning) {
    return null;
  }

  return (
    <div className="message ai" style={{ animationDelay: `${Math.min(index * 0.08, 0.6)}s` }}>
      <div className="message-meta">
        {message.status === "streaming" ? "Aura Processing" : "Aura Response"}
      </div>

      {reasoning && (
        <details className="reasoning-block" open={message.status === "streaming"}>
          <summary>Synthesis Process</summary>
          <div className="message-content reasoning-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoning}</ReactMarkdown>
          </div>
        </details>
      )}

      {displayText && (
        <div className="message-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
          {message.status === "streaming" && <span className="typewriter-cursor" />}
        </div>
      )}
    </div>
  );
}

export function Chat() {
  const threads = useQuery(api.chat.listThreads);
  const createThread = useMutation(api.chat.createThread);
  const deleteThread = useMutation(api.chat.deleteThread);
  const sendPrompt = useMutation(api.chat.sendPrompt).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listMessages),
  );

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isComposingNew, setIsComposingNew] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [introHtml, setIntroHtml] = useState("");
  const [isIntroTyping, setIsIntroTyping] = useState(false);
  const [isFeedScrolling, setIsFeedScrolling] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [hoverExtraWidth, setHoverExtraWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const sidebarRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isResizingSidebar = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const hoverExtraWidthRef = useRef(0);

  const applySidebarWidth = useCallback(
    (baseWidth: number, extraWidth: number) => {
      if (isMobile || !sidebarRef.current) {
        return;
      }

      const effectiveWidth = Math.min(baseWidth + extraWidth, SIDEBAR_MAX_WIDTH);
      sidebarRef.current.style.width = `${effectiveWidth}px`;
    },
    [isMobile],
  );

  const startNew = useCallback(() => {
    setIsComposingNew(true);
    setActiveThreadId(null);
  }, []);

  useEffect(() => {
    if (!threads || isComposingNew) {
      return;
    }
    if (activeThreadId && threads.some((thread) => thread.threadId === activeThreadId)) {
      return;
    }
    if (threads.length > 0) {
      setActiveThreadId(threads[0].threadId);
    }
  }, [activeThreadId, isComposingNew, threads]);

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

  const visibleMessages = useMemo(
    () => (isComposingNew || !activeThreadIdForMessages ? [] : messageFeed.results),
    [activeThreadIdForMessages, isComposingNew, messageFeed.results],
  );

  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const showIntro = visibleMessages.length === 0 && !isStreaming;

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }
    const timer = window.setTimeout(() => {
      feed.scrollTop = feed.scrollHeight;
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleMessages.length, isStreaming, introHtml]);

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
  }, [showIntro]);

  useEffect(() => {
    const updateMobileState = () => {
      setIsMobile(window.innerWidth <= 760);
    };

    updateMobileState();
    window.addEventListener("resize", updateMobileState);
    return () => {
      window.removeEventListener("resize", updateMobileState);
    };
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    hoverExtraWidthRef.current = hoverExtraWidth;
  }, [hoverExtraWidth]);

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isMobile) {
      setHoverExtraWidth(0);
      if (sidebarRef.current) {
        sidebarRef.current.style.removeProperty("width");
      }
      return;
    }

    applySidebarWidth(sidebarWidth, hoverExtraWidth);
  }, [applySidebarWidth, hoverExtraWidth, isMobile, sidebarWidth]);

  useEffect(() => {
    if (isMobile) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingSidebar.current) {
        return;
      }

      const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 420));
      const clampedWidth = Math.min(Math.max(event.clientX, SIDEBAR_MIN_WIDTH), maxWidth);
      sidebarWidthRef.current = clampedWidth;
      applySidebarWidth(clampedWidth, hoverExtraWidthRef.current);
    };

    const handleMouseUp = () => {
      if (!isResizingSidebar.current) {
        return;
      }
      isResizingSidebar.current = false;
      document.body.classList.remove("resizing-sidebar");
      setSidebarWidth(sidebarWidthRef.current);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [applySidebarWidth, isMobile]);

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

  const handleSidebarResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizingSidebar.current = true;
    document.body.classList.add("resizing-sidebar");
  };

  const handleHistoryEnter = (
    event: React.MouseEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>,
  ) => {
    if (isMobile || isResizingSidebar.current) {
      return;
    }

    const { currentTarget } = event;
    const overflow = currentTarget.scrollWidth - currentTarget.clientWidth;
    const neededExtra = overflow > 0 ? Math.min(overflow + 28, 180) : 0;
    setHoverExtraWidth(neededExtra);
  };

  const handleHistoryLeave = () => {
    setHoverExtraWidth(0);
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

  const effectiveSidebarWidth = isMobile
    ? undefined
    : Math.min(sidebarWidth + hoverExtraWidth, SIDEBAR_MAX_WIDTH);

  return (
    <div className="oracle-shell">
      <div className="noise-overlay" />
      <div className="grid-bg" />
      <ChatCanvas pause={isFeedScrolling} />

      <div className="app-container">
        <aside
          ref={sidebarRef}
          className="sidebar"
          style={effectiveSidebarWidth ? { width: effectiveSidebarWidth } : undefined}
        >
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
            {threads === undefined && (
              <li className="history-item">
                <span className="history-link placeholder">Loading sessions...</span>
              </li>
            )}

            {threads && threads.length > 0
              ? threads.map((thread) => (
                  <li className="history-item" key={thread.threadId}>
                    <button
                      className={clsx(
                        "history-link",
                        thread.threadId === activeThreadId && !isComposingNew && "active",
                      )}
                      onMouseEnter={handleHistoryEnter}
                      onMouseLeave={handleHistoryLeave}
                      onFocus={handleHistoryEnter}
                      onBlur={handleHistoryLeave}
                      onClick={() => {
                        setIsComposingNew(false);
                        setActiveThreadId(thread.threadId);
                      }}
                    >
                      {thread.title}
                    </button>

                    <button
                      className="history-delete"
                      onClick={(event) => {
                        void handleDelete(event, thread.threadId);
                      }}
                      aria-label="Delete session"
                    >
                      [x]
                    </button>
                  </li>
                ))
              : threads &&
                PLACEHOLDER_HISTORY.map((item, index) => (
                  <li className="history-item" key={item}>
                    <span className={clsx("history-link placeholder", index === 0 && "active")}>{item}</span>
                  </li>
                ))}
          </ul>
        </aside>

        {!isMobile && <div className="sidebar-resizer" onMouseDown={handleSidebarResizeStart} />}

        <main className="main-area">
          <header className="chat-header">
            <div className="model-info">
              <span className="status-dot" />
              {activeThread?.title && !isComposingNew
                ? activeThread.title
                : "Aura Prime / Generative Mode"}
            </div>
            <div className="model-info">
              {isStreaming ? "Aura Processing..." : "Latency: 12ms | Grid: Active"}
            </div>
          </header>

          <div className="chat-feed" id="chatFeed" ref={feedRef} onScroll={handleFeedScroll}>
            {showIntro ? (
              <>
                <div className="message user" style={{ animationDelay: "0.5s" }}>
                  <div className="message-meta">User Query</div>
                  <div className="message-content">What do you do?</div>
                </div>

                <div className="message ai" style={{ animationDelay: "0.7s" }}>
                  <div className="message-meta">Aura Response</div>
                  <div
                    className="message-content"
                    id="typewriter-target"
                    dangerouslySetInnerHTML={{
                      __html: `${introHtml}${isIntroTyping ? '<span class="typewriter-cursor"></span>' : ""}`,
                    }}
                  />
                </div>
              </>
            ) : (
              visibleMessages.map((message, index) => (
                <Message key={message.key} message={message} index={index} />
              ))
            )}
          </div>

          <div className="input-wrapper">
            <form className="input-container" onSubmit={(event) => void handleSend(event)}>
              <span className="input-prefix">_&gt;</span>

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
        </main>
      </div>
    </div>
  );
}
