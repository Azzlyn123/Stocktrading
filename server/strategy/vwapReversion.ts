import type { Candle } from "./types";
import { calculateVWAP, calculateATR, lastEMA, avgVolume } from "./indicators";

export interface VwapReversionConfig {
  minDeviationATR: number;
  maxDeviationATR: number;
  exhaustionWickMinPct: number;
  exhaustionVolDeclinePct: number;
  minBarsFromOpen: number;
  maxBarsFromOpen: number;
  stopBufferATR: number;
  target1ReversionPct: number;
  target2ReversionPct: number;
  riskPct: number;
  minATR14: number;
}

export const DEFAULT_REVERSION_CONFIG: VwapReversionConfig = {
  minDeviationATR: 1.5,
  maxDeviationATR: 4.0,
  exhaustionWickMinPct: 0.30,
  exhaustionVolDeclinePct: 0.70,
  minBarsFromOpen: 6,
  maxBarsFromOpen: 60,
  stopBufferATR: 0.3,
  target1ReversionPct: 0.50,
  target2ReversionPct: 1.0,
  riskPct: 0.005,
  minATR14: 0,
};

export interface OverextensionResult {
  overextended: boolean;
  direction: "LONG_FADE" | "SHORT_FADE" | null;
  deviationATR: number;
  vwap: number;
  price: number;
  atr14: number;
  reasons: string[];
}

export function checkOverextension(
  bars5m: Candle[],
  config: VwapReversionConfig,
): OverextensionResult {
  const reasons: string[] = [];

  if (bars5m.length < 14) {
    return { overextended: false, direction: null, deviationATR: 0, vwap: 0, price: 0, atr14: 0, reasons: ["Insufficient bars"] };
  }

  const vwap = calculateVWAP(bars5m);
  const atr14 = calculateATR(bars5m, 14);
  const lastBar = bars5m[bars5m.length - 1];
  const price = lastBar.close;

  if (atr14 <= 0 || vwap <= 0) {
    return { overextended: false, direction: null, deviationATR: 0, vwap, price, atr14, reasons: ["ATR or VWAP zero"] };
  }

  if (config.minATR14 > 0 && atr14 < config.minATR14) {
    return { overextended: false, direction: null, deviationATR: 0, vwap, price, atr14, reasons: [`ATR14 ${atr14.toFixed(4)} below minimum ${config.minATR14}`] };
  }

  const deviation = price - vwap;
  const deviationATR = Math.abs(deviation) / atr14;

  if (deviationATR < config.minDeviationATR) {
    reasons.push(`Deviation ${deviationATR.toFixed(2)} ATR below min ${config.minDeviationATR}`);
    return { overextended: false, direction: null, deviationATR, vwap, price, atr14, reasons };
  }

  if (deviationATR > config.maxDeviationATR) {
    reasons.push(`Deviation ${deviationATR.toFixed(2)} ATR exceeds max ${config.maxDeviationATR} (trend day, don't fade)`);
    return { overextended: false, direction: null, deviationATR, vwap, price, atr14, reasons };
  }

  const direction = deviation > 0 ? "SHORT_FADE" as const : "LONG_FADE" as const;
  reasons.push(`Overextended ${deviationATR.toFixed(2)} ATR ${deviation > 0 ? "above" : "below"} VWAP`);

  return { overextended: true, direction, deviationATR, vwap, price, atr14, reasons };
}

export interface ExhaustionResult {
  exhausted: boolean;
  wickRatio: number;
  volumeDecline: boolean;
  volumeRatio: number;
  ema9Crossed: boolean;
  reasons: string[];
}

export function checkExhaustion(
  bars5m: Candle[],
  direction: "LONG_FADE" | "SHORT_FADE",
  config: VwapReversionConfig,
): ExhaustionResult {
  const reasons: string[] = [];

  if (bars5m.length < 5) {
    return { exhausted: false, wickRatio: 0, volumeDecline: false, volumeRatio: 1, ema9Crossed: false, reasons: ["Insufficient bars"] };
  }

  const lastBar = bars5m[bars5m.length - 1];
  const prevBar = bars5m[bars5m.length - 2];
  const range = lastBar.high - lastBar.low;

  let wickRatio = 0;
  if (range > 0) {
    if (direction === "SHORT_FADE") {
      const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
      wickRatio = upperWick / range;
    } else {
      const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;
      wickRatio = lowerWick / range;
    }
  }

  const hasWick = wickRatio >= config.exhaustionWickMinPct;
  if (hasWick) reasons.push(`Exhaustion wick ${(wickRatio * 100).toFixed(0)}%`);

  const avgVol3 = avgVolume(bars5m.slice(0, -1), 3);
  const volumeRatio = avgVol3 > 0 ? lastBar.volume / avgVol3 : 1;
  const volumeDecline = volumeRatio < config.exhaustionVolDeclinePct;
  if (volumeDecline) reasons.push(`Volume declining: ${(volumeRatio * 100).toFixed(0)}% of avg`);

  const closes = bars5m.map(b => b.close);
  const ema9 = lastEMA(closes, 9);
  let ema9Crossed = false;
  if (direction === "SHORT_FADE") {
    ema9Crossed = lastBar.close < ema9 && prevBar.close >= lastEMA(closes.slice(0, -1), 9);
  } else {
    ema9Crossed = lastBar.close > ema9 && prevBar.close <= lastEMA(closes.slice(0, -1), 9);
  }
  if (ema9Crossed) reasons.push("EMA9 crossed (reversal confirmation)");

  let failedExtreme = false;
  if (direction === "SHORT_FADE") {
    failedExtreme = lastBar.high < prevBar.high && lastBar.close < lastBar.open;
  } else {
    failedExtreme = lastBar.low > prevBar.low && lastBar.close > lastBar.open;
  }
  if (failedExtreme) reasons.push("Failed to make new extreme");

  let signals = 0;
  if (hasWick) signals++;
  if (volumeDecline) signals++;
  if (ema9Crossed) signals++;
  if (failedExtreme) signals++;

  const exhausted = signals >= 2;
  if (!exhausted && signals > 0) reasons.push(`Only ${signals}/2 exhaustion signals`);

  return { exhausted, wickRatio, volumeDecline, volumeRatio, ema9Crossed, reasons };
}

export interface ReversionEntryResult {
  entryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  riskPerShare: number;
  direction: "LONG_FADE" | "SHORT_FADE";
  deviationATR: number;
  vwap: number;
}

export function calculateReversionEntry(
  bar: Candle,
  vwap: number,
  atr14: number,
  direction: "LONG_FADE" | "SHORT_FADE",
  config: VwapReversionConfig,
): ReversionEntryResult {
  const entryPrice = bar.close;
  const distanceToVwap = Math.abs(entryPrice - vwap);

  let stopPrice: number;
  let target1Price: number;
  let target2Price: number;

  if (direction === "SHORT_FADE") {
    stopPrice = bar.high + atr14 * config.stopBufferATR;
    target1Price = entryPrice - distanceToVwap * config.target1ReversionPct;
    target2Price = entryPrice - distanceToVwap * config.target2ReversionPct;
  } else {
    stopPrice = bar.low - atr14 * config.stopBufferATR;
    target1Price = entryPrice + distanceToVwap * config.target1ReversionPct;
    target2Price = entryPrice + distanceToVwap * config.target2ReversionPct;
  }

  const riskPerShare = Math.abs(entryPrice - stopPrice);

  return {
    entryPrice,
    stopPrice,
    target1Price,
    target2Price,
    riskPerShare,
    direction,
    deviationATR: distanceToVwap / atr14,
    vwap,
  };
}
