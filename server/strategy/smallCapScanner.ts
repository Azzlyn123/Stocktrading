import { type Candle } from "./types";

export interface SmallCapConfig {
  minPrice: number;
  maxPrice: number;
  maxFloat: number;
  minPremarketVolume: number;
  minGapPct: number;
  minAtrPct: number;
  minAvgVolume: number;
  minDollarVolume: number;
  maxSpreadPct: number;
  riskPct: number;
  maxTradesPerTicker: number;
  partialExitR: number;
  partialExitPct: number;
  trailActivationR: number;
  trailOffsetR: number;
  timeExitMinutes: number;
}

export const DEFAULT_SMALLCAP_CONFIG: SmallCapConfig = {
  minPrice: 2.0,
  maxPrice: 20.0,
  maxFloat: 50_000_000,
  minPremarketVolume: 500_000,
  minGapPct: 0.05,
  minAtrPct: 0.08,
  minAvgVolume: 200_000,
  minDollarVolume: 2_000_000,
  maxSpreadPct: 0.015,
  riskPct: 0.005,
  maxTradesPerTicker: 1,
  partialExitR: 2.0,
  partialExitPct: 0.5,
  trailActivationR: 2.0,
  trailOffsetR: 0.75,
  timeExitMinutes: 375,
};

export interface SmallCapQualification {
  passed: boolean;
  ticker: string;
  gapPct: number;
  gapDirection: "LONG" | "SHORT";
  priorClose: number;
  openPrice: number;
  atrPct: number;
  premarketVolume: number;
  avgVolume: number;
  floatShares: number;
  rejectReason: string | null;
}

export function qualifySmallCapGapper(
  ticker: string,
  priorClose: number,
  todayOpen: number,
  atr14: number,
  premarketVolume: number,
  avgDailyVolume: number,
  floatShares: number,
  config: SmallCapConfig,
): SmallCapQualification {
  const base: Omit<SmallCapQualification, "passed" | "rejectReason"> = {
    ticker,
    gapPct: priorClose > 0 ? (todayOpen - priorClose) / priorClose : 0,
    gapDirection: todayOpen >= priorClose ? "LONG" : "SHORT",
    priorClose,
    openPrice: todayOpen,
    atrPct: priorClose > 0 ? atr14 / priorClose : 0,
    premarketVolume,
    avgVolume: avgDailyVolume,
    floatShares,
  };

  if (priorClose < config.minPrice || priorClose > config.maxPrice) {
    return { ...base, passed: false, rejectReason: `price $${priorClose.toFixed(2)} outside $${config.minPrice}-$${config.maxPrice}` };
  }

  if (todayOpen < config.minPrice || todayOpen > config.maxPrice) {
    return { ...base, passed: false, rejectReason: `open $${todayOpen.toFixed(2)} outside $${config.minPrice}-$${config.maxPrice}` };
  }

  const absGapPct = Math.abs(base.gapPct);
  if (absGapPct < config.minGapPct) {
    return { ...base, passed: false, rejectReason: `gap ${(absGapPct * 100).toFixed(1)}% < ${(config.minGapPct * 100).toFixed(0)}%` };
  }

  if (base.atrPct < config.minAtrPct) {
    return { ...base, passed: false, rejectReason: `ATR% ${(base.atrPct * 100).toFixed(1)}% < ${(config.minAtrPct * 100).toFixed(0)}%` };
  }

  if (premarketVolume < config.minPremarketVolume) {
    return { ...base, passed: false, rejectReason: `premarket vol ${premarketVolume.toLocaleString()} < ${config.minPremarketVolume.toLocaleString()}` };
  }

  if (avgDailyVolume > 0 && avgDailyVolume < config.minAvgVolume) {
    return { ...base, passed: false, rejectReason: `avg vol ${avgDailyVolume.toLocaleString()} < ${config.minAvgVolume.toLocaleString()}` };
  }

  if (config.minDollarVolume > 0 && priorClose > 0 && avgDailyVolume > 0) {
    const dollarVol = priorClose * avgDailyVolume;
    if (dollarVol < config.minDollarVolume) {
      return { ...base, passed: false, rejectReason: `dollar vol $${(dollarVol / 1e6).toFixed(1)}M < $${(config.minDollarVolume / 1e6).toFixed(0)}M` };
    }
  }

  if (floatShares > 0 && floatShares > config.maxFloat) {
    return { ...base, passed: false, rejectReason: `float ${(floatShares / 1e6).toFixed(1)}M > ${(config.maxFloat / 1e6).toFixed(0)}M` };
  }

  return { ...base, passed: true, rejectReason: null };
}

export function computeATRFromDailyBars(
  dailyBars: Array<{ high: number; low: number; close: number }>,
  period: number = 14,
): number {
  if (dailyBars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < dailyBars.length; i++) {
    const prevClose = dailyBars[i - 1].close;
    const high = dailyBars[i].high;
    const low = dailyBars[i].low;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const len = Math.min(period, trs.length);
  const slice = trs.slice(-len);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

export function computeAvgDailyVolume(
  dailyBars: Array<{ volume: number }>,
  lookback: number = 20,
): number {
  if (dailyBars.length === 0) return 0;
  const len = Math.min(lookback, dailyBars.length);
  const slice = dailyBars.slice(-len);
  return slice.reduce((s, d) => s + d.volume, 0) / slice.length;
}
