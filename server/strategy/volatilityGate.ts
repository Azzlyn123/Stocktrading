import type { Candle, StrategyConfig, VolatilityGateResult } from "./types";
import { calculateATR, firstNMinutesRange } from "./indicators";

export function checkVolatilityGate(
  todayBars5m: Candle[],
  yesterdayFullRange: number,
  dailyATRbaseline: number,
  config: StrategyConfig["volatilityGate"]
): VolatilityGateResult {
  const reasons: string[] = [];

  const first30mRange = firstNMinutesRange(todayBars5m, 30, 5);
  const firstRangePct = yesterdayFullRange > 0
    ? (first30mRange / yesterdayFullRange) * 100
    : 100;
  const firstRangeOk = firstRangePct >= config.firstRangeMinPct;

  const intradayATR = calculateATR(todayBars5m, 14);
  const atrRatio = dailyATRbaseline > 0
    ? intradayATR / dailyATRbaseline
    : 1;
  const atrOk = atrRatio > config.atrExpansionMultiplier;

  const passes = firstRangeOk || atrOk;

  if (!firstRangeOk) reasons.push(`First 30m range ${firstRangePct.toFixed(0)}% < ${config.firstRangeMinPct}% of yesterday`);
  if (!atrOk) reasons.push(`Intraday ATR ${atrRatio.toFixed(1)}x < ${config.atrExpansionMultiplier}x baseline`);
  if (!passes) reasons.push("Neither volatility condition met");

  return {
    passes,
    reasons,
    metrics: {
      firstRangePctOfYesterday: firstRangePct,
      intradayATRvsBaseline: atrRatio,
    },
  };
}
