import { fetchBulkDailyBars, fetchBarsForDate, type DailyBar } from "../alpaca";
import { fetchAllActiveEquitySymbols } from "../alpaca";
import { getBroadUniverse } from "./broadUniverse";
import type { Candle } from "./types";
import { log } from "../index";

export interface ClusterConfig {
  minPrice: number;
  minAvgDollarVol: number;
  minDayVolume: number;
  minGapPct: number;
  minRvol: number;
  gapCountThreshold: number;
  minPercentAboveVWAP: number;
  minPercentMakingHOD: number;
  spyVetoEnabled: boolean;
  spyAtrVetoMultiple: number;
  useFullMarket: boolean;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  minPrice: 10,
  minAvgDollarVol: 50_000_000,
  minDayVolume: 500_000,
  minGapPct: 0.04,
  minRvol: 1.5,
  gapCountThreshold: 6,
  minPercentAboveVWAP: 0.65,
  minPercentMakingHOD: 0.40,
  spyVetoEnabled: false,
  spyAtrVetoMultiple: 0.8,
  useFullMarket: true,
};

export interface DailyClusterResult {
  date: string;
  regimeActive: boolean;
  vcs: number;
  gapDensityScore: number;
  breadthScore: number;
  expansionScore: number;
  spyRangeRatio: number;
  gapCount: number;
  percentAboveVWAP: number;
  percentMakingHOD: number;
  percentExpanded: number;
  breadthUniverseSize: number;
  spyVeto: boolean;
  universeSize: number;
  gapQualifiers: string[];
}

export interface BatchClusterOutput {
  totalSymbolsScanned: number;
  totalDates: number;
  dailyResults: Map<string, DailyClusterResult>;
  fetchTimeMs: number;
  computeTimeMs: number;
}

export async function batchComputeClusterActivation(
  startDate: string,
  endDate: string,
  config: Partial<ClusterConfig> = {},
): Promise<BatchClusterOutput> {
  const cfg: ClusterConfig = { ...DEFAULT_CLUSTER_CONFIG, ...config };
  const startTime = Date.now();

  let universe: string[];
  if (cfg.useFullMarket) {
    universe = await fetchAllActiveEquitySymbols();
    if (universe.length === 0) {
      log(`[ClusterFilter] Full market empty, falling back to broad list`, "historical");
      universe = getBroadUniverse();
    }
  } else {
    universe = getBroadUniverse();
  }
  if (!universe.includes("SPY")) {
    universe.push("SPY");
  }

  log(`[ClusterFilter] Fetching daily bars for ${universe.length} symbols, ${startDate} to ${endDate}`, "historical");

  const paddedStart = new Date(startDate + "T12:00:00Z");
  paddedStart.setDate(paddedStart.getDate() - 30);
  const paddedStartStr = paddedStart.toISOString().split("T")[0];

  const daySpan = Math.ceil((new Date(endDate).getTime() - new Date(paddedStartStr).getTime()) / (1000 * 60 * 60 * 24));
  const CHUNK_SIZE = Math.min(200, Math.max(20, Math.floor(9500 / Math.max(daySpan, 30))));
  log(`[ClusterFilter] Using chunk size ${CHUNK_SIZE} for ${daySpan} day span`, "historical");
  const allBars = new Map<string, DailyBar[]>();

  const chunks: string[][] = [];
  for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
    chunks.push(universe.slice(i, i + CHUNK_SIZE));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const chunkBars = await fetchBulkDailyBars(chunk, paddedStartStr, endDate);
        chunkBars.forEach((bars, sym) => {
          allBars.set(sym, bars);
        });
        break;
      } catch (e: any) {
        if (attempt === 1) {
          log(`[ClusterFilter] Chunk ${ci} failed after retry`, "historical");
        }
      }
    }
    if ((ci + 1) % 10 === 0) {
      log(`[ClusterFilter] Fetched ${ci + 1}/${chunks.length} chunks, ${allBars.size} symbols`, "historical");
    }
  }

  const fetchTimeMs = Date.now() - startTime;
  log(`[ClusterFilter] Fetch complete: ${allBars.size} symbols in ${(fetchTimeMs / 1000).toFixed(1)}s. SPY: ${allBars.has("SPY") ? allBars.get("SPY")!.length + ' bars' : 'MISSING'}`, "historical");

  const computeStart = Date.now();

  const allDates = new Set<string>();
  allBars.forEach((bars) => {
    bars.forEach((b) => allDates.add(b.date));
  });
  const sortedDates = Array.from(allDates)
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  const dailyResults = new Map<string, DailyClusterResult>();

  // Rolling VCS history for dynamic percentile threshold
  const rollingVcs: number[] = [];
  const ROLLING_WINDOW = 60;
  const MIN_THRESHOLD = 0.18;
  const MAX_THRESHOLD = 0.45;
  const PERCENTILE = 0.70;

  for (const date of sortedDates) {
    const gapQualifiers: string[] = [];
    let universeSize = 0;
    const breadthUniverse: string[] = [];

    allBars.forEach((bars, ticker) => {
      const dateIdx = bars.findIndex((b) => b.date === date);
      if (dateIdx < 1) return;

      const today = bars[dateIdx];
      const prior = bars[dateIdx - 1];

      if (prior.close <= 0 || today.open <= 0) return;

      const avgDolVol = computeAvgDollarVolume(bars, dateIdx, 20);

      if (prior.close >= 5 && avgDolVol >= 1_000_000) {
        breadthUniverse.push(ticker);
      }

      if (prior.close < cfg.minPrice) return;
      if (avgDolVol < cfg.minAvgDollarVol) return;

      if (today.volume < cfg.minDayVolume) return;

      universeSize++;

      const gapPct = (today.open - prior.close) / prior.close;
      if (gapPct < cfg.minGapPct) return;

      const avgVol = computeAvgVolume(bars, dateIdx, 20);
      const rvol = avgVol > 0 ? today.volume / avgVol : 0;
      if (rvol < cfg.minRvol) return;

      if (today.open <= prior.high) return;

      gapQualifiers.push(ticker);
    });

    const gapCount = gapQualifiers.length;
    let percentAboveVWAP = 0;
    let percentMakingHOD = 0;
    let percentExpanded = 0;
    let breadthUniverseSize = 0;
    let spyVeto = false;
    let spyRangeRatio = 0;

    const spyBars = allBars.get("SPY");
    if (spyBars && spyBars.length > 0) {
      const spyIdx = spyBars.findIndex(b => b.date === date);
      if (spyIdx >= 1) {
        const spyToday = spyBars[spyIdx];
        const spyAtr = computeAvgATR(spyBars, spyIdx - 1, 20);
        if (spyAtr > 0) {
          spyRangeRatio = (spyToday.high - spyToday.low) / spyAtr;
        }
      }
    }

    if (gapCount >= cfg.gapCountThreshold) {
      const breadthResult = await computeFirstHourBreadth(date, breadthUniverse, allBars);
      percentAboveVWAP = breadthResult.percentAboveVWAP;
      percentMakingHOD = breadthResult.percentMakingHOD;
      percentExpanded = breadthResult.percentExpanded;
      breadthUniverseSize = breadthResult.universeSize;

      if (cfg.spyVetoEnabled) {
        spyVeto = checkSpyVeto(date, allBars, cfg);
      }
    }

    // VCS Calculation
    const gapDensityScore = Math.min(gapCount / 30, 1.0);
    const breadthScore = percentAboveVWAP; // VWAP% scaled 0-1
    const expansionScore = percentExpanded; // % > 1.5 ATR scaled 0-1
    const spyScore = Math.min(spyRangeRatio / 2.0, 1.0); // 1.0 at 2x ATR

    const vcs = (gapDensityScore * 0.25) + (breadthScore * 0.35) + (expansionScore * 0.25) + (spyScore * 0.15);

    // Dynamic threshold: 70th percentile of last 60 VCS days, clamped [0.18, 0.45]
    const window = rollingVcs.slice(-ROLLING_WINDOW);
    let dynamicThreshold: number;
    if (window.length < 5) {
      dynamicThreshold = MIN_THRESHOLD;
    } else {
      const sorted = [...window].sort((a, b) => a - b);
      const idx = Math.floor(PERCENTILE * sorted.length);
      dynamicThreshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, sorted[idx]));
    }
    const regimeActive = vcs >= dynamicThreshold;

    // Append today's VCS to rolling history AFTER threshold decision
    rollingVcs.push(vcs);

    dailyResults.set(date, {
      date,
      regimeActive,
      vcs: Number(vcs.toFixed(3)),
      gapDensityScore: Number(gapDensityScore.toFixed(3)),
      breadthScore: Number(breadthScore.toFixed(3)),
      expansionScore: Number(expansionScore.toFixed(3)),
      spyRangeRatio: Number(spyRangeRatio.toFixed(3)),
      gapCount,
      percentAboveVWAP,
      percentMakingHOD,
      percentExpanded,
      breadthUniverseSize,
      spyVeto,
      universeSize,
      gapQualifiers,
    });

    log(`[ClusterFilter] ${date}: VCS=${vcs.toFixed(2)} | thresh=${dynamicThreshold.toFixed(2)} | regime=${regimeActive ? "ON" : "OFF"} [GD:${gapDensityScore.toFixed(2)} BR:${breadthScore.toFixed(2)} EX:${expansionScore.toFixed(2)} SPY:${spyScore.toFixed(2)}]`, "historical");
  }

  const computeTimeMs = Date.now() - computeStart;
  log(`[ClusterFilter] Computed ${sortedDates.length} dates in ${(computeTimeMs / 1000).toFixed(1)}s`, "historical");

  return {
    totalSymbolsScanned: universe.length,
    totalDates: sortedDates.length,
    dailyResults,
    fetchTimeMs,
    computeTimeMs,
  };
}

function computeAvgDollarVolume(bars: DailyBar[], currentIdx: number, lookback: number): number {
  let sum = 0;
  let count = 0;
  const start = Math.max(0, currentIdx - lookback);
  for (let i = start; i < currentIdx; i++) {
    const b = bars[i];
    sum += b.volume * ((b.open + b.close) / 2);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function computeAvgVolume(bars: DailyBar[], currentIdx: number, lookback: number): number {
  let sum = 0;
  let count = 0;
  const start = Math.max(0, currentIdx - lookback);
  for (let i = start; i < currentIdx; i++) {
    sum += bars[i].volume;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function computeAvgATR(bars: DailyBar[], currentIdx: number, lookback: number): number {
  let sum = 0;
  let count = 0;
  const start = Math.max(1, currentIdx - lookback);
  for (let i = start; i <= currentIdx; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

async function computeFirstHourBreadth(
  date: string,
  liquidUniverse: string[],
  allDailyBars: Map<string, DailyBar[]>,
): Promise<{ percentAboveVWAP: number; percentMakingHOD: number; percentExpanded: number; universeSize: number }> {
  if (liquidUniverse.length === 0) {
    return { percentAboveVWAP: 0, percentMakingHOD: 0, percentExpanded: 0, universeSize: 0 };
  }

  const sampleSize = Math.min(liquidUniverse.length, 200);
  const shuffled = [...liquidUniverse].sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, sampleSize);

  // Pre-calculate ATRs for the sample to avoid repeated calculations in the loop
  const atrMap = new Map<string, number>();
  for (const ticker of sampled) {
    const bars = allDailyBars.get(ticker);
    if (bars) {
      const idx = bars.findIndex(b => b.date === date);
      if (idx >= 0) {
        atrMap.set(ticker, computeAvgATR(bars, idx - 1, 20));
      }
    }
  }

  log(`[ClusterFilter] Breadth ${date}: sampling ${sampled.length} of ${liquidUniverse.length} candidates for 5m bars`, "historical");

  const CHUNK = 50;
  const allIntraday = new Map<string, Candle[]>();

  for (let i = 0; i < sampled.length; i += CHUNK) {
    const batch = sampled.slice(i, i + CHUNK);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const barsMap = await fetchBarsForDate(batch, date, "5Min");
        barsMap.forEach((bars, sym) => allIntraday.set(sym, bars));
        break;
      } catch (e: any) {
        if (attempt === 1) {
          log(`[ClusterFilter] Breadth 5m fetch failed for batch on ${date}: ${e.message}`, "historical");
        }
      }
    }
  }

  let aboveVWAPCount = 0;
  let makingHODCount = 0;
  let expandedCount = 0;
  let validCount = 0;

  for (const ticker of sampled) {
    const bars = allIntraday.get(ticker);
    if (!bars || bars.length < 2) continue;

    const firstHourBars = bars.filter((b) => {
      const barTime = new Date(b.timestamp);
      const totalMinUTC = barTime.getUTCHours() * 60 + barTime.getUTCMinutes();
      return totalMinUTC >= 14 * 60 + 30 && totalMinUTC <= 15 * 60 + 30;
    });

    if (firstHourBars.length < 2) continue;
    validCount++;

    const atr = atrMap.get(ticker) || 0;
    const openPrice = firstHourBars[0].open;
    let cumVolPrice = 0;
    let cumVol = 0;
    let hodSoFar = -Infinity;
    let lodSoFar = Infinity;
    let priceAt1000 = 0;
    let vwapAt1000 = 0;
    let madeNewHODBy1030 = false;

    for (const bar of firstHourBars) {
      const barTime = new Date(bar.timestamp);
      const totalMinUTC = barTime.getUTCHours() * 60 + barTime.getUTCMinutes();

      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      cumVolPrice += typicalPrice * bar.volume;
      cumVol += bar.volume;

      if (bar.high > hodSoFar) hodSoFar = bar.high;
      if (bar.low < lodSoFar) lodSoFar = bar.low;

      if (totalMinUTC >= 14 * 60 + 30 + 30 && priceAt1000 === 0) {
        priceAt1000 = bar.close;
        vwapAt1000 = cumVol > 0 ? cumVolPrice / cumVol : 0;
      }

      if (totalMinUTC >= 14 * 60 + 30 + 30) {
        if (bar.high >= hodSoFar) {
          madeNewHODBy1030 = true;
        }
      }
    }

    if (priceAt1000 === 0 && firstHourBars.length > 0) {
      const lastBar = firstHourBars[firstHourBars.length - 1];
      priceAt1000 = lastBar.close;
      vwapAt1000 = cumVol > 0 ? cumVolPrice / cumVol : 0;
    }

    if (priceAt1000 > 0 && vwapAt1000 > 0 && priceAt1000 > vwapAt1000) {
      aboveVWAPCount++;
    }

    if (madeNewHODBy1030) {
      makingHODCount++;
    }
    
    const firstHourRange = hodSoFar - lodSoFar;
    if (atr > 0 && firstHourRange > 0.75 * atr) {
      expandedCount++;
    }
  }

  const percentAboveVWAP = validCount > 0 ? aboveVWAPCount / validCount : 0;
  const percentMakingHOD = validCount > 0 ? makingHODCount / validCount : 0;
  const percentExpanded = validCount > 0 ? expandedCount / validCount : 0;

  return { percentAboveVWAP, percentMakingHOD, percentExpanded, universeSize: validCount };
}

function checkSpyVeto(
  date: string,
  allBars: Map<string, DailyBar[]>,
  cfg: ClusterConfig,
): boolean {
  const spyBars = allBars.get("SPY");
  if (!spyBars) return false;

  const dateIdx = spyBars.findIndex((b) => b.date === date);
  if (dateIdx < 1) return false;

  const avgATR = computeAvgATR(spyBars, dateIdx - 1, 20);
  if (avgATR <= 0) return false;

  const today = spyBars[dateIdx];
  const dailyRange = today.high - today.low;
  return dailyRange < avgATR * cfg.spyAtrVetoMultiple;
}
