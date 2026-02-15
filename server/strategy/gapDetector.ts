import { type Candle } from "./types";

export interface GapConfig {
  minGapPct: number;
  minRvol: number;
  orMinutes: number;
  riskPct: number;
  maxTradesPerTicker: number;
  timeExitMinutes: number;
  variantB_maxHoldDays: number;
}

export const DEFAULT_GAP_CONFIG: GapConfig = {
  minGapPct: 0.015,
  minRvol: 1.5,
  orMinutes: 30,
  riskPct: 0.005,
  maxTradesPerTicker: 1,
  timeExitMinutes: 375,
  variantB_maxHoldDays: 3,
};

export interface GapSignal {
  hasGap: boolean;
  direction: "LONG" | "SHORT" | null;
  gapPct: number;
  priorClose: number;
  openPrice: number;
  rvolAtOpen: number;
}

export interface OpeningRange {
  high: number;
  low: number;
  range: number;
  completed: boolean;
  barsUsed: number;
}

/**
 * Detect if there is a gap from prior close to today's open
 * @param priorClose Previous day's closing price
 * @param todayOpen Today's opening price
 * @param config Gap configuration
 * @returns GapSignal with gap detection results
 */
export function detectGap(
  priorClose: number,
  todayOpen: number,
  config: GapConfig,
): GapSignal {
  if (priorClose === 0) {
    return {
      hasGap: false,
      direction: null,
      gapPct: 0,
      priorClose,
      openPrice: todayOpen,
      rvolAtOpen: 0,
    };
  }

  const gapPct = (todayOpen - priorClose) / priorClose;
  const absGapPct = Math.abs(gapPct);
  const hasGap = absGapPct >= config.minGapPct;
  
  let direction: "LONG" | "SHORT" | null = null;
  if (hasGap) {
    direction = gapPct > 0 ? "LONG" : "SHORT";
  }

  return {
    hasGap,
    direction,
    gapPct,
    priorClose,
    openPrice: todayOpen,
    rvolAtOpen: 0,
  };
}

/**
 * Check if relative volume meets minimum threshold
 * @param todayFirst5mVolume Volume during today's first 5 minutes
 * @param avgFirst5mVolume Average volume during first 5 minutes over lookback period
 * @param minRvol Minimum RVOL required
 * @returns Object with RVOL check result
 */
export function checkRVOL(
  todayFirst5mVolume: number,
  avgFirst5mVolume: number,
  minRvol: number,
): { passed: boolean; rvol: number } {
  if (avgFirst5mVolume === 0) {
    return { passed: false, rvol: 0 };
  }

  const rvol = todayFirst5mVolume / avgFirst5mVolume;
  const passed = rvol >= minRvol;

  return { passed, rvol };
}

/**
 * Build the opening range from the first N minutes of trading
 * @param bars5m Array of 5-minute bars starting from market open (9:30 ET)
 * @param orMinutes Duration of opening range in minutes (e.g., 30 for 30-minute OR)
 * @returns OpeningRange with high, low, range, and completion status
 */
export function buildOpeningRange(
  bars5m: Array<{ high: number; low: number; timestamp: number }>,
  orMinutes: number,
): OpeningRange {
  const barsNeeded = Math.ceil(orMinutes / 5);
  const barsAvailable = Math.min(barsNeeded, bars5m.length);

  if (barsAvailable === 0) {
    return {
      high: 0,
      low: 0,
      range: 0,
      completed: false,
      barsUsed: 0,
    };
  }

  let high = -Infinity;
  let low = Infinity;

  for (let i = 0; i < barsAvailable; i++) {
    const bar = bars5m[i];
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
  }

  const completed = barsAvailable >= barsNeeded;
  const range = high > -Infinity && low < Infinity ? high - low : 0;

  return {
    high: high > -Infinity ? high : 0,
    low: low < Infinity ? low : 0,
    range,
    completed,
    barsUsed: barsAvailable,
  };
}

/**
 * Detect if a bar breaks out of the opening range
 * @param bar Current bar with high, low, close
 * @param or Opening range object
 * @param gapDirection Direction of the gap (LONG for gap up, SHORT for gap down)
 * @returns Object indicating if breakout is triggered and the breakout price
 */
export function detectORBreakout(
  bar: { high: number; low: number; close: number },
  or: OpeningRange,
  gapDirection: "LONG" | "SHORT",
): { triggered: boolean; breakoutPrice: number } {
  if (gapDirection === "LONG") {
    const triggered = bar.high > or.high;
    return {
      triggered,
      breakoutPrice: or.high,
    };
  } else {
    // SHORT
    const triggered = bar.low < or.low;
    return {
      triggered,
      breakoutPrice: or.low,
    };
  }
}
