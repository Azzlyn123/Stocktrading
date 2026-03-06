import { describe, it, expect } from "vitest";
import { checkEntryGate } from "../entryGate";

describe("v7.1 entry gate", () => {
  it("rejects Tier B at power session for v7.1", () => {
    const r = checkEntryGate("v7.1", "B", 300);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NOT_TIER_A");
  });

  it("rejects Tier A in open session (minutesSinceOpen=60) for v7.1", () => {
    const r = checkEntryGate("v7.1", "A", 60);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NOT_POWER_SESSION");
  });

  it("rejects Tier A at exactly 240 min boundary for v7.1", () => {
    const r = checkEntryGate("v7.1", "A", 240);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NOT_POWER_SESSION");
  });

  it("accepts Tier A at 241 min (just past power boundary) for v7.1", () => {
    const r = checkEntryGate("v7.1", "A", 241);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("rejects null tier at power session for v7.1", () => {
    const r = checkEntryGate("v7.1", null, 300);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NOT_TIER_A");
  });

  it("v7.0 does not apply power session filter — Tier A open session accepted", () => {
    const r = checkEntryGate("v7.0", "A", 60);
    expect(r.allowed).toBe(true);
  });

  it("v7.0 still rejects Tier B — TIER_A_ONLY reason", () => {
    const r = checkEntryGate("v7.0", "B", 300);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("TIER_A_ONLY");
  });

  it("v7.2 applies Tier A gate but NOT the power session gate", () => {
    const tierA_open = checkEntryGate("v7.2", "A", 60);
    expect(tierA_open.allowed).toBe(true);

    const tierA_power = checkEntryGate("v7.2", "A", 300);
    expect(tierA_power.allowed).toBe(true);

    const tierB_power = checkEntryGate("v7.2", "B", 300);
    expect(tierB_power.allowed).toBe(false);
    expect(tierB_power.reason).toBe("TIER_A_ONLY");
  });

  it("pre-v7.0 allows all tiers and sessions", () => {
    expect(checkEntryGate("v6.6", "B", 60).allowed).toBe(true);
    expect(checkEntryGate("v6.6", "A", 300).allowed).toBe(true);
    expect(checkEntryGate("v1", null, 0).allowed).toBe(true);
  });
});
