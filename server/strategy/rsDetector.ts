import type { Candle } from "./types";
import { calculateATR, calculateVWAP } from "./indicators";

export interface RSConfig {
  minRSThreshold: number;      // Minimum RS to consider "Strong"
  spyVwapFilter: boolean;      // Ticker > VWAP while SPY < VWAP
  rsLookbackBars: number;      // Lookback for RS calculation (e.g. 6 bars for 30m)
  rsSlopeLookback: number;     // Lookback for slope (e.g. 3 bars for 15m)
  bhodBufferPct: number;       // Buffer above HOD for break
  targetMultiple: number;
  stopBufferPct: number;
  riskPct: number;
  maxTradesPerTicker: number;
  timeExitMinutes: number;
  noTarget?: boolean;          // Variant 2: Let winners run (no hard target)
  noPartial?: boolean;         // Variant 3: No partial at 1R, just trail
}

export const DEFAULT_RS_CONFIG: RSConfig = {
  minRSThreshold: 0.001,      // 0.1% relative strength
  spyVwapFilter: true,
  rsLookbackBars: 6,           // 30 mins at 5m bars
  rsSlopeLookback: 3,          // 15 mins
  bhodBufferPct: 0.0005,       // 0.05% above HOD
  targetMultiple: 2.0,
  stopBufferPct: 0.001,
  riskPct: 0.005,
  maxTradesPerTicker: 2,
  timeExitMinutes: 375,
};

export function computeRS(tickerBars: Candle[], spyBars: Candle[], index: number, lookback: number): number {
  if (index < lookback || tickerBars.length <= index || spyBars.length <= index) return 0;
  
  const startIdx = index - lookback;
  if (startIdx < 0 || !tickerBars[startIdx] || !spyBars[startIdx] || !tickerBars[index] || !spyBars[index]) return 0;
  
  const tickerStart = tickerBars[startIdx].close;
  const tickerEnd = tickerBars[index].close;
  const spyStart = spyBars[startIdx].close;
  const spyEnd = spyBars[index].close;
  
  if (tickerStart === 0 || spyStart === 0) return 0;
  
  const tickerRet = (tickerEnd - tickerStart) / tickerStart;
  const spyRet = (spyEnd - spyStart) / spyStart;
  
  return tickerRet - spyRet;
}

export interface RSContinuationSignal {
  triggered: boolean;
  direction: "LONG" | null;
  rsValue: number;
  rsSlope: number;
  reasons: string[];
}

export function detectRSContinuation(
  tickerBars: Candle[],
  spyBars: Candle[],
  index: number,
  config: RSConfig,
  hod: number,
): RSContinuationSignal {
  const reasons: string[] = [];
  const bar = tickerBars[index];
  const spyBar = spyBars[index];

  if (!bar || !spyBar) return { triggered: false, direction: null, rsValue: 0, rsSlope: 0, reasons };
  if (index < config.rsLookbackBars) return { triggered: false, direction: null, rsValue: 0, rsSlope: 0, reasons };

  // 1. VWAP Filters
  const vwap = calculateVWAP(tickerBars.slice(0, index + 1));
  const spyVwap = calculateVWAP(spyBars.slice(0, index + 1));
  
  if (bar.close < vwap) return { triggered: false, direction: null, rsValue: 0, rsSlope: 0, reasons };
  
  const rs = computeRS(tickerBars, spyBars, index, config.rsLookbackBars);
  const rsPrior = computeRS(tickerBars, spyBars, index - config.rsSlopeLookback, config.rsLookbackBars);
  const rsSlope = rs - rsPrior;

  if (rs < config.minRSThreshold) return { triggered: false, direction: null, rsValue: rs, rsSlope, reasons };
  if (rsSlope <= 0) return { triggered: false, direction: null, rsValue: rs, rsSlope, reasons };

  if (config.spyVwapFilter && spyBar && spyBar.close > spyVwap) {
    return { triggered: false, direction: null, rsValue: rs, rsSlope, reasons: ["SPY above VWAP — no institutional divergence"] };
  }

  const bhodLevel = hod * (1 + config.bhodBufferPct);
  if (bar.high >= bhodLevel) {
    reasons.push(`RS confirmed: ${rs.toFixed(4)}, Slope: ${rsSlope.toFixed(4)}`);
    reasons.push(`Break of HOD (${hod.toFixed(2)}) confirmed`);
    reasons.push(`Institutional Flow: Ticker > VWAP while SPY < VWAP`);
    
    return {
      triggered: true,
      direction: "LONG",
      rsValue: rs,
      rsSlope,
      reasons
    };
  }

  return { triggered: false, direction: null, rsValue: rs, rsSlope, reasons };
}
