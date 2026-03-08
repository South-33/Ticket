import { describe, expect, test } from "vitest";
import {
  buildSearchConstraintTerms,
  extractProfileSeedSlots,
  extractSlotsFromPrompt,
  normalizeSlotEntries,
  optionalSlotsForDomain,
  requiredSlotsForDomain,
  summarizeConstraints,
} from "./researchIntake";

describe("research intake", () => {
  test("keeps existing required flight slots unchanged while exposing optional enrichers", () => {
    expect(requiredSlotsForDomain("flight")).toEqual([
      "origin",
      "destination",
      "departureDate",
      "budget",
      "nationality",
    ]);
    expect(optionalSlotsForDomain("flight")).toEqual([
      "returnDate",
      "passengerCount",
      "cabinClass",
      "nonstopOnly",
      "bags",
      "flexibilityLevel",
    ]);
  });

  test("extracts canonical optional flight slots from prompt text", () => {
    const slots = extractSlotsFromPrompt(
      "Find me a nonstop round trip flight from Manila to Frankfurt on 2026-08-11 return 2026-08-19 for 2 passengers in business class with checked bag and flexible dates",
      "flight",
    );

    expect(slots).toMatchObject({
      origin: "Manila",
      destination: "Frankfurt",
      departureDate: "2026-08-11",
      returnDate: "2026-08-19",
      passengerCount: "2",
      cabinClass: "business",
      nonstopOnly: "true",
      bags: "checked",
      flexibilityLevel: "flexible",
    });
  });

  test("normalizes flight alias keys and canonical values", () => {
    const normalized = normalizeSlotEntries("flight", [
      { key: "return_date", value: "2026/08/19" },
      { key: "travellers", value: "3 adults" },
      { key: "preferredCabin", value: "Premium Economy" },
      { key: "direct", value: "yes" },
      { key: "baggage", value: "carry on only" },
      { key: "flexibility", value: "slightly flexible" },
    ]);

    expect(normalized).toEqual([
      { key: "returnDate", value: "2026-08-19" },
      { key: "passengerCount", value: "3" },
      { key: "cabinClass", value: "premium_economy" },
      { key: "nonstopOnly", value: "true" },
      { key: "bags", value: "carry_on" },
      { key: "flexibilityLevel", value: "moderate" },
    ]);
  });

  test("seeds only supported flight trip slots from profile memory", () => {
    const seeded = extractProfileSeedSlots("flight", {
      preferredCabin: "Business Class",
      flexibilityLevel: "strict dates",
    });

    expect(seeded).toEqual({
      cabinClass: "business",
      flexibilityLevel: "strict",
    });
  });

  test("formats ordered summaries and search modifiers from structured flight slots", () => {
    const slots = {
      origin: "Manila",
      destination: "Frankfurt",
      departureDate: "2026-08-11",
      returnDate: "2026-08-19",
      passengerCount: "2",
      cabinClass: "business",
      nonstopOnly: "true",
      bags: "checked",
      flexibilityLevel: "flexible",
    };

    expect(summarizeConstraints("flight", slots)).toBe(
      "origin: Manila | destination: Frankfurt | departureDate: 2026-08-11 | returnDate: 2026-08-19 | passengerCount: 2 | cabinClass: business | nonstopOnly: true | bags: checked | flexibilityLevel: flexible",
    );
    expect(buildSearchConstraintTerms("flight", slots)).toEqual([
      "round trip",
      "return 2026-08-19",
      "2 passengers",
      "business class",
      "nonstop",
      "direct flight",
      "checked bag",
      "baggage included",
      "fare rules",
      "flexible dates",
      "plus minus 3 days",
    ]);
  });
});
