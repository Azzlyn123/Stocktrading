import type { Candle, StrategyConfig, BreakoutQualification } from "./types";
import { bodyPct, candleRange, avgVolume, avgRange } from "./indicators";

export function checkBreakoutQualification(
  candle: Candle,
  recentBars5m: Candle[],
  resistanceLevel: number,
  config: StrategyConfig["breakout"]
): BreakoutQualification {
  const reasons: string[] = [];

  const closedAbove = candle.close > resistanceLevel;
  if (!closedAbove) reasons.push("Candle did not close above resistance (wick only)");

  const bp = bodyPct(candle);
  const bodyOk = bp >= config.minBodyPct;
  if (!bodyOk) reasons.push(`Body% ${(bp * 100).toFixed(0)}% < ${(config.minBodyPct * 100).toFixed(0)}%`);

  const avg5mVol = avgVolume(recentBars5m, 20);
  const volMult = avg5mVol > 0 ? candle.volume / avg5mVol : 0;
  const volOk = volMult >= config.minVolumeMultiplier;
  if (!volOk) reasons.push(`Volume ${volMult.toFixed(1)}x < ${config.minVolumeMultiplier}x avg`);

  const cr = candleRange(candle);
  const avgR = avgRange(recentBars5m, 5);
  const rangeMult = avgR > 0 ? cr / avgR : 0;
  const rangeOk = rangeMult >= config.minRangeMultiplier;
  if (!rangeOk) reasons.push(`Range ${rangeMult.toFixed(1)}x < ${config.minRangeMultiplier}x avg`);

  return {
    qualified: closedAbove && bodyOk && volOk && rangeOk,
    reasons,
    metrics: {
      bodyPct: bp,
      volumeMultiplier: volMult,
      rangeMultiplier: rangeMult,
      closedAboveResistance: closedAbove,
    },
  };
}
