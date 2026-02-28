import { describe, expect, it } from "vitest";
import { getNextAutoFollowEnabled } from "./chat-scroll";

describe("getNextAutoFollowEnabled", () => {
  it("detaches when user scrolls up while outputting and far from bottom", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: true,
      isOutputting: true,
      movedUp: true,
      bottomDistance: 180,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(false);
  });

  it("reattaches near bottom even while outputting", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: false,
      isOutputting: true,
      movedUp: false,
      bottomDistance: 24,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(true);
  });

  it("stays attached while outputting if user has not detached", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: true,
      isOutputting: true,
      movedUp: false,
      bottomDistance: 320,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(true);
  });

  it("stays attached when user nudges up but remains near bottom", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: true,
      isOutputting: true,
      movedUp: true,
      bottomDistance: 88,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(true);
  });

  it("stays attached when not outputting until user detaches", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: true,
      isOutputting: false,
      movedUp: false,
      bottomDistance: 300,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(true);
  });

  it("detaches when user scrolls up far while idle", () => {
    const enabled = getNextAutoFollowEnabled({
      wasEnabled: true,
      isOutputting: false,
      movedUp: true,
      bottomDistance: 220,
      attachThresholdPx: 56,
      detachThresholdPx: 120,
    });

    expect(enabled).toBe(false);
  });
});
