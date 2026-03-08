import { validateSynthesisOutput, type SynthesisOutput } from "./researchContracts";
import { clamp, collectDurationMinutes, collectTransferCounts, collectUsdPrices } from "./researchEvidence";
import type { SlotMap } from "./researchIntake";
import type { CandidateDraft, SourceEvidence } from "./researchTypes";

type CandidateEvidenceMetrics = {
  cheapestUsd: number;
  valueUsd: number;
  convenientUsd: number;
  cheapestMinutes: number;
  valueMinutes: number;
  convenientMinutes: number;
  cheapestTransfers: number;
  valueTransfers: number;
  convenientTransfers: number;
  flexibilityScore: number;
  baggageScore: number;
  bookingEaseScore: number;
  freshnessScore: number;
  confidenceLift: number;
};

type CandidateGoalContext = {
  prompt: string;
  domain: string;
  constraintSummary?: string;
  slotMap?: SlotMap;
};

function extractBudgetCeiling(text: string) {
  const budgetMatch = text.match(/(?:budget|max|under|below|<=?)\s*\$?\s*(\d{2,5})/i);
  if (budgetMatch) {
    return Number(budgetMatch[1]);
  }

  const dollarMatch = text.match(/\$\s*(\d{2,5})/);
  if (dollarMatch) {
    return Number(dollarMatch[1]);
  }

  return undefined;
}

function createSynthesisSummary(sources: { title: string; url: string }[]) {
  if (sources.length === 0) {
    return "No reliable source links were captured yet. Kept a placeholder lead so the pipeline can continue; next step is adding fallback providers.";
  }

  const labels = sources.slice(0, 3).map((source) => source.title);
  return `Collected ${sources.length} web leads. Strongest early leads: ${labels.join("; ")}. All prices still require live verification before booking.`;
}

function verificationTimestamps(
  status: CandidateDraft["verificationStatus"],
  now: number,
): Pick<CandidateDraft, "verifiedAt" | "recheckAfter"> {
  if (status === "needs_live_check") {
    return {
      verifiedAt: undefined,
      recheckAfter: now,
    };
  }

  return {
    verifiedAt: now,
    recheckAfter:
      status === "verified"
        ? now + 6 * 60 * 60 * 1000
        : now + 2 * 60 * 60 * 1000,
  };
}

function median(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function average(values: number[]) {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function keywordScore(text: string, positive: RegExp[], negative: RegExp[], baseline: number) {
  let score = baseline;
  for (const pattern of positive) {
    if (pattern.test(text)) {
      score += 0.06;
    }
  }
  for (const pattern of negative) {
    if (pattern.test(text)) {
      score -= 0.08;
    }
  }
  return clamp(score, 0.2, 0.95);
}

function deriveCandidateEvidenceMetrics(
  domain: string,
  baselineBudget: number,
  topSources: SourceEvidence[],
): CandidateEvidenceMetrics {
  const joinedEvidence = topSources
    .map((source) => `${source.title} ${source.snippet ?? ""} ${source.extractedSummary ?? ""}`)
    .join("\n");

  const priceSignals = collectUsdPrices(joinedEvidence);
  const durationSignals = collectDurationMinutes(joinedEvidence);
  const transferSignals = collectTransferCounts(joinedEvidence);

  const defaultMinutes = domain === "flight" ? { cheap: 680, value: 590, fast: 510 } : { cheap: 320, value: 260, fast: 210 };
  const defaultTransfers = domain === "flight" ? { cheap: 2, value: 1, fast: 0 } : { cheap: 1, value: 1, fast: 0 };

  const lowestPrice = priceSignals.length > 0 ? Math.min(...priceSignals) : Math.round(baselineBudget * 0.9);
  const medianPrice = median(priceSignals) ?? Math.round(baselineBudget * 1.02);
  const convenientPrice = clamp(Math.round(Math.max(medianPrice, lowestPrice) * 1.08), 30, 15000);

  const shortestDuration = durationSignals.length > 0 ? Math.min(...durationSignals) : defaultMinutes.fast;
  const medianDuration = median(durationSignals) ?? defaultMinutes.value;
  const slowDuration = clamp(
    Math.max(medianDuration, Math.round((average(durationSignals) ?? defaultMinutes.cheap) * 1.08)),
    30,
    3000,
  );

  const minTransfers = transferSignals.length > 0 ? Math.min(...transferSignals) : defaultTransfers.fast;
  const averageTransfers = average(transferSignals);
  const typicalTransfers = averageTransfers !== undefined ? clamp(Math.round(averageTransfers), 0, 4) : defaultTransfers.value;
  const higherTransfers = clamp(Math.max(typicalTransfers, minTransfers + 1), 0, 4);

  const extractCoverage = topSources.length > 0
    ? topSources.filter((source) => !!source.extractedSummary).length / topSources.length
    : 0;
  const snippetCoverage = topSources.length > 0
    ? topSources.filter((source) => !!source.snippet).length / topSources.length
    : 0;

  const freshnessScore = clamp(0.25 + extractCoverage * 0.5 + snippetCoverage * 0.2, 0.2, 0.98);
  const confidenceLift = clamp(0.04 + extractCoverage * 0.14 + Math.min(0.08, priceSignals.length * 0.015), 0.04, 0.26);

  const flexibilityScore = keywordScore(
    joinedEvidence,
    [/\brefundable\b/i, /\bfree\s+cancell?ation\b/i, /\bflexible\b/i, /\bchange\s+policy\b/i],
    [/\bnon[-\s]?refundable\b/i, /\bstrict\b/i, /\bno\s+changes\b/i],
    0.56,
  );

  const baggageScore = keywordScore(
    joinedEvidence,
    [/\bcarry[-\s]?on\s+included\b/i, /\bchecked\s+bag\s+included\b/i, /\bbaggage\s+included\b/i],
    [/\bbaggage\s+fee\b/i, /\bextra\s+bag(?:gage)?\b/i, /\bno\s+bag(?:gage)?\b/i],
    0.52,
  );

  const bookingEaseScore = keywordScore(
    joinedEvidence,
    [/\bofficial\s+site\b/i, /\bbook\s+direct\b/i, /\binstant\s+confirmation\b/i],
    [/\bcoupon\s+code\b/i, /\bpromo\s+code\b/i, /\bcall\s+to\s+book\b/i],
    0.6,
  );

  return {
    cheapestUsd: clamp(lowestPrice, 30, 15000),
    valueUsd: clamp(medianPrice, 30, 15000),
    convenientUsd: convenientPrice,
    cheapestMinutes: slowDuration,
    valueMinutes: clamp(medianDuration, 30, 3000),
    convenientMinutes: clamp(shortestDuration, 30, 3000),
    cheapestTransfers: higherTransfers,
    valueTransfers: typicalTransfers,
    convenientTransfers: minTransfers,
    flexibilityScore,
    baggageScore,
    bookingEaseScore,
    freshnessScore,
    confidenceLift,
  };
}

function buildTripContext(slotMap: SlotMap | undefined) {
  if (!slotMap) {
    return "";
  }

  const parts: string[] = [];
  if (slotMap.returnDate) {
    parts.push(`Round-trip context includes return ${slotMap.returnDate}.`);
  }
  if (slotMap.passengerCount) {
    parts.push(`Traveler count: ${slotMap.passengerCount}.`);
  }
  if (slotMap.cabinClass) {
    parts.push(`Requested cabin: ${slotMap.cabinClass.replace(/_/g, " ")}.`);
  }

  return parts.join(" ");
}

function applyFlightPreferenceAdjustments(
  goal: CandidateGoalContext,
  candidate: CandidateDraft,
): CandidateDraft {
  if (goal.domain !== "flight") {
    return candidate;
  }

  const slotMap = goal.slotMap ?? {};
  let confidence = candidate.confidence;
  let baggageScore = candidate.baggageScore;
  let bookingEaseScore = candidate.bookingEaseScore;
  let summary = candidate.summary;

  const tripContext = buildTripContext(slotMap);
  if (tripContext) {
    summary = `${summary} ${tripContext}`.trim();
  }

  if (slotMap.cabinClass) {
    confidence = clamp(confidence - 0.04, 0.2, 0.95);
    summary = `${summary} Cabin alignment for ${slotMap.cabinClass.replace(/_/g, " ")} is still unverified.`;
  }

  if (slotMap.nonstopOnly === "true" && candidate.transferCount > 0) {
    confidence = clamp(confidence - 0.08, 0.2, 0.95);
    bookingEaseScore = clamp(bookingEaseScore - 0.1, 0.2, 0.97);
    summary = `${summary} Conflicts with nonstop-only preference: ${candidate.transferCount} transfer${candidate.transferCount === 1 ? "" : "s"}.`;
  }

  if (slotMap.bags === "checked" && candidate.baggageScore < 0.65) {
    confidence = clamp(confidence - 0.06, 0.2, 0.95);
    baggageScore = clamp(baggageScore - 0.12, 0.2, 0.95);
    summary = `${summary} Checked-bag coverage remains weak; baggage fees still need live verification.`;
  }

  return {
    ...candidate,
    confidence,
    baggageScore,
    bookingEaseScore,
    summary:
      summary.replace(/\s+/g, " ").trim().length <= 320
        ? summary.replace(/\s+/g, " ").trim()
        : `${summary.replace(/\s+/g, " ").trim().slice(0, 317)}...`,
  };
}

export function buildCandidateDrafts(
  goal: CandidateGoalContext,
  sources: SourceEvidence[],
): CandidateDraft[] {
  const now = Date.now();
  const top = sources.slice(0, 4);
  const sourceUrls = top.map((source) => source.url);
  const primary = sourceUrls[0];
  const routeHint = goal.domain === "flight" ? "route and airport alternatives" : "option alternatives";
  const budget = extractBudgetCeiling(`${goal.prompt} ${goal.constraintSummary ?? ""}`);
  const baselineBudget = budget ?? (goal.domain === "flight" ? 780 : 460);
  const evidenceMetrics = deriveCandidateEvidenceMetrics(goal.domain, baselineBudget, top);

  if (top.length === 0) {
    const pending = verificationTimestamps("needs_live_check", now);
    return [
      applyFlightPreferenceAdjustments(goal, {
        category: "cheapest",
        title: "Lowest-Cost Lead Pending",
        summary:
          "No reliable live source links were captured in this run. Re-run search or broaden query constraints before presenting a bookable cheapest option.",
        confidence: 0.25,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 0.96),
        travelMinutes: goal.domain === "flight" ? 760 : 340,
        transferCount: 2,
        flexibilityScore: 0.4,
        baggageScore: 0.3,
        bookingEaseScore: 0.35,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      }),
      applyFlightPreferenceAdjustments(goal, {
        category: "best_value",
        title: "Best-Value Lead Pending",
        summary:
          "Value recommendation is blocked until at least one credible source is available for comparison across total cost and tradeoffs.",
        confidence: 0.22,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 1.06),
        travelMinutes: goal.domain === "flight" ? 690 : 300,
        transferCount: 1,
        flexibilityScore: 0.5,
        baggageScore: 0.45,
        bookingEaseScore: 0.45,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      }),
      applyFlightPreferenceAdjustments(goal, {
        category: "most_convenient",
        title: "Convenience Lead Pending",
        summary:
          "Convenience recommendation needs validated timing and transfer details from live sources before ranking can be trusted.",
        confidence: 0.2,
        verificationStatus: "needs_live_check",
        estimatedTotalUsd: Math.round(baselineBudget * 1.14),
        travelMinutes: goal.domain === "flight" ? 540 : 230,
        transferCount: 0,
        flexibilityScore: 0.44,
        baggageScore: 0.5,
        bookingEaseScore: 0.55,
        freshnessScore: 0.2,
        verifiedAt: pending.verifiedAt,
        recheckAfter: pending.recheckAfter,
        sourceUrls: [],
      }),
    ];
  }

  const cheapestVerification = verificationTimestamps("needs_live_check", now);
  const valueVerification = verificationTimestamps("partially_verified", now);
  const convenientVerification = verificationTimestamps("needs_live_check", now);

  return [
    applyFlightPreferenceAdjustments(goal, {
      category: "cheapest",
      title: "Cheapest Candidate (Web Lead)",
      summary:
        "Prioritize the strongest low-cost source first, then verify total payable amount including fees and baggage before booking.",
      confidence: clamp(0.56 + evidenceMetrics.confidenceLift * 0.6, 0.3, 0.9),
      verificationStatus: "needs_live_check",
      estimatedTotalUsd: evidenceMetrics.cheapestUsd,
      travelMinutes: evidenceMetrics.cheapestMinutes,
      transferCount: evidenceMetrics.cheapestTransfers,
      flexibilityScore: clamp(evidenceMetrics.flexibilityScore - 0.08, 0.2, 0.95),
      baggageScore: clamp(evidenceMetrics.baggageScore - 0.06, 0.2, 0.95),
      bookingEaseScore: clamp(evidenceMetrics.bookingEaseScore - 0.08, 0.2, 0.95),
      freshnessScore: evidenceMetrics.freshnessScore,
      verifiedAt: cheapestVerification.verifiedAt,
      recheckAfter: cheapestVerification.recheckAfter,
      primarySourceUrl: primary,
      sourceUrls,
    }),
    applyFlightPreferenceAdjustments(goal, {
      category: "best_value",
      title: "Best Value Candidate (Balanced)",
      summary: `Balance total price against ${routeHint}, transfer burden, and policy flexibility using the top ranked source set.`,
      confidence: clamp(0.6 + evidenceMetrics.confidenceLift, 0.32, 0.94),
      verificationStatus: "partially_verified",
      estimatedTotalUsd: evidenceMetrics.valueUsd,
      travelMinutes: evidenceMetrics.valueMinutes,
      transferCount: evidenceMetrics.valueTransfers,
      flexibilityScore: evidenceMetrics.flexibilityScore,
      baggageScore: evidenceMetrics.baggageScore,
      bookingEaseScore: evidenceMetrics.bookingEaseScore,
      freshnessScore: clamp(evidenceMetrics.freshnessScore + 0.05, 0.2, 1),
      verifiedAt: valueVerification.verifiedAt,
      recheckAfter: valueVerification.recheckAfter,
      primarySourceUrl: sourceUrls[1] ?? primary,
      sourceUrls,
    }),
    applyFlightPreferenceAdjustments(goal, {
      category: "most_convenient",
      title: "Most Convenient Candidate",
      summary:
        "Favor fewer transfers and simpler booking flow while staying within acceptable budget variance from the low-cost candidate.",
      confidence: clamp(0.54 + evidenceMetrics.confidenceLift * 0.5, 0.3, 0.9),
      verificationStatus: "needs_live_check",
      estimatedTotalUsd: evidenceMetrics.convenientUsd,
      travelMinutes: evidenceMetrics.convenientMinutes,
      transferCount: evidenceMetrics.convenientTransfers,
      flexibilityScore: clamp(evidenceMetrics.flexibilityScore - 0.02, 0.2, 0.95),
      baggageScore: clamp(evidenceMetrics.baggageScore + 0.04, 0.2, 0.95),
      bookingEaseScore: clamp(evidenceMetrics.bookingEaseScore + 0.12, 0.2, 0.97),
      freshnessScore: evidenceMetrics.freshnessScore,
      verifiedAt: convenientVerification.verifiedAt,
      recheckAfter: convenientVerification.recheckAfter,
      primarySourceUrl: sourceUrls[2] ?? primary,
      sourceUrls,
    }),
  ];
}

export function buildDeterministicSynthesisOutput(args: {
  goal: CandidateGoalContext;
  sources: SourceEvidence[];
  unresolvedGaps?: string[];
}): SynthesisOutput {
  const allowedSourceUrls = new Set(args.sources.map((source) => source.url));
  return validateSynthesisOutput(
    {
      candidates: buildCandidateDrafts(args.goal, args.sources),
      shortlistSummary: createSynthesisSummary(
        args.sources.map((source) => ({ title: source.title, url: source.url })),
      ),
      unresolvedGaps: args.unresolvedGaps ?? [],
    },
    allowedSourceUrls,
  );
}
