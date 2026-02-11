import type { Candle, StrategyConfig, UniverseFilterResult } from "./types";
import { calculateATR } from "./indicators";

export function checkUniverseFilter(
  price: number,
  avgDollarVolume: number,
  spreadPct: number,
  dailyCandles: Candle[],
  rvol: number,
  minutesSinceOpen: number,
  config: StrategyConfig["universe"],
  riskMode: StrategyConfig["riskMode"]
): UniverseFilterResult {
  const reasons: string[] = [];
  const atr = calculateATR(dailyCandles, 14);
  const lastClose = dailyCandles.length > 0 ? dailyCandles[dailyCandles.length - 1].close : price;
  const dailyATRpct = lastClose > 0 ? (atr / lastClose) * 100 : 0;

  // Risk Mode Liquidity
  let minDV = config.minAvgDollarVolume;
  if (riskMode === "conservative") minDV = 100_000_000;
  else if (riskMode === "balanced") minDV = 50_000_000;
  else if (riskMode === "aggressive") minDV = 30_000_000;

  const priceOk = price >= config.minPrice;
  if (!priceOk) reasons.push(`Price $${price.toFixed(2)} < $${config.minPrice}`);

  const dvOk = avgDollarVolume >= minDV;
  if (!dvOk) reasons.push(`AvgDollarVol $${(avgDollarVolume / 1e6).toFixed(0)}M < $${(minDV / 1e6).toFixed(0)}M`);

  const spreadOk = spreadPct <= config.maxSpreadPct;
  if (!spreadOk) reasons.push(`Spread ${spreadPct.toFixed(3)}% > ${config.maxSpreadPct}%`);

  const atrOk = dailyATRpct >= config.minDailyATRpct;
  if (!atrOk) reasons.push(`DailyATR% ${dailyATRpct.toFixed(2)}% < ${config.minDailyATRpct}%`);

  const rvolOk = minutesSinceOpen > config.rvolCutoffMinutes ? rvol >= config.minRVOL : true;
  if (!rvolOk) reasons.push(`RVOL ${rvol.toFixed(1)}x < ${config.minRVOL}x by ${config.rvolCutoffMinutes}min`);

  return {
    passes: priceOk && dvOk && spreadOk && atrOk && rvolOk,
    reasons,
    metrics: {
      price,
      avgDollarVolume,
      spreadPct,
      dailyATRpct,
      rvol,
    },
  };
}
