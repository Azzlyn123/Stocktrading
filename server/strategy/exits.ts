import type { Candle, StrategyConfig, ExitDecision } from "./types";
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
  riskConfig: StrategyConfig["risk"]
): ExitDecision {
  const currentPrice = currentCandle.close;
  const pnlR = riskPerShare > 0 ? (currentPrice - entryPrice) / riskPerShare : 0;

  if (!isPartiallyExited && pnlR >= config.partialAtR) {
    const partialShares = Math.floor(shares * (config.partialPct / 100));
    return {
      shouldExit: true,
      exitType: "partial",
      exitPrice: currentPrice,
      reason: `Partial exit at +${pnlR.toFixed(1)}R`,
      partialShares,
      newStopPrice: entryPrice,
    };
  }

  if (riskConfig.timeStopMinutes > 0 && minutesSinceEntry >= riskConfig.timeStopMinutes) {
    if (pnlR < riskConfig.timeStopR) {
      return {
        shouldExit: true,
        exitType: "time_stop",
        exitPrice: currentPrice,
        reason: `Time stop: ${minutesSinceEntry}min elapsed, only +${pnlR.toFixed(1)}R (need +${riskConfig.timeStopR}R)`,
        partialShares: null,
        newStopPrice: null,
      };
    }
  }

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
          reason: `Hard exit: ${config.hardExitRedCandles} red 5m candles with increasing volume`,
          partialShares: null,
          newStopPrice: null,
        };
      }
    }
  }

  let newTrailingStop: number | null = null;

  if (isPartiallyExited) {
    if (config.useEMA9Trail && recentBars5m.length >= 9) {
      const closes = recentBars5m.map((c) => c.close);
      const ema9 = lastEMA(closes, 9);
      if (ema9 > stopPrice) {
        newTrailingStop = ema9;
      }
    }

    if (config.usePriorLowTrail && recentBars5m.length >= 2) {
      const priorLow = recentBars5m[recentBars5m.length - 2].low;
      if (priorLow > stopPrice) {
        newTrailingStop = newTrailingStop
          ? Math.max(newTrailingStop, priorLow)
          : priorLow;
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
