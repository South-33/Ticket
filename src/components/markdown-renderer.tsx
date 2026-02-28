/* eslint-disable @next/next/no-img-element */
import clsx from "clsx";
import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { stabilizeMarkdownForStreaming } from "@/lib/markdown-streaming";

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    const isExternal = typeof href === "string" && /^(https?:)?\/\//i.test(href);
    return (
      <a
        {...props}
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer noopener" : undefined}
      >
        {children}
      </a>
    );
  },
  img({ className, alt, src, ...props }) {
    if (!src) {
      return null;
    }

    return (
      <img
        {...props}
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        className={clsx("markdown-img", className)}
      />
    );
  },
  pre({ className, children, ...props }) {
    return (
      <pre {...props} className={clsx("markdown-pre", className)}>
        {children}
      </pre>
    );
  },
  code({ className, children, ...props }) {
    return (
      <code {...props} className={clsx("markdown-code", className)}>
        {children}
      </code>
    );
  },
};

const safeUrlTransform: UrlTransform = (url) => {
  const trimmed = url.trim();
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) {
    return "";
  }
  return defaultUrlTransform(trimmed);
};

export function MarkdownRenderer({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const stabilized = useMemo(
    () => stabilizeMarkdownForStreaming(content, isStreaming),
    [content, isStreaming],
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      urlTransform={safeUrlTransform}
    >
      {stabilized}
    </ReactMarkdown>
  );
}
