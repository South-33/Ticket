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
const THREAD_SWITCH_FADE_MS = 500;
const THREAD_SWITCH_REVEAL_DELAY_MS = 120;
const THREAD_SWITCH_FAILSAFE_MS = 5000;

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

export function Chat() {
  const threads = useQuery(api.chat.listThreads);
  const createThread = useMutation(api.chat.createThread);
  const deleteThread = useMutation(api.chat.deleteThread);
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

  const sidebarRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const fadingTimerRef = useRef<number | null>(null);
  const dataWaitTimerRef = useRef<number | null>(null);
  const waitingForDataRef = useRef(false);


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

  const visibleMessages = useMemo(
    () => (isComposingNew || !activeThreadIdForMessages ? [] : messageFeed.results),
    [activeThreadIdForMessages, isComposingNew, messageFeed.results],
  );

  const isStreaming = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  const showIntro = visibleMessages.length === 0 && !isStreaming;

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
                    onClick={() => {
                      switchThread(thread.threadId, false);
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



        <main className="main-area">


          <div className={clsx("chat-feed", isFadingOut && "fading-out")} id="chatFeed" ref={feedRef} onScroll={handleFeedScroll}>
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
                <span className="input-side-fade input-side-fade-left" aria-hidden />
                <span className="input-side-fade input-side-fade-right" aria-hidden />

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
