export type ResearchDomain = "flight" | "train" | "concert" | "mixed" | "general";
export type ResearchMode = "fast" | "balanced" | "deep";

export type SlotMap = Record<string, string>;

type SlotDefinition = {
  key: string;
  required?: boolean;
  label: string;
  aliases?: string[];
  normalize?: (value: string) => string | undefined;
  queryTerms?: (value: string) => string[];
};

const REQUIRED_SLOTS: Record<ResearchDomain, string[]> = {
  flight: ["origin", "destination", "departureDate", "budget", "nationality"],
  train: ["origin", "destination", "departureDate", "budget"],
  concert: ["eventName", "destination", "departureDate", "budget"],
  mixed: ["origin", "destination", "departureDate", "budget"],
  general: [],
};

const GENERIC_TRAVEL_PATTERN =
  /\b(travel|trip|vacation|holiday|itinerary|destination|from\s+[a-zA-Z][a-zA-Z\s-]{1,30}\s+to\s+[a-zA-Z][a-zA-Z\s-]{1,30})\b/i;

const RESEARCH_INTENT_PATTERN =
  /\b(flight|airport|airline|fare|train|rail|station|concert|show|gig|ticket|book|booking|route|layover|stopover|seat|baggage|cheapest|best value|most convenient|price|deal|promo)\b/i;

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function normalizeWhitespace(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : undefined;
}

function normalizeLookupToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIsoDatePieces(year: string, month: string, day: string) {
  const normalizedYear = year.padStart(4, "0");
  const normalizedMonth = month.padStart(2, "0");
  const normalizedDay = day.padStart(2, "0");
  return `${normalizedYear}-${normalizedMonth}-${normalizedDay}`;
}

function normalizeDateValue(value: string) {
  const compact = normalizeWhitespace(value);
  if (!compact) {
    return undefined;
  }

  const isoMatch = compact.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return normalizeIsoDatePieces(isoMatch[1] ?? "", isoMatch[2] ?? "", isoMatch[3] ?? "");
  }

  const slashMatch = compact.match(/\b(20\d{2})[/.](\d{1,2})[/.](\d{1,2})\b/);
  if (slashMatch) {
    return normalizeIsoDatePieces(slashMatch[1] ?? "", slashMatch[2] ?? "", slashMatch[3] ?? "");
  }

  const writtenDateMatch = compact.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i,
  );
  if (writtenDateMatch) {
    const month = MONTHS[(writtenDateMatch[1] ?? "").toLowerCase()];
    if (month) {
      return normalizeIsoDatePieces(writtenDateMatch[3] ?? "", month, writtenDateMatch[2] ?? "");
    }
  }

  return compact;
}

function normalizeBudgetValue(value: string) {
  const compact = normalizeWhitespace(value);
  if (!compact) {
    return undefined;
  }
  const numeric = compact.replace(/[^0-9.]/g, "");
  if (!numeric) {
    return compact;
  }
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return compact;
  }
  return String(Math.round(parsed));
}

function normalizePassengerCountValue(value: string) {
  const compact = normalizeWhitespace(value);
  if (!compact) {
    return undefined;
  }
  const parsed = Number(compact.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return String(Math.round(parsed));
}

function normalizeBooleanValue(value: string) {
  const compact = normalizeWhitespace(value)?.toLowerCase();
  if (!compact) {
    return undefined;
  }
  if (/^(true|yes|y|1|direct|nonstop|required|only)$/i.test(compact)) {
    return "true";
  }
  if (/^(false|no|n|0|either|any|not necessary|not required)$/i.test(compact)) {
    return "false";
  }
  return undefined;
}

function normalizeCabinClassValue(value: string) {
  const compact = normalizeWhitespace(value)?.toLowerCase();
  if (!compact) {
    return undefined;
  }
  if (/(premium[\s_-]*economy|premium eco|prem econ)/i.test(compact)) {
    return "premium_economy";
  }
  if (/\b(business|biz|business class)\b/i.test(compact)) {
    return "business";
  }
  if (/\b(first|first class)\b/i.test(compact)) {
    return "first";
  }
  if (/\b(economy|coach|main cabin)\b/i.test(compact)) {
    return "economy";
  }
  return undefined;
}

function normalizeBagsValue(value: string) {
  const compact = normalizeWhitespace(value)?.toLowerCase();
  if (!compact) {
    return undefined;
  }
  if (/\b(none|no bags?|no baggage|personal item only|no checked bags?)\b/i.test(compact)) {
    return "none";
  }
  if (/\b(carry[\s_-]*on|carryon|cabin bag|hand luggage)\b/i.test(compact)) {
    return "carry_on";
  }
  if (/\b(checked|checked bag|checked baggage|hold bag|hold luggage)\b/i.test(compact)) {
    return "checked";
  }
  return undefined;
}

function normalizeFlexibilityValue(value: string) {
  const compact = normalizeWhitespace(value)?.toLowerCase();
  if (!compact) {
    return undefined;
  }
  if (/^(yes|y|true|1)$/i.test(compact)) {
    return "flexible";
  }
  if (/^(no|n|false|0)$/i.test(compact)) {
    return "strict";
  }
  if (/\b(strict|fixed|exact|not flexible|no flexibility)\b/i.test(compact)) {
    return "strict";
  }
  if (/\b(moderate|somewhat flexible|slightly flexible|a little flexible)\b/i.test(compact)) {
    return "moderate";
  }
  if (/\b(flexible|plus or minus|\+\/-|window|around those dates|date range)\b/i.test(compact)) {
    return "flexible";
  }
  return undefined;
}

const DOMAIN_SLOT_DEFINITIONS: Record<ResearchDomain, SlotDefinition[]> = {
  flight: [
    { key: "origin", required: true, label: "origin", aliases: ["from", "origincity", "originairport"] },
    { key: "destination", required: true, label: "destination", aliases: ["to", "destinationcity", "destinationairport"] },
    {
      key: "departureDate",
      required: true,
      label: "departure date",
      aliases: ["departure", "departdate", "departure_date", "traveldate", "date"],
      normalize: normalizeDateValue,
    },
    {
      key: "budget",
      required: true,
      label: "budget",
      aliases: ["maxbudget", "pricecap"],
      normalize: normalizeBudgetValue,
    },
    {
      key: "nationality",
      required: true,
      label: "nationality",
      aliases: ["passport", "passportcountry", "citizenship"],
      normalize: normalizeWhitespace,
    },
    {
      key: "returnDate",
      label: "return date",
      aliases: ["returndate", "return_date", "inbounddate", "returning", "backon"],
      normalize: normalizeDateValue,
      queryTerms: (value) => [`round trip`, `return ${value}`],
    },
    {
      key: "passengerCount",
      label: "passenger count",
      aliases: ["passengers", "travellers", "travelers", "travelercount", "passengercount", "adults"],
      normalize: normalizePassengerCountValue,
      queryTerms: (value) => [`${value} passenger${value === "1" ? "" : "s"}`],
    },
    {
      key: "cabinClass",
      label: "cabin class",
      aliases: ["cabin", "cabinclass", "preferredcabin", "classofservice"],
      normalize: normalizeCabinClassValue,
      queryTerms: (value) => [`${value.replace(/_/g, " ")} class`],
    },
    {
      key: "nonstopOnly",
      label: "nonstop only",
      aliases: ["nonstop", "directonly", "direct", "layoverfree"],
      normalize: normalizeBooleanValue,
      queryTerms: (value) => (value === "true" ? ["nonstop", "direct flight"] : []),
    },
    {
      key: "bags",
      label: "bags",
      aliases: ["bag", "baggage", "baggagepref", "bagpreference"],
      normalize: normalizeBagsValue,
      queryTerms: (value) => {
        if (value === "checked") {
          return ["checked bag", "baggage included", "fare rules"];
        }
        if (value === "carry_on") {
          return ["carry-on only", "cabin bag"];
        }
        if (value === "none") {
          return ["no checked bag"];
        }
        return [];
      },
    },
    {
      key: "flexibilityLevel",
      label: "flexibility",
      aliases: ["flexibility", "flexibility_level", "dateflexibility"],
      normalize: normalizeFlexibilityValue,
      queryTerms: (value) => {
        if (value === "flexible") {
          return ["flexible dates", "plus minus 3 days"];
        }
        if (value === "strict") {
          return ["exact dates"];
        }
        return ["small date window"];
      },
    },
  ],
  train: [
    { key: "origin", required: true, label: "origin" },
    { key: "destination", required: true, label: "destination" },
    { key: "departureDate", required: true, label: "departure date", normalize: normalizeDateValue },
    { key: "budget", required: true, label: "budget", normalize: normalizeBudgetValue },
  ],
  concert: [
    { key: "eventName", required: true, label: "event or artist" },
    { key: "destination", required: true, label: "destination" },
    { key: "departureDate", required: true, label: "date", normalize: normalizeDateValue },
    { key: "budget", required: true, label: "budget", normalize: normalizeBudgetValue },
  ],
  mixed: [
    { key: "origin", required: true, label: "origin" },
    { key: "destination", required: true, label: "destination" },
    { key: "departureDate", required: true, label: "departure date", normalize: normalizeDateValue },
    { key: "budget", required: true, label: "budget", normalize: normalizeBudgetValue },
  ],
  general: [],
};

const SLOT_DEFINITION_INDEX: Record<ResearchDomain, Map<string, SlotDefinition>> = {
  flight: createSlotIndex(DOMAIN_SLOT_DEFINITIONS.flight),
  train: createSlotIndex(DOMAIN_SLOT_DEFINITIONS.train),
  concert: createSlotIndex(DOMAIN_SLOT_DEFINITIONS.concert),
  mixed: createSlotIndex(DOMAIN_SLOT_DEFINITIONS.mixed),
  general: createSlotIndex(DOMAIN_SLOT_DEFINITIONS.general),
};

function createSlotIndex(definitions: SlotDefinition[]) {
  const index = new Map<string, SlotDefinition>();
  for (const definition of definitions) {
    index.set(normalizeLookupToken(definition.key), definition);
    for (const alias of definition.aliases ?? []) {
      index.set(normalizeLookupToken(alias), definition);
    }
  }
  return index;
}

function getSlotDefinition(domain: ResearchDomain, key: string) {
  return SLOT_DEFINITION_INDEX[domain].get(normalizeLookupToken(key));
}

function parseDateHint(prompt: string) {
  const onDateMatch = prompt.match(
    /\b(?:on|for|leaving|departing)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (onDateMatch) {
    return normalizeWhitespace(`${onDateMatch[1]} ${onDateMatch[2]}`);
  }

  const isoMatch = prompt.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return normalizeDateValue(isoMatch[1] ?? "");
  }

  return undefined;
}

function parseReturnDateHint(prompt: string) {
  const isoPatterns = [
    /\b(?:return|returning|come back|back)\s+(?:on\s+)?(20\d{2}-\d{2}-\d{2})\b/i,
    /\b(?:round trip|round-trip).{0,40}?(20\d{2}-\d{2}-\d{2})\b/i,
  ];
  for (const pattern of isoPatterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return normalizeDateValue(match[1]);
    }
  }

  const writtenPatterns = [
    /\b(?:return|returning|come back|back)\s+(?:on\s+)?((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+20\d{2})\b/i,
  ];
  for (const pattern of writtenPatterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return normalizeDateValue(match[1]);
    }
  }

  return undefined;
}

function parseBudgetHint(prompt: string) {
  const budgetMatch = prompt.match(/\b(?:budget|max|under|below)\s*\$?\s*(\d{2,5})\b/i);
  if (budgetMatch) {
    return normalizeBudgetValue(budgetMatch[1] ?? "");
  }
  const dollarMatch = prompt.match(/\$\s*(\d{2,5})\b/);
  if (dollarMatch) {
    return normalizeBudgetValue(dollarMatch[1] ?? "");
  }
  return undefined;
}

function parsePassengerCountHint(prompt: string) {
  const patterns = [
    /\b(\d{1,2})\s+(?:passengers?|travelers?|travellers?|people|persons|adults?)\b/i,
    /\bparty\s+of\s+(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return normalizePassengerCountValue(match[1]);
    }
  }
  return undefined;
}

function parseCabinClassHint(prompt: string) {
  const compact = prompt.toLowerCase();
  if (/(premium[\s_-]*economy|premium eco|prem econ)/i.test(compact)) {
    return "premium_economy";
  }
  if (/\b(business|biz|business class)\b/i.test(compact)) {
    return "business";
  }
  if (/\b(first|first class)\b/i.test(compact)) {
    return "first";
  }
  if (/\b(economy|coach|main cabin)\b/i.test(compact)) {
    return "economy";
  }
  return undefined;
}

function parseNonstopHint(prompt: string) {
  if (/\b(non[-\s]?stop|nonstop only|direct only|direct flight|no layovers?|without layovers?|no stops?)\b/i.test(prompt)) {
    return "true";
  }
  if (/\b(stops?\s+ok(?:ay)?|layovers?\s+ok(?:ay)?|does(?:\s+not|n't)\s+need\s+to\s+be\s+direct)\b/i.test(prompt)) {
    return "false";
  }
  return undefined;
}

function parseBagsHint(prompt: string) {
  if (/\b(no bags?|no baggage|no checked bags?|personal item only)\b/i.test(prompt)) {
    return "none";
  }
  if (/\b(carry[\s_-]*on only|carryon only|cabin bag|hand luggage)\b/i.test(prompt)) {
    return "carry_on";
  }
  if (/\b(checked bag|checked baggage|hold bag|hold luggage)\b/i.test(prompt)) {
    return "checked";
  }
  return undefined;
}

function parseFlexibilityHint(prompt: string) {
  if (/\b(strict dates|fixed dates|exact dates|not flexible|no flexibility)\b/i.test(prompt)) {
    return "strict";
  }
  if (/\b(moderately flexible|somewhat flexible|slightly flexible)\b/i.test(prompt)) {
    return "moderate";
  }
  if (/\b(flexible dates?|plus or minus|\+\/-|\bflexible\b|within \d+ days?)\b/i.test(prompt)) {
    return "flexible";
  }
  return undefined;
}

export function detectDomain(prompt: string): ResearchDomain {
  const value = prompt.toLowerCase();
  const hasFlight = /(flight|airport|layover|airline|fare)/.test(value);
  const hasTrain = /(train|rail|station|eurail)/.test(value);
  const hasConcert = /(concert|show|gig|ticketmaster|seatgeek|event)/.test(value);
  const hasGenericTravel = GENERIC_TRAVEL_PATTERN.test(value);

  const count = Number(hasFlight) + Number(hasTrain) + Number(hasConcert);
  if (count >= 2) {
    return "mixed";
  }
  if (hasFlight) {
    return "flight";
  }
  if (hasTrain) {
    return "train";
  }
  if (hasConcert) {
    return "concert";
  }
  if (hasGenericTravel) {
    return "mixed";
  }
  return "general";
}

export function isResearchIntent(prompt: string) {
  if (RESEARCH_INTENT_PATTERN.test(prompt)) {
    return true;
  }

  return detectDomain(prompt) !== "general";
}

export function detectMode(prompt: string): ResearchMode {
  const value = prompt.toLowerCase();
  if (/(deep|thorough|full research|comprehensive)/.test(value)) {
    return "deep";
  }
  if (/(quick|fast|asap|urgent)/.test(value)) {
    return "fast";
  }
  return "balanced";
}

export function requiredSlotsForDomain(domain: ResearchDomain) {
  return REQUIRED_SLOTS[domain];
}

export function optionalSlotsForDomain(domain: ResearchDomain) {
  return DOMAIN_SLOT_DEFINITIONS[domain].filter((slot) => !slot.required).map((slot) => slot.key);
}

export function normalizeSlotKey(domain: ResearchDomain, key: string) {
  const compact = normalizeWhitespace(key);
  if (!compact) {
    return "";
  }
  return getSlotDefinition(domain, compact)?.key ?? compact.trim();
}

export function normalizeSlotValue(domain: ResearchDomain, key: string, value: string) {
  const compact = normalizeWhitespace(value);
  if (!compact) {
    return undefined;
  }
  const definition = getSlotDefinition(domain, key);
  if (!definition?.normalize) {
    return compact;
  }
  return definition.normalize(compact);
}

export function normalizeSlotEntry(domain: ResearchDomain, key: string, value: string) {
  const canonicalKey = normalizeSlotKey(domain, key);
  if (!canonicalKey) {
    return null;
  }
  const canonicalValue = normalizeSlotValue(domain, canonicalKey, value);
  if (!canonicalValue) {
    return null;
  }
  return {
    key: canonicalKey,
    value: canonicalValue,
  };
}

export function normalizeSlotEntries(
  domain: ResearchDomain,
  entries: Array<{ key: string; value: string }>,
) {
  const normalized = new Map<string, string>();
  for (const entry of entries) {
    const canonical = normalizeSlotEntry(domain, entry.key, entry.value);
    if (!canonical) {
      continue;
    }
    normalized.set(canonical.key, canonical.value);
  }
  return Array.from(normalized.entries()).map(([key, value]) => ({ key, value }));
}

export function canonicalizeSlotMap(domain: ResearchDomain, slots: SlotMap) {
  return Object.fromEntries(
    normalizeSlotEntries(
      domain,
      Object.entries(slots).map(([key, value]) => ({ key, value })),
    ).map((entry) => [entry.key, entry.value]),
  );
}

export function extractProfileSeedSlots(
  domain: ResearchDomain,
  profile: {
    preferredCabin?: string;
    flexibilityLevel?: string;
  } | null,
) {
  if (!profile || domain !== "flight") {
    return {} satisfies SlotMap;
  }

  const seeded = normalizeSlotEntries(domain, [
    { key: "cabinClass", value: profile.preferredCabin ?? "" },
    { key: "flexibilityLevel", value: profile.flexibilityLevel ?? "" },
  ]);

  return Object.fromEntries(seeded.map((entry) => [entry.key, entry.value]));
}

export function extractSlotsFromPrompt(prompt: string, domain: ResearchDomain): SlotMap {
  const extracted: SlotMap = {};

  const fromToMatch = prompt.match(
    /\bfrom\s+([a-zA-Z][a-zA-Z -]{1,40}?)\s+to\s+([a-zA-Z][a-zA-Z -]{1,40}?)(?=\s+(?:on|for|return|returning|with|in|nonstop|direct|round[-\s]?trip|$))/i,
  );
  if (fromToMatch) {
    const origin = normalizeWhitespace(fromToMatch[1]);
    const destination = normalizeWhitespace(fromToMatch[2]);
    if (origin) {
      extracted.origin = origin;
    }
    if (destination) {
      extracted.destination = destination;
    }
  } else {
    const toMatch = prompt.match(
      /\bto\s+([a-zA-Z][a-zA-Z -]{1,40}?)(?=\s+(?:on|for|return|returning|with|in|nonstop|direct|round[-\s]?trip|$))/i,
    );
    if (toMatch) {
      const destination = normalizeWhitespace(toMatch[1]);
      if (destination) {
        extracted.destination = destination;
      }
    }
  }

  const dateHint = parseDateHint(prompt);
  if (dateHint) {
    extracted.departureDate = dateHint;
  }

  const budgetHint = parseBudgetHint(prompt);
  if (budgetHint) {
    extracted.budget = budgetHint;
  }

  const nationalityMatch = prompt.match(/\b(?:nationality|passport)\s*(?:is|:)?\s*([a-zA-Z][a-zA-Z -]{1,30})\b/i);
  if (nationalityMatch) {
    const nationality = normalizeWhitespace(nationalityMatch[1]);
    if (nationality) {
      extracted.nationality = nationality;
    }
  }

  if (domain === "concert") {
    const eventMatch = prompt.match(/\b(?:concert|show|event)\s+(?:for\s+)?([a-zA-Z0-9][a-zA-Z0-9\s'&-]{1,60})\b/i);
    if (eventMatch) {
      const eventName = normalizeWhitespace(eventMatch[1]);
      if (eventName) {
        extracted.eventName = eventName;
      }
    }
  }

  if (domain === "flight") {
    const returnDate = parseReturnDateHint(prompt);
    const passengerCount = parsePassengerCountHint(prompt);
    const cabinClass = parseCabinClassHint(prompt);
    const nonstopOnly = parseNonstopHint(prompt);
    const bags = parseBagsHint(prompt);
    const flexibilityLevel = parseFlexibilityHint(prompt);

    if (returnDate) {
      extracted.returnDate = returnDate;
    }
    if (passengerCount) {
      extracted.passengerCount = passengerCount;
    }
    if (cabinClass) {
      extracted.cabinClass = cabinClass;
    }
    if (nonstopOnly) {
      extracted.nonstopOnly = nonstopOnly;
    }
    if (bags) {
      extracted.bags = bags;
    }
    if (flexibilityLevel) {
      extracted.flexibilityLevel = flexibilityLevel;
    }
  }

  return canonicalizeSlotMap(domain, extracted);
}

export function mergeSlots(promptSlots: SlotMap, memorySlots: SlotMap) {
  return {
    ...memorySlots,
    ...promptSlots,
  };
}

export function slotMapFromGoalSlots(
  domain: ResearchDomain,
  slots: Array<{ key: string; value?: string; status: "missing" | "provided" | "confirmed" }>,
) {
  const provided = new Map<string, string>();
  for (const slot of slots) {
    if (slot.status === "missing" || !slot.value?.trim()) {
      continue;
    }
    const normalized = normalizeSlotEntry(domain, slot.key, slot.value);
    if (!normalized) {
      continue;
    }
    provided.set(normalized.key, normalized.value);
  }
  return Object.fromEntries(provided.entries());
}

export function missingSlots(domain: ResearchDomain, mergedSlots: SlotMap) {
  const normalized = canonicalizeSlotMap(domain, mergedSlots);
  return requiredSlotsForDomain(domain).filter((slot) => !normalized[slot]);
}

function humanSlotLabel(domain: ResearchDomain, slot: string) {
  const definition = getSlotDefinition(domain, slot);
  if (definition) {
    return definition.label;
  }
  if (slot === "departureDate") {
    return "departure date";
  }
  if (slot === "eventName") {
    return "event or artist";
  }
  return slot.replace(/([A-Z])/g, " $1").toLowerCase();
}

export function buildFollowUpQuestion(domain: ResearchDomain, missing: string[]) {
  if (missing.length === 0) {
    return undefined;
  }

  const labels = missing.map((slot) => humanSlotLabel(domain, slot));
  const base =
    domain === "flight"
      ? "Before I run deep fare research, I need"
      : "Before I run deep ticket research, I need";

  return `${base} your ${labels.join(", ")}. Share them in one message and I will continue automatically.`;
}

export function summarizeConstraints(domain: ResearchDomain, slots: SlotMap) {
  const normalized = canonicalizeSlotMap(domain, slots);
  const orderedKeys = [
    ...DOMAIN_SLOT_DEFINITIONS[domain].map((definition) => definition.key),
    ...Object.keys(normalized),
  ];
  const uniqueOrderedKeys = Array.from(new Set(orderedKeys));
  const entries = uniqueOrderedKeys
    .filter((key) => !!normalized[key])
    .slice(0, 12)
    .map((key) => `${key}: ${normalized[key]}`);

  if (entries.length === 0) {
    return "No structured constraints extracted yet.";
  }

  return entries.join(" | ");
}

export function buildSearchConstraintTerms(domain: ResearchDomain, slots: SlotMap) {
  const normalized = canonicalizeSlotMap(domain, slots);
  const terms: string[] = [];
  for (const definition of DOMAIN_SLOT_DEFINITIONS[domain]) {
    const value = normalized[definition.key];
    if (!value || !definition.queryTerms) {
      continue;
    }
    terms.push(...definition.queryTerms(value));
  }
  return Array.from(new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0)));
}
