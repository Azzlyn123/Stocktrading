import { fetchTwoDayDailyBars, fetchAllActiveEquitySymbols, type TwoDayBars } from "../alpaca";
import { getBroadUniverse } from "./broadUniverse";
import { log } from "../index";

export interface GapScanConfig {
  minPrice: number;
  maxPrice: number;
  minGapPct: number;
  minDollarVolume: number;
  useFullMarket?: boolean;
}

export const DEFAULT_GAP_SCAN_CONFIG: GapScanConfig = {
  minPrice: 2.0,
  maxPrice: 20.0,
  minGapPct: 0.05,
  minDollarVolume: 2_000_000,
  useFullMarket: false,
};

export interface GapScanResult {
  ticker: string;
  priorClose: number;
  todayOpen: number;
  gapPct: number;
  gapDirection: "LONG" | "SHORT";
  dollarVolume: number;
  todayVolume: number;
}

export interface DailyGapScanOutput {
  date: string;
  scannedCount: number;
  dataReturnedCount: number;
  qualifiedCount: number;
  qualifiers: GapScanResult[];
  scanTimeMs: number;
}

export async function scanForGappersOnDate(
  date: string,
  config: Partial<GapScanConfig> = {},
): Promise<DailyGapScanOutput> {
  const cfg: GapScanConfig = { ...DEFAULT_GAP_SCAN_CONFIG, ...config };
  const startTime = Date.now();

  let universe: string[];
  if (cfg.useFullMarket) {
    universe = await fetchAllActiveEquitySymbols();
    if (universe.length === 0) {
      log(`[GapScanner] Full market universe empty, falling back to broad list`, "historical");
      universe = getBroadUniverse();
    }
  } else {
    universe = getBroadUniverse();
  }

  const CHUNK_SIZE = cfg.useFullMarket ? 200 : 50;
  const allBars = new Map<string, TwoDayBars>();

  const chunks: string[][] = [];
  for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
    chunks.push(universe.slice(i, i + CHUNK_SIZE));
  }

  let chunksDone = 0;
  for (const chunk of chunks) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const chunkBars = await fetchTwoDayDailyBars(chunk, date);
        chunkBars.forEach((bars, sym) => {
          allBars.set(sym, bars);
        });
        break;
      } catch (e: any) {
        if (attempt === 1) {
          log(`[GapScanner] Chunk failed after retry (${chunk.length} symbols)`, "historical");
        }
      }
    }
    chunksDone++;
    if (cfg.useFullMarket && chunksDone % 10 === 0) {
      log(`[GapScanner] ${date}: progress ${chunksDone}/${chunks.length} chunks, ${allBars.size} symbols with data`, "historical");
    }
  }

  const qualifiers: GapScanResult[] = [];

  const tickers = Array.from(allBars.keys());
  for (const ticker of tickers) {
    const bars = allBars.get(ticker)!;
    const { priorClose, todayOpen, todayVolume } = bars;

    if (priorClose <= 0 || todayOpen <= 0) continue;

    if (priorClose < cfg.minPrice || priorClose > cfg.maxPrice) continue;
    if (todayOpen < cfg.minPrice || todayOpen > cfg.maxPrice * 1.5) continue;

    const gapPct = (todayOpen - priorClose) / priorClose;
    const absGapPct = Math.abs(gapPct);

    if (absGapPct < cfg.minGapPct) continue;

    const dollarVolume = todayVolume * ((todayOpen + priorClose) / 2);
    if (dollarVolume < cfg.minDollarVolume) continue;

    qualifiers.push({
      ticker,
      priorClose,
      todayOpen,
      gapPct,
      gapDirection: gapPct >= 0 ? "LONG" : "SHORT",
      dollarVolume,
      todayVolume,
    });
  }

  qualifiers.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

  const scanTimeMs = Date.now() - startTime;

  log(`[GapScanner] ${date}: scanned ${universe.length}, data for ${allBars.size}, qualified ${qualifiers.length} gappers (${scanTimeMs}ms)`, "historical");

  return {
    date,
    scannedCount: universe.length,
    dataReturnedCount: allBars.size,
    qualifiedCount: qualifiers.length,
    qualifiers,
    scanTimeMs,
  };
}
