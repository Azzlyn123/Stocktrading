import type { Candle, StrategyConfig, MarketRegimeResult } from "./types";
import { calculateVWAP, lastEMA, countVWAPCrosses } from "./indicators";

export function checkMarketRegime(
  spyBars5m: Candle[],
  config: StrategyConfig["marketRegime"]
): MarketRegimeResult {
  const reasons: string[] = [];

  if (spyBars5m.length < 5) {
    return {
      aligned: true,
      chopping: false,
      sizeMultiplier: 1.0,
      reasons: ["Insufficient SPY data - defaulting to aligned"],
      metrics: { spyAboveVwap: true, spyTrendAligned: true, vwapCrossCount: 0 },
    };
  }

  const vwap = calculateVWAP(spyBars5m);
  const lastClose = spyBars5m[spyBars5m.length - 1].close;
  const spyAboveVwap = lastClose > vwap;

  const closes = spyBars5m.map((c) => c.close);
  const ema9 = lastEMA(closes, 9);
  const ema20 = lastEMA(closes, 20);
  const spyTrendAligned = ema9 > ema20 && lastClose > ema9;

  const barsInWindow = Math.ceil(config.vwapCrossWindowMinutes / 5);
  const vwapCrossCount = countVWAPCrosses(spyBars5m, barsInWindow);
  const chopping = vwapCrossCount > config.maxVwapCrosses;

  const aligned = spyAboveVwap || spyTrendAligned;

  if (!spyAboveVwap) reasons.push("SPY below VWAP");
  if (!spyTrendAligned) reasons.push("SPY trend not aligned (EMA9 < EMA20)");
  if (chopping) reasons.push(`SPY chopping: ${vwapCrossCount} VWAP crosses in ${config.vwapCrossWindowMinutes}min`);

  let sizeMultiplier = 1.0;
  if (!aligned) sizeMultiplier = 0;
  if (chopping && aligned) sizeMultiplier = config.chopSizeReduction;

  return {
    aligned,
    chopping,
    sizeMultiplier,
    reasons,
    metrics: {
      spyAboveVwap,
      spyTrendAligned,
      vwapCrossCount,
    },
  };
}
