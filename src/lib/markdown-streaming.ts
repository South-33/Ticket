const UNORDERED_LIST_TRAIL_RE = /(?:^|\n)\s*[-+*]\s+[^\n]*$/;
const ORDERED_LIST_TRAIL_RE = /(?:^|\n)\s*\d+\.\s+[^\n]*$/;

export function stabilizeMarkdownForStreaming(markdown: string, isStreaming: boolean): string {
  const normalized = markdown.replace(/\r\n/g, "\n");

  if (!isStreaming || normalized.length === 0) {
    return normalized;
  }

  let stabilized = normalized;

  if (!stabilized.endsWith("\n") && (UNORDERED_LIST_TRAIL_RE.test(stabilized) || ORDERED_LIST_TRAIL_RE.test(stabilized))) {
    stabilized += "\n";
  }

  const fenceCount = stabilized.match(/```/g)?.length ?? 0;
  if (fenceCount % 2 === 1) {
    stabilized += "\n```";
  }

  return stabilized;
}
