import type { Candle } from "./types";
import { calculateATR, calculateVWAP } from "./indicators";

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
  minOR_ATR: number;
  minBreak_ATR: number;
  partialExitEnabled: boolean;
  partialExitR: number;
  partialExitPct: number;
  vwapExitEnabled: boolean;
  vwapExitMode: "full" | "partial" | "off";
  requireRSConfirmation: boolean;
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
  minOR_ATR: 0.25,
  minBreak_ATR: 0.10,
  partialExitEnabled: true,
  partialExitR: 1.0,
  partialExitPct: 0.5,
  vwapExitEnabled: false,
  vwapExitMode: "off",
  requireRSConfirmation: true,
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

export function checkORQualityGate(
  or: OpeningRange,
  atr14: number,
  config: ORFConfig,
): { passed: boolean; orRange: number; minRequired: number; reason: string } {
  const orRange = or.high - or.low;
  const minRequired = config.minOR_ATR * atr14;
  if (orRange < minRequired) {
    return {
      passed: false,
      orRange,
      minRequired,
      reason: `OR range $${orRange.toFixed(3)} < ${config.minOR_ATR}*ATR ($${minRequired.toFixed(3)})`,
    };
  }
  return { passed: true, orRange, minRequired, reason: "OR quality gate passed" };
}

export type BreakDirection = "ABOVE" | "BELOW";

export interface BreakDetection {
  broken: boolean;
  direction: BreakDirection | null;
  breakBarIndex: number;
  breakPrice: number;
  breakDistance: number;
  trapHigh: number;
  trapLow: number;
  volumeConfirmed: boolean;
  qualityPassed: boolean;
}

export function detectBreak(
  bars5m: Candle[],
  or: OpeningRange,
  barIndex: number,
  config: ORFConfig,
  avgVol20: number,
  atr14: number,
): BreakDetection {
  const noBreak: BreakDetection = {
    broken: false,
    direction: null,
    breakBarIndex: -1,
    breakPrice: 0,
    breakDistance: 0,
    trapHigh: 0,
    trapLow: 0,
    volumeConfirmed: false,
    qualityPassed: false,
  };

  const bar = bars5m[barIndex];
  if (!bar) return noBreak;

  const breakAboveLevel = or.high * (1 + config.breakPct);
  const breakBelowLevel = or.low * (1 - config.breakPct);

  const volumeConfirmed = !config.requireVolConfirmation || (avgVol20 > 0 && bar.volume > config.volMult * avgVol20);

  if (bar.high >= breakAboveLevel) {
    const breakDistance = bar.high - or.high;
    const minBreakDist = config.minBreak_ATR * atr14;
    const qualityPassed = breakDistance >= minBreakDist;

    let trapHigh = bar.high;
    for (let j = 1; j <= barIndex; j++) {
      if (bars5m[barIndex - j]) {
        trapHigh = Math.max(trapHigh, bars5m[barIndex - j].high);
      }
    }
    return {
      broken: true,
      direction: "ABOVE",
      breakBarIndex: barIndex,
      breakPrice: bar.high,
      breakDistance,
      trapHigh,
      trapLow: or.low,
      volumeConfirmed,
      qualityPassed,
    };
  }

  if (bar.low <= breakBelowLevel) {
    const breakDistance = or.low - bar.low;
    const minBreakDist = config.minBreak_ATR * atr14;
    const qualityPassed = breakDistance >= minBreakDist;

    let trapLow = bar.low;
    for (let j = 1; j <= barIndex; j++) {
      if (bars5m[barIndex - j]) {
        trapLow = Math.min(trapLow, bars5m[barIndex - j].low);
      }
    }
    return {
      broken: true,
      direction: "BELOW",
      breakBarIndex: barIndex,
      breakPrice: bar.low,
      breakDistance,
      trapHigh: or.high,
      trapLow,
      volumeConfirmed,
      qualityPassed,
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
  rsConfirmed: boolean;
  rsValue: number;
  reasons: string[];
}

export function computeRelativeStrength(
  tickerBars: Candle[],
  spyBars: Candle[],
  currentBarIndex: number,
): number {
  if (currentBarIndex < 1 || tickerBars.length < 2 || spyBars.length < 2) return 0;
  const tickerOpen = tickerBars[0].open;
  const spyOpen = spyBars[0].open;
  if (tickerOpen === 0 || spyOpen === 0) return 0;

  const tickerCurrent = tickerBars[Math.min(currentBarIndex, tickerBars.length - 1)].close;
  const spyCurrent = spyBars[Math.min(currentBarIndex, spyBars.length - 1)].close;

  const tickerReturn = (tickerCurrent - tickerOpen) / tickerOpen;
  const spyReturn = (spyCurrent - spyOpen) / spyOpen;

  return tickerReturn - spyReturn;
}

export function computeRSSlope(
  tickerBars: Candle[],
  spyBars: Candle[],
  currentBarIndex: number,
  lookback: number = 3,
): number {
  if (currentBarIndex < lookback + 1) return 0;
  const rsCurrent = computeRelativeStrength(tickerBars, spyBars, currentBarIndex);
  const rsPrior = computeRelativeStrength(tickerBars, spyBars, currentBarIndex - lookback);
  return rsCurrent - rsPrior;
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
    rsConfirmed: false,
    rsValue: 0,
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

  const rsSlope = computeRSSlope(bars5m, spyBars5m, currentBarIndex, 3);
  const rsValue = computeRelativeStrength(bars5m, spyBars5m, currentBarIndex);

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
      reasons.push(spyDiverging ? "SPY diverging: did NOT break its OR high" : "SPY confirmed breakout (no divergence)");
    }

    const rsConfirmed = !config.requireRSConfirmation || rsSlope < 0;
    if (config.requireRSConfirmation) {
      reasons.push(rsConfirmed
        ? `RS confirmed: slope=${rsSlope.toFixed(5)} (stock weakening vs SPY)`
        : `RS NOT confirmed: slope=${rsSlope.toFixed(5)} (stock still strong vs SPY)`);
    }

    return {
      failed: true,
      direction: "SHORT",
      failBarIndex: currentBarIndex,
      trapHigh,
      trapLow,
      spyDiverging,
      rsConfirmed,
      rsValue,
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
      reasons.push(spyDiverging ? "SPY diverging: did NOT break its OR low" : "SPY confirmed breakdown (no divergence)");
    }

    const rsConfirmed = !config.requireRSConfirmation || rsSlope > 0;
    if (config.requireRSConfirmation) {
      reasons.push(rsConfirmed
        ? `RS confirmed: slope=${rsSlope.toFixed(5)} (stock strengthening vs SPY)`
        : `RS NOT confirmed: slope=${rsSlope.toFixed(5)} (stock still weak vs SPY)`);
    }

    return {
      failed: true,
      direction: "LONG",
      failBarIndex: currentBarIndex,
      trapHigh,
      trapLow,
      spyDiverging,
      rsConfirmed,
      rsValue,
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
