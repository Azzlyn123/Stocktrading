import { fetchBulkDailyBars, type DailyBar } from "../alpaca";
import { fetchAllActiveEquitySymbols } from "../alpaca";
import { getBroadUniverse } from "./broadUniverse";
import { log } from "../index";

export interface ClusterConfig {
  minPrice: number;
  minAvgDollarVol: number;
  minDayVolume: number;
  minGapPct: number;
  minRvol: number;
  gapCountThreshold: number;
  expansionCountThreshold: number;
  expansionAtrMultiple: number;
  expansionPctThreshold: number;
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
  expansionCountThreshold: 4,
  expansionAtrMultiple: 1.5,
  expansionPctThreshold: 0.02,
  spyVetoEnabled: false,
  spyAtrVetoMultiple: 0.8,
  useFullMarket: true,
};

export interface DailyClusterResult {
  date: string;
  regimeActive: boolean;
  gapCount: number;
  expansionCount: number;
  spyVeto: boolean;
  universeSize: number;
  gapQualifiers: string[];
  expansionQualifiers: string[];
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

  log(`[ClusterFilter] Fetching daily bars for ${universe.length} symbols, ${startDate} to ${endDate}`, "historical");

  const paddedStart = new Date(startDate + "T12:00:00Z");
  paddedStart.setDate(paddedStart.getDate() - 30);
  const paddedStartStr = paddedStart.toISOString().split("T")[0];

  const CHUNK_SIZE = 200;
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
  log(`[ClusterFilter] Fetch complete: ${allBars.size} symbols in ${(fetchTimeMs / 1000).toFixed(1)}s`, "historical");

  const computeStart = Date.now();

  const allDates = new Set<string>();
  allBars.forEach((bars) => {
    bars.forEach((b) => allDates.add(b.date));
  });
  const sortedDates = Array.from(allDates)
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  const dailyResults = new Map<string, DailyClusterResult>();

  for (const date of sortedDates) {
    const gapQualifiers: string[] = [];
    let universeSize = 0;

    allBars.forEach((bars, ticker) => {
      const dateIdx = bars.findIndex((b) => b.date === date);
      if (dateIdx < 1) return;

      const today = bars[dateIdx];
      const prior = bars[dateIdx - 1];

      if (prior.close < cfg.minPrice) return;
      if (prior.close <= 0 || today.open <= 0) return;

      const avgDolVol = computeAvgDollarVolume(bars, dateIdx, 20);
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
    let expansionCount = 0;
    const expansionQualifiers: string[] = [];
    let spyVeto = false;

    if (gapCount >= cfg.gapCountThreshold) {
      const expansionResult = computeExpansionFromDailyBars(
        date, allBars, cfg
      );
      expansionCount = expansionResult.count;
      expansionQualifiers.push(...expansionResult.qualifiers);

      if (cfg.spyVetoEnabled) {
        spyVeto = checkSpyVeto(date, allBars, cfg);
      }
    }

    const regimeActive = gapCount >= cfg.gapCountThreshold
      && expansionCount >= cfg.expansionCountThreshold
      && !spyVeto;

    dailyResults.set(date, {
      date,
      regimeActive,
      gapCount,
      expansionCount,
      spyVeto,
      universeSize,
      gapQualifiers,
      expansionQualifiers,
    });

    log(`[ClusterFilter] ${date}: universe=${universeSize} gapCount=${gapCount} expansion=${expansionCount} regime=${regimeActive ? "ON" : "OFF"}`, "historical");
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

function computeExpansionFromDailyBars(
  date: string,
  allBars: Map<string, DailyBar[]>,
  cfg: ClusterConfig,
): { count: number; qualifiers: string[] } {
  const qualifiers: string[] = [];

  allBars.forEach((bars, ticker) => {
    const dateIdx = bars.findIndex((b) => b.date === date);
    if (dateIdx < 1) return;
    const today = bars[dateIdx];
    const prior = bars[dateIdx - 1];
    if (prior.close < cfg.minPrice || prior.close <= 0) return;
    if (today.open <= 0) return;

    const avgDolVol = computeAvgDollarVolume(bars, dateIdx, 20);
    if (avgDolVol < cfg.minAvgDollarVol) return;

    const avgATR = computeAvgATR(bars, dateIdx - 1, 20);

    const moveUp = Math.abs(today.high - today.open);
    const moveDown = Math.abs(today.open - today.low);
    const maxMove = Math.max(moveUp, moveDown);
    const movePct = maxMove / today.open;

    const passATR = avgATR > 0 && maxMove >= cfg.expansionAtrMultiple * avgATR;
    const passPct = movePct >= cfg.expansionPctThreshold;

    const avgVol = computeAvgVolume(bars, dateIdx, 20);
    const rvol = avgVol > 0 ? today.volume / avgVol : 0;
    const hasVolConfirm = rvol >= 1.2;

    if (passATR || (passPct && hasVolConfirm)) {
      qualifiers.push(ticker);
    }
  });

  return { count: qualifiers.length, qualifiers };
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
