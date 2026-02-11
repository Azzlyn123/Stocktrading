import type { Candle, StrategyConfig, RetestResult, TierConfig } from "./types";
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

export function checkTieredRetest(
  currentCandle: Candle,
  breakoutCandle: Candle,
  retestBars: Candle[],
  levelPrice: number,
  levelType: "RESISTANCE" | "SUPPORT",
  bars5m: Candle[],
  tier: TierConfig,
  direction: "LONG" | "SHORT"
): RetestResult {
  const reasons: string[] = [];
  const isLong = direction === "LONG";

  const withinTolerance = (price: number): boolean =>
    Math.abs(price - levelPrice) / levelPrice <= tier.tolerancePct;

  const currentWithinTolerance = withinTolerance(currentCandle.close);
  let retestTouched = currentWithinTolerance;
  if (!retestTouched) {
    for (const bar of retestBars) {
      if (withinTolerance(bar.close) || withinTolerance(bar.low) || withinTolerance(bar.high)) {
        retestTouched = true;
        break;
      }
    }
  }
  if (!retestTouched) {
    reasons.push("Price never returned to within tolerance of level");
  }

  let closesAgainst = 0;
  for (const bar of retestBars) {
    if (withinTolerance(bar.close)) {
      if (isLong && bar.close < levelPrice) closesAgainst++;
      if (!isLong && bar.close > levelPrice) closesAgainst++;
    }
  }
  if (withinTolerance(currentCandle.close)) {
    if (isLong && currentCandle.close < levelPrice) closesAgainst++;
    if (!isLong && currentCandle.close > levelPrice) closesAgainst++;
  }
  const closesAgainstOk = closesAgainst <= tier.maxClosesAgainstLevel;
  if (!closesAgainstOk) {
    reasons.push(`${closesAgainst} closes against direction > max ${tier.maxClosesAgainstLevel}`);
  }

  let invalidated = false;
  if (isLong && currentCandle.close < levelPrice * (1 - tier.tolerancePct)) {
    invalidated = true;
    reasons.push(`LONG invalidated: close ${currentCandle.close.toFixed(2)} < level ${levelPrice.toFixed(2)} beyond tolerance`);
  }
  if (!isLong && currentCandle.close > levelPrice * (1 + tier.tolerancePct)) {
    invalidated = true;
    reasons.push(`SHORT invalidated: close ${currentCandle.close.toFixed(2)} > level ${levelPrice.toFixed(2)} beyond tolerance`);
  }
  for (const bar of retestBars) {
    if (isLong && bar.close < levelPrice * (1 - tier.tolerancePct)) {
      invalidated = true;
      reasons.push(`LONG invalidated during retest: bar close ${bar.close.toFixed(2)} broke below tolerance`);
      break;
    }
    if (!isLong && bar.close > levelPrice * (1 + tier.tolerancePct)) {
      invalidated = true;
      reasons.push(`SHORT invalidated during retest: bar close ${bar.close.toFixed(2)} broke above tolerance`);
      break;
    }
  }

  const valid = retestTouched && closesAgainstOk && !invalidated;

  let entryPrice: number | null = null;
  let stopPrice: number | null = null;

  if (valid) {
    const isConfirmation = isLong
      ? currentCandle.close > levelPrice && withinTolerance(currentCandle.low)
      : currentCandle.close < levelPrice && withinTolerance(currentCandle.high);

    if (isConfirmation || isGreenCandle(currentCandle) === isLong) {
      entryPrice = isLong ? currentCandle.high : currentCandle.low;
    }

    const allRetestBars = [...retestBars, currentCandle];
    const swingLow = Math.min(...allRetestBars.map((c) => c.low));
    const swingHigh = Math.max(...allRetestBars.map((c) => c.high));

    if (isLong) {
      const levelStop = levelPrice * (1 - tier.stopBufferPct);
      stopPrice = Math.min(swingLow, levelStop);
    } else {
      const levelStop = levelPrice * (1 + tier.stopBufferPct);
      stopPrice = Math.max(swingHigh, levelStop);
    }
  }

  const breakoutRange = breakoutCandle.high - breakoutCandle.low;
  const pullbackFromHigh = breakoutCandle.high - currentCandle.low;
  const pullbackPct = breakoutRange > 0 ? (pullbackFromHigh / breakoutRange) * 100 : 0;

  return {
    valid,
    entryPrice,
    stopPrice,
    reasons,
    metrics: {
      pullbackPct,
      holdsLevel: !invalidated,
      volumeContracting: true,
      expandingBelowLevel: false,
    },
  };
}
