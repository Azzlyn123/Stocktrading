import type { StrategyConfig, ExitDecision, Candle, TieredStrategyConfig } from "./types";
import { lastEMA, isRedCandle } from "./indicators";

export function checkExitRules(
  currentCandle: Candle,
  recentBars5m: Candle[],
  entryPrice: number,
  stopPrice: number,
  shares: number,
  isPartiallyExited: boolean,
  riskPerShare: number,
  minutesSinceEntry: number,
  config: StrategyConfig["exits"],
  riskConfig: StrategyConfig["risk"],
  riskMode: StrategyConfig["riskMode"],
  currentAtr: number
): ExitDecision {
  const currentPrice = currentCandle.close;
  const pnlR = riskPerShare > 0 ? (currentPrice - entryPrice) / riskPerShare : 0;

  // Mode-based targets
  let firstTP = config.partialAtR;
  let runnerTargetR = 2.5; // Balanced default

  if (riskMode === "conservative") {
    firstTP = 1.5;
    runnerTargetR = 2.0;
  } else if (riskMode === "balanced") {
    firstTP = 1.5;
    runnerTargetR = 2.5;
  } else if (riskMode === "aggressive") {
    firstTP = 1.25;
    runnerTargetR = 3.0;
  }

  // 1. Target Reached
  if (pnlR >= runnerTargetR) {
    return {
      shouldExit: true,
      exitType: "target",
      exitPrice: currentPrice,
      reason: `Final target reached at +${pnlR.toFixed(1)}R`,
      partialShares: null,
      newStopPrice: null,
    };
  }

  // 2. Partial Exit
  if (!isPartiallyExited && pnlR >= firstTP) {
    const partialShares = Math.floor(shares * (config.partialPct / 100));
    return {
      shouldExit: true,
      exitType: "partial",
      exitPrice: currentPrice,
      reason: `Partial exit at +${pnlR.toFixed(1)}R`,
      partialShares,
      newStopPrice: entryPrice, // Move to Breakeven
    };
  }

  // 3. Time Stop
  if (riskConfig.timeStopMinutes > 0 && minutesSinceEntry >= riskConfig.timeStopMinutes) {
    if (pnlR < riskConfig.timeStopR) {
      return {
        shouldExit: true,
        exitType: "time_stop",
        exitPrice: currentPrice,
        reason: `Time stop: ${minutesSinceEntry}min elapsed, only +${pnlR.toFixed(1)}R`,
        partialShares: null,
        newStopPrice: null,
      };
    }
  }

  // 4. Hard Stop
  if (currentPrice <= stopPrice) {
    return {
      shouldExit: true,
      exitType: "trailing_stop",
      exitPrice: stopPrice,
      reason: `Stop hit at $${stopPrice.toFixed(2)}`,
      partialShares: null,
      newStopPrice: null,
    };
  }

  // 5. 2 Red Candle Exit (if not aggressive or per config)
  if (config.hardExitRedCandles > 0 && recentBars5m.length >= config.hardExitRedCandles) {
    const lastN = recentBars5m.slice(-config.hardExitRedCandles);
    const allRed = lastN.every(isRedCandle);
    if (allRed && lastN.length >= 2) {
      const volumeIncreasing = lastN[lastN.length - 1].volume > lastN[lastN.length - 2].volume;
      if (volumeIncreasing) {
        return {
          shouldExit: true,
          exitType: "hard_exit",
          exitPrice: currentPrice,
          reason: `Hard exit: ${config.hardExitRedCandles} red candles with volume`,
          partialShares: null,
          newStopPrice: null,
        };
      }
    }
  }

  // 6. Trailing Stop
  let newTrailingStop: number | null = null;

  if (isPartiallyExited) {
    // Mode specific trailing
    if (riskMode === "aggressive" && pnlR >= firstTP) {
      const atrTrail = currentPrice - 2 * currentAtr;
      if (atrTrail > stopPrice) {
        newTrailingStop = atrTrail;
      }
    }

    if (config.useEMA9Trail && recentBars5m.length >= 9) {
      const closes = recentBars5m.map((c) => c.close);
      const ema9 = lastEMA(closes, 9);
      if (ema9 > stopPrice) {
        newTrailingStop = newTrailingStop ? Math.max(newTrailingStop, ema9) : ema9;
      }
    }

    if (config.usePriorLowTrail && recentBars5m.length >= 2) {
      const priorLow = recentBars5m[recentBars5m.length - 2].low;
      if (priorLow > stopPrice) {
        newTrailingStop = newTrailingStop ? Math.max(newTrailingStop, priorLow) : priorLow;
      }
    }
  }

  if (newTrailingStop && newTrailingStop > stopPrice) {
    return {
      shouldExit: false,
      exitType: null,
      exitPrice: null,
      reason: `Trailing stop raised to $${newTrailingStop.toFixed(2)}`,
      partialShares: null,
      newStopPrice: newTrailingStop,
    };
  }

  return {
    shouldExit: false,
    exitType: null,
    exitPrice: null,
    reason: "",
    partialShares: null,
    newStopPrice: null,
  };
}

export function checkTieredExitRules(
  currentCandle: Candle,
  recentBars5m: Candle[],
  entryPrice: number,
  stopPrice: number,
  shares: number,
  isPartiallyExited: boolean,
  riskPerShare: number,
  minutesSinceEntry: number,
  exitsConfig: TieredStrategyConfig["exits"],
  riskConfig: TieredStrategyConfig["risk"],
  currentAtr: number,
  breakoutLevel?: number,
  mfeR: number = 0,
  minutesSincePartial: number = 0
): ExitDecision {
  const currentPrice = currentCandle.close;
  const pnlR = riskPerShare > 0 ? (currentPrice - entryPrice) / riskPerShare : 0;

  if (pnlR >= exitsConfig.finalTargetR) {
    return {
      shouldExit: true,
      exitType: "target",
      exitPrice: currentPrice,
      reason: `Final target reached at +${pnlR.toFixed(1)}R (target ${exitsConfig.finalTargetR}R)`,
      partialShares: null,
      newStopPrice: null,
    };
  }

  if (!isPartiallyExited && pnlR >= exitsConfig.partialAtR) {
    const partialShares = Math.floor(shares * (exitsConfig.partialPct / 100));
    return {
      shouldExit: true,
      exitType: "partial",
      exitPrice: currentPrice,
      reason: `Partial exit at +${pnlR.toFixed(1)}R`,
      partialShares,
      newStopPrice: exitsConfig.moveStopToBE ? entryPrice + 0.05 * riskPerShare : null,
    };
  }

  if (exitsConfig.impulseFilterEnabled && !isPartiallyExited) {
    if (minutesSinceEntry >= 15 && mfeR < 0.10) {
      return {
        shouldExit: true,
        exitType: "hard_exit",
        exitPrice: currentPrice,
        reason: `Impulse fail: MFE only +${mfeR.toFixed(2)}R at ${minutesSinceEntry}min (need +0.10R by 15min)`,
        partialShares: null,
        newStopPrice: null,
      };
    }
  }

  if (exitsConfig.stopTightenAt15min && !isPartiallyExited) {
    if (minutesSinceEntry >= 15 && mfeR < 0.10) {
      const tightenedStop = entryPrice - 0.05 * riskPerShare;
      if (tightenedStop > stopPrice) {
        return {
          shouldExit: false,
          exitType: null,
          exitPrice: null,
          reason: `15min tighten: MFE +${mfeR.toFixed(2)}R < 0.10R → stop to entry-0.05R ($${tightenedStop.toFixed(2)})`,
          partialShares: null,
          newStopPrice: tightenedStop,
        };
      }
    }
  }

  if (riskConfig.timeStopMinutes > 0 && minutesSinceEntry >= riskConfig.timeStopMinutes) {
    if (pnlR < riskConfig.timeStopR) {
      return {
        shouldExit: true,
        exitType: "time_stop",
        exitPrice: currentPrice,
        reason: `Time stop: ${minutesSinceEntry}min elapsed, only +${pnlR.toFixed(1)}R < ${riskConfig.timeStopR}R`,
        partialShares: null,
        newStopPrice: null,
      };
    }
  }

  if (currentPrice <= stopPrice) {
    return {
      shouldExit: true,
      exitType: "stop_loss",
      exitPrice: stopPrice,
      reason: `Stop hit at $${stopPrice.toFixed(2)}`,
      partialShares: null,
      newStopPrice: null,
    };
  }

  if (
    exitsConfig.earlyFailureExit &&
    !isPartiallyExited &&
    minutesSinceEntry >= 15 &&
    pnlR <= -0.15 &&
    pnlR > -0.45 &&
    recentBars5m.length >= 9
  ) {
    const closes = recentBars5m.map((c) => c.close);
    const ema9 = lastEMA(closes, 9);
    const n = recentBars5m.length;
    const prev = n >= 2 ? recentBars5m[n - 2] : null;

    if (ema9 > 0 && currentPrice < ema9) {
      const twoBelowEMA9 = prev != null && prev.close < ema9 && currentPrice < ema9;
      const levelFail =
        breakoutLevel != null &&
        riskPerShare > 0 &&
        currentPrice < breakoutLevel - 0.10 * riskPerShare;
      const levelFail_strict =
        breakoutLevel != null &&
        riskPerShare > 0 &&
        currentPrice < breakoutLevel - 0.15 * riskPerShare;

      let confirmFail: boolean;
      if (mfeR >= 0.20) {
        confirmFail = twoBelowEMA9 && (breakoutLevel == null || levelFail_strict);
      } else {
        confirmFail = twoBelowEMA9 && (breakoutLevel == null || levelFail);
      }

      if (confirmFail) {
        const levelNote = (mfeR >= 0.20 ? levelFail_strict : levelFail) ? ", level break" : "";
        return {
          shouldExit: true,
          exitType: "hard_exit",
          exitPrice: currentPrice,
          reason: `Early failure: 2 closes below EMA9 ($${ema9.toFixed(2)})${levelNote}, MFE was +${mfeR.toFixed(2)}R, pnl ${pnlR.toFixed(2)}R`,
          partialShares: null,
          newStopPrice: null,
        };
      }
    }
  }

  if (mfeR >= 0.35 && pnlR <= 0.05 && recentBars5m.length >= 9) {
    const ema9Giveback = lastEMA(recentBars5m.map(c => c.close), 9);
    if (currentPrice < ema9Giveback) {
      return {
        shouldExit: true,
        exitType: "hard_exit",
        exitPrice: currentPrice,
        reason: `Giveback exit: MFE was +${mfeR.toFixed(2)}R, now at +${pnlR.toFixed(2)}R below EMA9`,
        partialShares: null,
        newStopPrice: null,
      };
    }
  }

  if (recentBars5m.length >= 5) {
    const lookback = recentBars5m.slice(-10);
    const swingLows: number[] = [];
    for (let i = 1; i < lookback.length - 1; i++) {
      if (lookback[i].low < lookback[i - 1].low && lookback[i].low < lookback[i + 1].low) {
        swingLows.push(lookback[i].low);
      }
    }
    if (swingLows.length > 0) {
      const recentSwingLow = swingLows[swingLows.length - 1];
      const bufferPrice = riskPerShare > 0 ? 0.10 * riskPerShare : 0;
      const bufferedSwingLow = recentSwingLow - bufferPrice;
      const ema9Struct = lastEMA(recentBars5m.map(c => c.close), 9);
      const prevBar = recentBars5m.length >= 2 ? recentBars5m[recentBars5m.length - 2] : null;
      const belowBuffered = currentPrice < bufferedSwingLow;
      const prevBelowBuffered = prevBar != null && prevBar.close < bufferedSwingLow;
      const belowEMA9 = currentPrice < ema9Struct;
      if (belowBuffered && prevBelowBuffered && belowEMA9) {
        return {
          shouldExit: true,
          exitType: "hard_exit",
          exitPrice: currentPrice,
          reason: `Structure break: 2-bar close below swing low $${recentSwingLow.toFixed(2)} (buffer 0.10R) and EMA9`,
          partialShares: null,
          newStopPrice: null,
        };
      }
    }
  }

  if (exitsConfig.hardExitRedCandles > 0 && recentBars5m.length >= exitsConfig.hardExitRedCandles) {
    const lastN = recentBars5m.slice(-exitsConfig.hardExitRedCandles);
    const allRed = lastN.every(isRedCandle);
    if (allRed && lastN.length >= 2) {
      const volumeIncreasing = lastN[lastN.length - 1].volume > lastN[lastN.length - 2].volume;
      if (volumeIncreasing) {
        return {
          shouldExit: true,
          exitType: "hard_exit",
          exitPrice: currentPrice,
          reason: `Hard exit: ${exitsConfig.hardExitRedCandles} red candles with increasing volume`,
          partialShares: null,
          newStopPrice: null,
        };
      }
    }
  }

  if (minutesSinceEntry >= 30 && mfeR >= 0.20 && pnlR < 0.20) {
    const stalledStop = entryPrice - 0.10 * riskPerShare;
    if (riskPerShare > 0 && stalledStop > stopPrice) {
      return {
        shouldExit: false,
        exitType: null,
        exitPrice: null,
        reason: `Stall tighten at ${minutesSinceEntry}min: MFE +${mfeR.toFixed(2)}R, stop moved to entry-0.10R`,
        partialShares: null,
        newStopPrice: stalledStop,
      };
    }
  }

  if (isPartiallyExited) {
    if (minutesSincePartial >= 15 && recentBars5m.length >= 2) {
      const bar1Low = recentBars5m[recentBars5m.length - 1].low;
      const bar2Low = recentBars5m[recentBars5m.length - 2].low;
      const twoBarLow = Math.min(bar1Low, bar2Low);
      if (twoBarLow > stopPrice) {
        return {
          shouldExit: false,
          exitType: null,
          exitPrice: null,
          reason: `Runner 2-bar low trail: stop raised to $${twoBarLow.toFixed(2)}`,
          partialShares: null,
          newStopPrice: twoBarLow,
        };
      }
    }
    // minutesSincePartial < 15: breathing window — stop stays at BE+0.05R (set at T1), no trailing
  }

  return {
    shouldExit: false,
    exitType: null,
    exitPrice: null,
    reason: "",
    partialShares: null,
    newStopPrice: null,
  };
}
