import type { Candle, StrategyConfig, MarketRegimeResult } from "./types";
import { calculateVWAP, lastEMA, countVWAPCrosses, vwapSlope } from "./indicators";

export function checkMarketRegime(
  spyBars5m: Candle[],
  config: StrategyConfig["marketRegime"]
): MarketRegimeResult {
  const reasons: string[] = [];

  if (spyBars5m.length < 5) {
    return {
      aligned: true,
      chopping: false,
      expanding: false,
      sizeMultiplier: 1.0,
      reasons: ["Insufficient SPY data - defaulting to aligned"],
      metrics: { spyAboveVwap: true, spyTrendAligned: true, vwapCrossCount: 0, vwapSlopePositive: false, expandingDetails: "insufficient data" },
    };
  }

  const vwap = calculateVWAP(spyBars5m);
  const lastClose = spyBars5m[spyBars5m.length - 1].close;
  const spyAboveVwap = lastClose > vwap;

  const closes = spyBars5m.map((c) => c.close);
  const ema9 = lastEMA(closes, 9);
  const ema21 = lastEMA(closes, 21);
  const spyTrendAligned = ema9 > ema21 && lastClose > ema9;

  const slopePct = vwapSlope(spyBars5m, 5);
  const vwapSlopePositive = slopePct > 0;

  const expanding = spyAboveVwap && vwapSlopePositive && spyTrendAligned;

  const barsInWindow = Math.ceil(config.vwapCrossWindowMinutes / 5);
  const vwapCrossCount = countVWAPCrosses(spyBars5m, barsInWindow);
  const chopping = vwapCrossCount > config.maxVwapCrosses;

  const aligned = spyAboveVwap || spyTrendAligned;

  if (!spyAboveVwap) reasons.push("SPY below VWAP");
  if (!spyTrendAligned) reasons.push("SPY trend not aligned (EMA9 < EMA21)");
  if (!vwapSlopePositive) reasons.push(`SPY VWAP slope negative (${(slopePct * 10000).toFixed(1)}bps)`);
  if (chopping) reasons.push(`SPY chopping: ${vwapCrossCount} VWAP crosses in ${config.vwapCrossWindowMinutes}min`);
  if (expanding) reasons.push("SPY expanding: above VWAP + positive slope + EMA9>EMA21");

  let sizeMultiplier = 1.0;
  if (!aligned) sizeMultiplier = 0;
  if (chopping && aligned) sizeMultiplier = config.chopSizeReduction;

  return {
    aligned,
    chopping,
    expanding,
    sizeMultiplier,
    reasons,
    metrics: {
      spyAboveVwap,
      spyTrendAligned,
      vwapCrossCount,
      vwapSlopePositive,
      expandingDetails: `aboveVWAP=${spyAboveVwap} slope=${(slopePct * 10000).toFixed(1)}bps ema9>ema21=${spyTrendAligned}`,
    },
  };
}
