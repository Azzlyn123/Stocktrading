import { fetchBulkDailyBars, fetchAllActiveEquitySymbols, type DailyBar } from "../alpaca";
import { getBroadUniverse } from "./broadUniverse";
import { log } from "../index";
import type { GapScanConfig, GapScanResult, DailyGapScanOutput } from "./dynamicGapScanner";

export const DEFAULT_GAP_SCAN_CONFIG: GapScanConfig = {
  minPrice: 2.0,
  maxPrice: 20.0,
  minGapPct: 0.05,
  minDollarVolume: 2_000_000,
  useFullMarket: false,
};

export interface BatchGapScanOutput {
  totalSymbolsScanned: number;
  totalSymbolsWithData: number;
  totalDatesProcessed: number;
  fetchTimeMs: number;
  computeTimeMs: number;
  dailyResults: Map<string, DailyGapScanOutput>;
}

export async function batchScanForGappers(
  startDate: string,
  endDate: string,
  config: Partial<GapScanConfig> = {},
): Promise<BatchGapScanOutput> {
  const cfg: GapScanConfig = { ...DEFAULT_GAP_SCAN_CONFIG, ...config };

  let universe: string[];
  if (cfg.useFullMarket) {
    universe = await fetchAllActiveEquitySymbols();
    if (universe.length === 0) {
      log(`[BatchGapScanner] Full market universe empty, falling back to broad list`, "historical");
      universe = getBroadUniverse();
    }
  } else {
    universe = getBroadUniverse();
  }

  log(`[BatchGapScanner] Fetching daily bars for ${universe.length} symbols, ${startDate} to ${endDate}`, "historical");

  const fetchStart = Date.now();
  const CHUNK_SIZE = 200;
  const allBars = new Map<string, DailyBar[]>();

  const chunks: string[][] = [];
  for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
    chunks.push(universe.slice(i, i + CHUNK_SIZE));
  }

  const paddedStart = new Date(startDate + "T12:00:00Z");
  paddedStart.setDate(paddedStart.getDate() - 7);
  const paddedStartStr = paddedStart.toISOString().split("T")[0];

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
          log(`[BatchGapScanner] Chunk ${ci} failed after retry (${chunk.length} symbols)`, "historical");
        }
      }
    }
    if ((ci + 1) % 10 === 0) {
      log(`[BatchGapScanner] Fetched ${ci + 1}/${chunks.length} chunks, ${allBars.size} symbols with data`, "historical");
    }
  }

  const fetchTimeMs = Date.now() - fetchStart;
  log(`[BatchGapScanner] Fetch complete: ${allBars.size} symbols with data in ${(fetchTimeMs / 1000).toFixed(1)}s`, "historical");

  const computeStart = Date.now();
  const dailyResults = new Map<string, DailyGapScanOutput>();

  const allDates = new Set<string>();
  allBars.forEach((bars) => {
    bars.forEach((b) => allDates.add(b.date));
  });

  const sortedDates = Array.from(allDates)
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  for (const date of sortedDates) {
    const qualifiers: GapScanResult[] = [];
    let dataCount = 0;

    allBars.forEach((bars, ticker) => {
      const dateIdx = bars.findIndex((b) => b.date === date);
      if (dateIdx < 1) return;

      const today = bars[dateIdx];
      const prior = bars[dateIdx - 1];
      dataCount++;

      if (prior.close <= 0 || today.open <= 0) return;
      if (prior.close < cfg.minPrice || prior.close > cfg.maxPrice) return;
      if (today.open < cfg.minPrice || today.open > cfg.maxPrice * 1.5) return;

      const gapPct = (today.open - prior.close) / prior.close;
      const absGapPct = Math.abs(gapPct);
      if (absGapPct < cfg.minGapPct) return;

      const dollarVolume = today.volume * ((today.open + prior.close) / 2);
      if (dollarVolume < cfg.minDollarVolume) return;

      qualifiers.push({
        ticker,
        priorClose: prior.close,
        todayOpen: today.open,
        gapPct,
        gapDirection: gapPct >= 0 ? "LONG" : "SHORT",
        dollarVolume,
        todayVolume: today.volume,
      });
    });

    qualifiers.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

    dailyResults.set(date, {
      date,
      scannedCount: universe.length,
      dataReturnedCount: dataCount,
      qualifiedCount: qualifiers.length,
      qualifiers,
      scanTimeMs: 0,
    });
  }

  const computeTimeMs = Date.now() - computeStart;
  log(`[BatchGapScanner] Computed gaps for ${sortedDates.length} dates in ${computeTimeMs}ms`, "historical");

  return {
    totalSymbolsScanned: universe.length,
    totalSymbolsWithData: allBars.size,
    totalDatesProcessed: sortedDates.length,
    fetchTimeMs,
    computeTimeMs,
    dailyResults,
  };
}
