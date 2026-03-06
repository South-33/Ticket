import { validateVerificationOutput } from "./researchContracts";
import { clamp } from "./researchEvidence";
import type { CandidateDraft, RankedResultDraft } from "./researchTypes";

type SourceRecord = {
  url: string;
  title: string;
  snippet?: string;
  provider: "tavily" | "fallback";
  createdAt?: number;
};

type VerificationIssue =
  | "missing_citations"
  | "missing_primary_source"
  | "thin_support"
  | "stale_evidence"
  | "weak_evidence"
  | "incomplete_metrics";

type VerificationResult = {
  candidates: CandidateDraft[];
  rankedResults: RankedResultDraft[];
  blockedCategories: CandidateDraft["category"][];
  citationCoverage: number;
  verificationConfidence: number;
  summary: string;
};

const VERIFIED_WINDOW_MS = 6 * 60 * 60 * 1000;
const PARTIAL_WINDOW_MS = 2 * 60 * 60 * 1000;

function verificationWindowForStatus(status: CandidateDraft["verificationStatus"]) {
  if (status === "verified") {
    return VERIFIED_WINDOW_MS;
  }
  if (status === "partially_verified") {
    return PARTIAL_WINDOW_MS;
  }
  return 0;
}

function computeCandidateIssues(args: {
  candidate: CandidateDraft;
  sourceMap: Map<string, SourceRecord>;
  extractedByUrl: Map<string, string>;
  now: number;
}) {
  const issues: VerificationIssue[] = [];
  const linkedSources = args.candidate.sourceUrls.filter((url) => args.sourceMap.has(url));
  const extractedCoverage = linkedSources.length > 0
    ? linkedSources.filter((url) => !!args.extractedByUrl.get(url)).length / linkedSources.length
    : 0;
  const officialCoverage = linkedSources.length > 0
    ? linkedSources.filter((url) => {
        const text = `${args.sourceMap.get(url)?.title ?? ""} ${args.sourceMap.get(url)?.snippet ?? ""}`;
        return /official|airline|carrier|booking/i.test(text);
      }).length / linkedSources.length
    : 0;

  if (linkedSources.length === 0) {
    issues.push("missing_citations");
  }
  if (args.candidate.primarySourceUrl && !linkedSources.includes(args.candidate.primarySourceUrl)) {
    issues.push("missing_primary_source");
  }
  if (linkedSources.length === 1) {
    issues.push("thin_support");
  }
  if (
    args.candidate.estimatedTotalUsd <= 0
    || args.candidate.travelMinutes <= 0
    || args.candidate.transferCount < 0
  ) {
    issues.push("incomplete_metrics");
  }
  if (args.candidate.freshnessScore < 0.35) {
    issues.push("stale_evidence");
  }
  if (extractedCoverage < 0.5 && officialCoverage === 0) {
    issues.push("weak_evidence");
  }

  const confidence = clamp(
    linkedSources.length / Math.max(1, args.candidate.sourceUrls.length) * 0.45
      + extractedCoverage * 0.25
      + officialCoverage * 0.15
      + args.candidate.freshnessScore * 0.15,
    0,
    1,
  );

  return {
    issues,
    linkedSources,
    confidence,
    extractedCoverage,
    officialCoverage,
  };
}

function nextVerificationStatus(args: {
  candidate: CandidateDraft;
  issues: VerificationIssue[];
  linkedSources: string[];
  extractedCoverage: number;
  officialCoverage: number;
}) {
  if (args.issues.includes("missing_citations") || args.issues.includes("incomplete_metrics") || args.issues.includes("stale_evidence")) {
    return "needs_live_check" as const;
  }

  if (args.linkedSources.length >= 2 && (args.extractedCoverage >= 0.5 || args.officialCoverage > 0)) {
    return "partially_verified" as const;
  }

  return args.candidate.verificationStatus === "verified"
    ? "partially_verified"
    : args.candidate.verificationStatus;
}

function issueSummary(issues: VerificationIssue[]) {
  if (issues.length === 0) {
    return "verification checks passed";
  }
  return `issues: ${issues.join(", ")}`;
}

export function verifyShortlist(args: {
  candidates: CandidateDraft[];
  rankedResults: RankedResultDraft[];
  sources: SourceRecord[];
  extractedByUrl?: Map<string, string>;
  now?: number;
}): VerificationResult {
  const now = args.now ?? Date.now();
  const sourceMap = new Map(args.sources.map((source) => [source.url, source]));
  const extractedByUrl = args.extractedByUrl ?? new Map<string, string>();
  const blockedCategories: CandidateDraft["category"][] = [];

  const verifiedCandidates = args.candidates.map((candidate) => {
    const result = computeCandidateIssues({
      candidate,
      sourceMap,
      extractedByUrl,
      now,
    });
    const verificationStatus = nextVerificationStatus({
      candidate,
      issues: result.issues,
      linkedSources: result.linkedSources,
      extractedCoverage: result.extractedCoverage,
      officialCoverage: result.officialCoverage,
    });
    const verifiedAt = verificationStatus === "needs_live_check" ? undefined : now;
    const recheckAfter = now + verificationWindowForStatus(verificationStatus);

    if (verificationStatus === "needs_live_check") {
      blockedCategories.push(candidate.category);
    }

    return {
      ...candidate,
      summary:
        verificationStatus === candidate.verificationStatus && result.issues.length === 0
          ? candidate.summary
          : `${candidate.summary} Verification note: ${issueSummary(result.issues)}.`,
      confidence: clamp(candidate.confidence * 0.7 + result.confidence * 0.3, 0.15, 0.98),
      verificationStatus,
      verifiedAt,
      recheckAfter,
      primarySourceUrl: result.linkedSources.includes(candidate.primarySourceUrl ?? "")
        ? candidate.primarySourceUrl
        : result.linkedSources[0],
      sourceUrls: result.linkedSources,
    };
  });

  const candidateByCategory = new Map(verifiedCandidates.map((candidate) => [candidate.category, candidate]));
  const verifiedRankedResults = args.rankedResults.map((rankedResult) => {
    const candidate = candidateByCategory.get(rankedResult.category);
    if (!candidate) {
      return rankedResult;
    }
    const downgraded = candidate.verificationStatus !== rankedResult.verificationStatus;
    return {
      ...rankedResult,
      verificationStatus: candidate.verificationStatus,
      verifiedAt: candidate.verifiedAt,
      recheckAfter: candidate.recheckAfter,
      sourceUrls: candidate.sourceUrls,
      rationale: downgraded
        ? `${rankedResult.rationale} Verification updated this result to ${candidate.verificationStatus.replace(/_/g, " ")}.`
        : rankedResult.rationale,
    };
  });

  const citationCoverage = verifiedCandidates.length > 0
    ? verifiedCandidates.filter((candidate) => candidate.sourceUrls.length > 0).length / verifiedCandidates.length
    : 0;
  const verificationConfidence = verifiedCandidates.length > 0
    ? verifiedCandidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / verifiedCandidates.length
    : 0;
  const verifiedCount = verifiedCandidates.filter((candidate) => candidate.verificationStatus !== "needs_live_check").length;

  const summary =
    blockedCategories.length === 0
      ? `Verification confirmed citation coverage for all shortlist categories; ${verifiedCount}/${verifiedCandidates.length} candidates are ready above live-check baseline.`
      : `Verification downgraded ${blockedCategories.length}/${verifiedCandidates.length} category leads to live-check required due to citation or freshness gaps.`;

  return validateVerificationOutput(
    {
      candidates: verifiedCandidates,
      rankedResults: verifiedRankedResults,
      blockedCategories,
      citationCoverage,
      verificationConfidence,
      summary,
    },
    new Set(args.sources.map((source) => source.url)),
  );
}
