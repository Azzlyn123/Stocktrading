import type { Candle } from "./types";
import { calculateATR, avgVolume } from "./indicators";

export interface ORFConfig {
  breakPct: number;
  failWindowBars: number;
  volMult: number;
  targetMultiple: number;
  stopBufferPct: number;
  timeExitMinutes: number;
  structureHoldEnabled: boolean;
  riskPct: number;
  cooldownBars: number;
  maxTradesPerTicker: number;
  trailAfterR: number;
  requireVolConfirmation: boolean;
}

export const DEFAULT_ORF_CONFIG: ORFConfig = {
  breakPct: 0.0025,
  failWindowBars: 3,
  volMult: 1.2,
  targetMultiple: 2.0,
  stopBufferPct: 0.001,
  timeExitMinutes: 375,
  structureHoldEnabled: false,
  riskPct: 0.005,
  cooldownBars: 3,
  maxTradesPerTicker: 3,
  trailAfterR: 1.5,
  requireVolConfirmation: true,
};

export interface OpeningRange {
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

export function calculateOpeningRange(bars5m: Candle[]): OpeningRange | null {
  if (bars5m.length < 1) return null;
  const firstBar = bars5m[0];
  return {
    high: firstBar.high,
    low: firstBar.low,
    volume: firstBar.volume,
    timestamp: firstBar.timestamp,
  };
}

export type BreakDirection = "ABOVE" | "BELOW";

export interface BreakDetection {
  broken: boolean;
  direction: BreakDirection | null;
  breakBarIndex: number;
  breakPrice: number;
  trapHigh: number;
  trapLow: number;
  volumeConfirmed: boolean;
}

export function detectBreak(
  bars5m: Candle[],
  or: OpeningRange,
  barIndex: number,
  config: ORFConfig,
  avgVol20: number,
): BreakDetection {
  const bar = bars5m[barIndex];
  const noBreak: BreakDetection = {
    broken: false,
    direction: null,
    breakBarIndex: -1,
    breakPrice: 0,
    trapHigh: 0,
    trapLow: 0,
    volumeConfirmed: false,
  };

  if (!bar) return noBreak;

  const breakAboveLevel = or.high * (1 + config.breakPct);
  const breakBelowLevel = or.low * (1 - config.breakPct);

  const volumeConfirmed = !config.requireVolConfirmation || (avgVol20 > 0 && bar.volume > config.volMult * avgVol20);

  if (bar.high >= breakAboveLevel) {
    let trapHigh = bar.high;
    for (let j = 1; j <= barIndex && j <= barIndex; j++) {
      if (bars5m[barIndex - j]) {
        trapHigh = Math.max(trapHigh, bars5m[barIndex - j].high);
      }
    }
    return {
      broken: true,
      direction: "ABOVE",
      breakBarIndex: barIndex,
      breakPrice: bar.high,
      trapHigh,
      trapLow: or.low,
      volumeConfirmed,
    };
  }

  if (bar.low <= breakBelowLevel) {
    let trapLow = bar.low;
    for (let j = 1; j <= barIndex && j <= barIndex; j++) {
      if (bars5m[barIndex - j]) {
        trapLow = Math.min(trapLow, bars5m[barIndex - j].low);
      }
    }
    return {
      broken: true,
      direction: "BELOW",
      breakBarIndex: barIndex,
      breakPrice: bar.low,
      trapHigh: or.high,
      trapLow,
      volumeConfirmed,
    };
  }

  return noBreak;
}

export interface FailureDetection {
  failed: boolean;
  direction: "SHORT" | "LONG" | null;
  failBarIndex: number;
  trapHigh: number;
  trapLow: number;
  spyDiverging: boolean;
  reasons: string[];
}

export function detectFailure(
  bars5m: Candle[],
  or: OpeningRange,
  breakInfo: BreakDetection,
  currentBarIndex: number,
  spyBars5m: Candle[],
  spyOR: OpeningRange | null,
  config: ORFConfig,
): FailureDetection {
  const noFail: FailureDetection = {
    failed: false,
    direction: null,
    failBarIndex: -1,
    trapHigh: 0,
    trapLow: 0,
    spyDiverging: false,
    reasons: [],
  };

  if (!breakInfo.broken || breakInfo.direction === null) return noFail;

  const barsSinceBreak = currentBarIndex - breakInfo.breakBarIndex;
  if (barsSinceBreak < 1 || barsSinceBreak > config.failWindowBars) return noFail;

  const bar = bars5m[currentBarIndex];
  if (!bar) return noFail;

  const reasons: string[] = [];

  let trapHigh = breakInfo.trapHigh;
  let trapLow = breakInfo.trapLow;
  for (let j = breakInfo.breakBarIndex; j <= currentBarIndex; j++) {
    if (bars5m[j]) {
      trapHigh = Math.max(trapHigh, bars5m[j].high);
      trapLow = Math.min(trapLow, bars5m[j].low);
    }
  }

  if (breakInfo.direction === "ABOVE") {
    if (bar.close > or.high) {
      reasons.push(`Close ${bar.close.toFixed(2)} still above OR high ${or.high.toFixed(2)}`);
      return { ...noFail, reasons };
    }
    reasons.push(`Failed breakout: closed ${bar.close.toFixed(2)} back below OR high ${or.high.toFixed(2)}`);

    let spyDiverging = false;
    if (spyOR) {
      const spyBreakLevel = spyOR.high * (1 + config.breakPct);
      let spyBroke = false;
      for (let j = 1; j <= currentBarIndex && j < spyBars5m.length; j++) {
        if (spyBars5m[j] && spyBars5m[j].high >= spyBreakLevel) {
          spyBroke = true;
          break;
        }
      }
      spyDiverging = !spyBroke;
      if (spyDiverging) {
        reasons.push("SPY diverging: did NOT break its OR high");
      } else {
        reasons.push("SPY confirmed breakout (no divergence)");
      }
    }

    return {
      failed: true,
      direction: "SHORT",
      failBarIndex: currentBarIndex,
      trapHigh,
      trapLow,
      spyDiverging: spyDiverging,
      reasons,
    };
  }

  if (breakInfo.direction === "BELOW") {
    if (bar.close < or.low) {
      reasons.push(`Close ${bar.close.toFixed(2)} still below OR low ${or.low.toFixed(2)}`);
      return { ...noFail, reasons };
    }
    reasons.push(`Failed breakdown: closed ${bar.close.toFixed(2)} back above OR low ${or.low.toFixed(2)}`);

    let spyDiverging = false;
    if (spyOR) {
      const spyBreakLevel = spyOR.low * (1 - config.breakPct);
      let spyBroke = false;
      for (let j = 1; j <= currentBarIndex && j < spyBars5m.length; j++) {
        if (spyBars5m[j] && spyBars5m[j].low <= spyBreakLevel) {
          spyBroke = true;
          break;
        }
      }
      spyDiverging = !spyBroke;
      if (spyDiverging) {
        reasons.push("SPY diverging: did NOT break its OR low");
      } else {
        reasons.push("SPY confirmed breakdown (no divergence)");
      }
    }

    return {
      failed: true,
      direction: "LONG",
      failBarIndex: currentBarIndex,
      trapHigh,
      trapLow,
      spyDiverging: spyDiverging,
      reasons,
    };
  }

  return noFail;
}

export interface ORFEntry {
  direction: "SHORT" | "LONG";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  riskPerShare: number;
  targetR: number;
  trapHigh: number;
  trapLow: number;
}

export function calculateORFEntry(
  failBar: Candle,
  failure: FailureDetection,
  atr14: number,
  config: ORFConfig,
): ORFEntry | null {
  if (!failure.failed || !failure.direction) return null;

  const entryPrice = failBar.close;

  if (failure.direction === "SHORT") {
    const stopBuffer = Math.max(entryPrice * config.stopBufferPct, atr14 * 0.1);
    const stopPrice = failure.trapHigh + stopBuffer;
    const riskPerShare = stopPrice - entryPrice;

    if (riskPerShare <= 0) return null;

    const targetPrice = entryPrice - riskPerShare * config.targetMultiple;

    return {
      direction: "SHORT",
      entryPrice,
      stopPrice,
      targetPrice,
      riskPerShare,
      targetR: config.targetMultiple,
      trapHigh: failure.trapHigh,
      trapLow: failure.trapLow,
    };
  }

  if (failure.direction === "LONG") {
    const stopBuffer = Math.max(entryPrice * config.stopBufferPct, atr14 * 0.1);
    const stopPrice = failure.trapLow - stopBuffer;
    const riskPerShare = entryPrice - stopPrice;

    if (riskPerShare <= 0) return null;

    const targetPrice = entryPrice + riskPerShare * config.targetMultiple;

    return {
      direction: "LONG",
      entryPrice,
      stopPrice,
      targetPrice,
      riskPerShare,
      targetR: config.targetMultiple,
      trapHigh: failure.trapHigh,
      trapLow: failure.trapLow,
    };
  }

  return null;
}
