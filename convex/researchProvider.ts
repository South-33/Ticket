export type SearchLead = {
  title: string;
  url: string;
  snippet?: string;
};

type TavilySearchResponse = {
  request_id?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
  }>;
};

type TavilyExtractResponse = {
  request_id?: string;
  results?: Array<{
    url?: string;
    raw_content?: string;
  }>;
};

function getTavilyApiKey() {
  const value = process.env.TAVILY_API_KEY;
  if (!value) {
    throw new Error("TAVILY_API_KEY is not configured");
  }
  return value;
}

function normalizeSnippet(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.slice(0, 280);
}

function normalizeExtract(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.slice(0, 1400);
}

export async function searchWebWithTavily(query: string, maxResults: number) {
  const apiKey = getTavilyApiKey();

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      include_usage: false,
      auto_parameters: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const payload = (await response.json()) as TavilySearchResponse;
  const seenUrls = new Set<string>();
  const output: SearchLead[] = [];

  for (const result of payload.results ?? []) {
    const url = result.url?.trim();
    const title = result.title?.trim();
    if (!url || !title || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    output.push({
      url,
      title,
      snippet: normalizeSnippet(result.content ?? result.raw_content),
    });

    if (output.length >= maxResults) {
      break;
    }
  }

  return {
    provider: "tavily" as const,
    requestId: payload.request_id,
    results: output,
  };
}

export async function extractWithTavily(urls: string[], query: string) {
  const apiKey = getTavilyApiKey();
  if (urls.length === 0) {
    return {
      provider: "tavily" as const,
      requestId: undefined,
      results: [] as Array<{ url: string; rawContent?: string }>,
    };
  }

  const response = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls,
      query,
      chunks_per_source: 2,
      extract_depth: "basic",
      format: "text",
      include_images: false,
      include_favicon: false,
      include_usage: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily extract failed: ${response.status}`);
  }

  const payload = (await response.json()) as TavilyExtractResponse;
  const normalized: Array<{ url: string; rawContent?: string }> = [];
  for (const result of payload.results ?? []) {
    const url = result.url?.trim();
    if (!url) {
      continue;
    }
    normalized.push({
      url,
      rawContent: normalizeExtract(result.raw_content),
    });
  }

  return {
    provider: "tavily" as const,
    requestId: payload.request_id,
    results: normalized,
  };
}
