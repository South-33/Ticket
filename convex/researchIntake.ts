export type ResearchDomain = "flight" | "train" | "concert" | "mixed" | "general";
export type ResearchMode = "fast" | "balanced" | "deep";

export type SlotMap = Record<string, string>;

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

function normalizeValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : undefined;
}

function parseDateHint(prompt: string) {
  const onDateMatch = prompt.match(
    /\b(?:on|for|leaving|departing)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (onDateMatch) {
    return normalizeValue(`${onDateMatch[1]} ${onDateMatch[2]}`);
  }

  const isoMatch = prompt.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  return undefined;
}

function parseBudgetHint(prompt: string) {
  const budgetMatch = prompt.match(/\b(?:budget|max|under|below)\s*\$?\s*(\d{2,5})\b/i);
  if (budgetMatch) {
    return budgetMatch[1];
  }
  const dollarMatch = prompt.match(/\$\s*(\d{2,5})\b/);
  if (dollarMatch) {
    return dollarMatch[1];
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

export function extractSlotsFromPrompt(prompt: string, domain: ResearchDomain): SlotMap {
  const extracted: SlotMap = {};

  const fromToMatch = prompt.match(/\bfrom\s+([a-zA-Z][a-zA-Z\s-]{1,40}?)\s+to\s+([a-zA-Z][a-zA-Z\s-]{1,40})\b/i);
  if (fromToMatch) {
    const origin = normalizeValue(fromToMatch[1]);
    const destination = normalizeValue(fromToMatch[2]);
    if (origin) {
      extracted.origin = origin;
    }
    if (destination) {
      extracted.destination = destination;
    }
  } else {
    const toMatch = prompt.match(/\bto\s+([a-zA-Z][a-zA-Z\s-]{1,40})\b/i);
    if (toMatch) {
      const destination = normalizeValue(toMatch[1]);
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

  const nationalityMatch = prompt.match(/\b(?:nationality|passport)\s*(?:is|:)?\s*([a-zA-Z][a-zA-Z\s-]{1,30})\b/i);
  if (nationalityMatch) {
    const nationality = normalizeValue(nationalityMatch[1]);
    if (nationality) {
      extracted.nationality = nationality;
    }
  }

  if (domain === "concert") {
    const eventMatch = prompt.match(/\b(?:concert|show|event)\s+(?:for\s+)?([a-zA-Z0-9][a-zA-Z0-9\s'&-]{1,60})\b/i);
    if (eventMatch) {
      const eventName = normalizeValue(eventMatch[1]);
      if (eventName) {
        extracted.eventName = eventName;
      }
    }
  }

  return extracted;
}

export function mergeSlots(promptSlots: SlotMap, memorySlots: SlotMap) {
  return {
    ...memorySlots,
    ...promptSlots,
  };
}

export function missingSlots(domain: ResearchDomain, mergedSlots: SlotMap) {
  return requiredSlotsForDomain(domain).filter((slot) => !mergedSlots[slot]);
}

export function buildFollowUpQuestion(domain: ResearchDomain, missing: string[]) {
  if (missing.length === 0) {
    return undefined;
  }

  const labels = missing.map((slot) => {
    if (slot === "departureDate") {
      return "departure date";
    }
    if (slot === "eventName") {
      return "event or artist";
    }
    return slot.replace(/([A-Z])/g, " $1").toLowerCase();
  });

  const base =
    domain === "flight"
      ? "Before I run deep fare research, I need"
      : "Before I run deep ticket research, I need";

  return `${base} your ${labels.join(", ")}. Share them in one message and I will continue automatically.`;
}

export function summarizeConstraints(slots: SlotMap) {
  const keys = Object.keys(slots);
  if (keys.length === 0) {
    return "No structured constraints extracted yet.";
  }

  const preview = keys
    .slice(0, 8)
    .map((key) => `${key}: ${slots[key]}`)
    .join(" | ");
  return preview;
}
