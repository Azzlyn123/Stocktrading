import type { Candle, StrategyConfig, BreakoutQualification, TierConfig, TieredStrategyConfig } from "./types";
import { bodyPct, candleRange, avgVolume, avgRange, calculateATR, calculateEMA } from "./indicators";

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

export function checkTieredBreakout(
  currentCandle: Candle,
  recentBars: Candle[],
  levelPrice: number,
  levelType: "RESISTANCE" | "SUPPORT",
  tier: TierConfig,
  strategyConfig: TieredStrategyConfig["strategy"]
): BreakoutQualification {
  const reasons: string[] = [];
  const isLong = levelType === "RESISTANCE";

  const closePctFromLevel = isLong
    ? (currentCandle.close - levelPrice) / levelPrice
    : (levelPrice - currentCandle.close) / levelPrice;
  const closedBeyond = closePctFromLevel >= strategyConfig.minBreakoutClosePct;
  if (!closedBeyond) {
    reasons.push(
      `Close ${isLong ? "above" : "below"} level by ${(closePctFromLevel * 100).toFixed(3)}% < ${(strategyConfig.minBreakoutClosePct * 100).toFixed(3)}% required`
    );
  }

  const bp = bodyPct(currentCandle);
  const bodyOk = bp >= strategyConfig.minBodyPct;
  if (!bodyOk) {
    reasons.push(`Body% ${(bp * 100).toFixed(0)}% < ${(strategyConfig.minBodyPct * 100).toFixed(0)}%`);
  }

  const avgVol = avgVolume(recentBars, strategyConfig.volumeLookback);
  const volRatio = avgVol > 0 ? currentCandle.volume / avgVol : 0;
  const volOk = volRatio >= tier.volumeRatioMin;
  if (!volOk) {
    reasons.push(`Volume ratio ${volRatio.toFixed(2)} < ${tier.volumeRatioMin} required`);
  }

  let atrOk = true;
  let atrRatio = 0;
  if (tier.atrRatioMin > 0) {
    const currentAtr = calculateATR(recentBars, strategyConfig.atrLen);
    const atrValues: number[] = [];
    for (let i = strategyConfig.atrLen + 1; i <= recentBars.length; i++) {
      atrValues.push(calculateATR(recentBars.slice(0, i), strategyConfig.atrLen));
    }
    const atrMa =
      atrValues.length >= strategyConfig.atrMaLen
        ? atrValues.slice(-strategyConfig.atrMaLen).reduce((a, b) => a + b, 0) / strategyConfig.atrMaLen
        : atrValues.length > 0
          ? atrValues.reduce((a, b) => a + b, 0) / atrValues.length
          : currentAtr;
    atrRatio = atrMa > 0 ? currentAtr / atrMa : 0;
    atrOk = atrRatio >= tier.atrRatioMin;
    if (!atrOk) {
      reasons.push(`ATR ratio ${atrRatio.toFixed(2)} < ${tier.atrRatioMin} required`);
    }
  }

  return {
    qualified: closedBeyond && bodyOk && volOk && atrOk,
    reasons,
    metrics: {
      bodyPct: bp,
      volumeMultiplier: volRatio,
      rangeMultiplier: atrRatio,
      closedAboveResistance: isLong ? closedBeyond : false,
    },
  };
}
