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
  currentAtr: number
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
      newStopPrice: exitsConfig.moveStopToBE ? entryPrice : null,
    };
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

  let newTrailingStop: number | null = null;

  if (isPartiallyExited) {
    if (exitsConfig.useEMA9Trail && recentBars5m.length >= 9) {
      const closes = recentBars5m.map((c) => c.close);
      const ema9 = lastEMA(closes, 9);
      if (ema9 > stopPrice) {
        newTrailingStop = newTrailingStop ? Math.max(newTrailingStop, ema9) : ema9;
      }
    }

    if (exitsConfig.usePriorLowTrail && recentBars5m.length >= 2) {
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
