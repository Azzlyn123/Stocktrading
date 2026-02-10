import type { Candle, StrategyConfig, HigherTimeframeBiasResult } from "./types";
import { calculateVWAP, lastEMA } from "./indicators";

export function checkHigherTimeframeBias(
  bars15m: Candle[],
  prevDayHigh: number,
  premarketHigh: number,
  currentPrice: number,
  config: StrategyConfig["higherTimeframe"]
): HigherTimeframeBiasResult {
  const vwap = calculateVWAP(bars15m);
  const aboveVWAP = currentPrice > vwap;

  const closes15m = bars15m.map((c) => c.close);
  const ema9 = lastEMA(closes15m, 9);
  const ema20 = lastEMA(closes15m, 20);
  const ema9AboveEma20 = ema9 > ema20;

  const breakingDayHigh =
    currentPrice > prevDayHigh || currentPrice > premarketHigh;

  const confirmations = [aboveVWAP, ema9AboveEma20, breakingDayHigh].filter(
    Boolean
  ).length;

  return {
    aligned: confirmations >= config.requiredConfirmations,
    confirmations,
    details: {
      aboveVWAP,
      ema9AboveEma20,
      breakingDayHigh,
    },
  };
}
