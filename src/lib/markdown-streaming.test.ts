import { describe, expect, it } from "vitest";
import { stabilizeMarkdownForStreaming } from "./markdown-streaming";

describe("stabilizeMarkdownForStreaming", () => {
  it("keeps static markdown untouched", () => {
    const input = "- one\n- two";
    expect(stabilizeMarkdownForStreaming(input, false)).toBe(input);
  });

  it("adds a trailing newline for an in-progress list line", () => {
    const input = "- first item";
    expect(stabilizeMarkdownForStreaming(input, true)).toBe("- first item\n");
  });

  it("closes an unmatched fenced code block while streaming", () => {
    const input = "```ts\nconst x = 1;";
    expect(stabilizeMarkdownForStreaming(input, true)).toBe("```ts\nconst x = 1;\n```");
  });
});
