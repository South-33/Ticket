"use client";

import { Check, CopySimple, DownloadSimple } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Streamdown, type Components } from "streamdown";

// ── Code block with header bar ──────────────────────────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleDownload = useCallback(() => {
    const ext = langToExt[lang] ?? lang;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `code.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [code, lang]);

  return (
    <div className="code-block">
      {/* Header */}
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <div className="code-block-actions">
          <button
            className="code-block-btn"
            onClick={handleCopy}
            aria-label="Copy code"
            title="Copy"
          >
            {copied ? (
              <Check size={13} weight="bold" />
            ) : (
              <CopySimple size={13} weight="regular" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            className="code-block-btn"
            onClick={handleDownload}
            aria-label="Download code"
            title="Download"
          >
            <DownloadSimple size={13} weight="regular" />
          </button>
        </div>
      </div>

      {/* Highlighted code */}
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "0.8rem",
          lineHeight: "1.6",
          padding: "1.25rem 1.5rem",
        }}
        codeTagProps={{ style: { fontFamily: "inherit" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

// ── Streamdown component overrides ──────────────────────────────────────────

const components: Components = {
  // Fix hydration error: div inside p. Images with overlays are blocks in Streamdown.
  p({ children, className }) {
    return <div className={`ai-p ${className ?? ""}`}>{children}</div>;
  },
  code({ className, children }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];

    if (lang) {
      return (
        <CodeBlock
          lang={lang}
          code={String(children).replace(/\n$/, "")}
        />
      );
    }

    // Inline code — pass through to Streamdown's default renderer
    return <code className={className}>{children}</code>;
  },
};

// ── Extension map ────────────────────────────────────────────────────────────

const langToExt: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  rust: "rs",
  go: "go",
  java: "java",
  cpp: "cpp",
  c: "c",
  csharp: "cs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  shell: "sh",
  bash: "sh",
  sql: "sql",
  html: "html",
  css: "css",
  json: "json",
  yaml: "yaml",
  markdown: "md",
};

// ── Component ────────────────────────────────────────────────────────────────

export function MarkdownRenderer({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <Streamdown
      caret="block"
      isAnimating={isStreaming}
      controls={false}
      linkSafety={{ enabled: false }}
      components={components}
    >
      {content}
    </Streamdown>
  );
}
