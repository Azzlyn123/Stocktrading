import type { Candle, StrategyConfig, RetestResult } from "./types";
import { calculateVWAP, isGreenCandle } from "./indicators";

export function checkRetestRules(
  currentCandle: Candle,
  breakoutCandle: Candle,
  retestBars: Candle[],
  breakoutLevel: number,
  bars5m: Candle[],
  config: StrategyConfig["retest"]
): RetestResult {
  const reasons: string[] = [];

  const breakoutRange = breakoutCandle.high - breakoutCandle.low;
  const pullbackFromHigh = breakoutCandle.high - currentCandle.low;
  const pullbackPct = breakoutRange > 0 ? (pullbackFromHigh / breakoutRange) * 100 : 0;
  const pullbackOk = pullbackPct <= config.maxPullbackPct;
  if (!pullbackOk) reasons.push(`Pullback ${pullbackPct.toFixed(0)}% > ${config.maxPullbackPct}% of breakout candle`);

  const toleranceAbs = breakoutLevel * (config.tolerancePct / 100);
  const holdsLevel = currentCandle.close >= breakoutLevel - toleranceAbs;
  if (!holdsLevel) reasons.push(`Price ${currentCandle.close.toFixed(2)} broke below level ${breakoutLevel.toFixed(2)} beyond ${config.tolerancePct}% tolerance`);

  const breakoutVol = breakoutCandle.volume;
  const retestAvgVol = retestBars.length > 0
    ? retestBars.reduce((s, c) => s + c.volume, 0) / retestBars.length
    : breakoutVol;
  const volumeContracting = retestAvgVol < breakoutVol;
  if (!volumeContracting) reasons.push("Retest volume not contracting vs breakout");

  const expandingBelow =
    !holdsLevel && currentCandle.volume > breakoutVol;
  if (expandingBelow) reasons.push("Volume expanding while breaking below level - disqualified");

  const valid = pullbackOk && holdsLevel && volumeContracting && !expandingBelow;

  let entryPrice: number | null = null;
  let stopPrice: number | null = null;

  if (valid) {
    const retestHigh = Math.max(...retestBars.map((c) => c.high), currentCandle.high);
    const retestLow = Math.min(...retestBars.map((c) => c.low), currentCandle.low);

    if (config.entryMode === "conservative") {
      entryPrice = retestHigh;
    } else {
      if (isGreenCandle(currentCandle)) {
        entryPrice = currentCandle.close;
      }
    }

    const vwap = calculateVWAP(bars5m);
    const vwapStop = vwap > 0 ? vwap : retestLow;
    const retestLowStop = retestLow - retestLow * 0.0005;

    stopPrice = Math.max(retestLowStop, vwapStop) < entryPrice!
      ? Math.max(retestLowStop, vwapStop)
      : retestLowStop;
  }

  return {
    valid,
    entryPrice,
    stopPrice,
    reasons,
    metrics: {
      pullbackPct,
      holdsLevel,
      volumeContracting,
      expandingBelowLevel: expandingBelow,
    },
  };
}
