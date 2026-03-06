import { describe, it, expect } from "vitest";
import { checkTieredExitRules } from "../exits";

const mkCandle = (close: number) => ({
  open: close - 0.05,
  high: close + 0.1,
  low: close - 0.1,
  close,
  volume: 10000,
  timestamp: "2025-01-01T10:00:00Z",
});

const baseExits = {
  partialAtR: 0.4,
  partialPct: 70,
  finalTargetR: 2.5,
  moveStopToBE: false,
  useEMA9Trail: false,
  usePriorLowTrail: false,
  hardExitRedCandles: 0,
  earlyFailureExit: false,
  impulseFilterEnabled: false,
  stopTightenAt15min: true,
};

const baseRisk = { maxPositionPct: 0.02, timeStopMinutes: 0, timeStopR: -0.5, cooldownMinutes: 0 };

const entry = 100;
const stop = 98;
const riskPerShare = 2;
const tightenedStopExpected = entry - 0.05 * riskPerShare;

describe("v7.2 stop-tighten branch", () => {
  it("fires at 15min when mfeR < 0.10 — shouldExit=false, newStopPrice=entry-0.05R", () => {
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, false, riskPerShare,
      15, baseExits, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.shouldExit).toBe(false);
    expect(result.newStopPrice).toBeCloseTo(tightenedStopExpected, 4);
    expect(result.reason).toContain("15min tighten");
  });

  it("fires at 30min when mfeR is still < 0.10", () => {
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, false, riskPerShare,
      30, baseExits, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.shouldExit).toBe(false);
    expect(result.newStopPrice).toBeCloseTo(tightenedStopExpected, 4);
  });

  it("does NOT fire before 15min even with low mfeR", () => {
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, false, riskPerShare,
      14, baseExits, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.reason).not.toContain("15min tighten");
    expect(result.newStopPrice).toBeNull();
  });

  it("does NOT fire when mfeR >= 0.10", () => {
    const candle = mkCandle(100.25);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, false, riskPerShare,
      20, baseExits, baseRisk, 0.5, undefined, 0.12
    );
    expect(result.reason).not.toContain("15min tighten");
  });

  it("does NOT fire when trade is already partially exited", () => {
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, true, riskPerShare,
      20, baseExits, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.reason).not.toContain("15min tighten");
  });

  it("does NOT fire when tightenedStop would be <= current stop", () => {
    const highStop = 99.95;
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, highStop, 100, false, riskPerShare,
      20, baseExits, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.reason).not.toContain("15min tighten");
  });

  it("disabled entirely when stopTightenAt15min=false", () => {
    const exitsOff = { ...baseExits, stopTightenAt15min: false };
    const candle = mkCandle(100.1);
    const result = checkTieredExitRules(
      candle, [], entry, stop, 100, false, riskPerShare,
      20, exitsOff, baseRisk, 0.5, undefined, 0.05
    );
    expect(result.reason).not.toContain("15min tighten");
  });
});
