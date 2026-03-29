import { log } from "./index";
import type { Candle } from "./strategy/types";

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const POLYGON_BASE = "https://api.polygon.io";

// Global serial request queue — chains promises so requests fire one at a time.
// Free Polygon plan: 5 calls/min hard limit → 13s gap.
// Paid plan: set POLYGON_RATE_MS env var to a smaller value (e.g. 300).
// The gap adapts upward on 429 and slowly recovers after a run of successes.
const RATE_MS = parseInt(process.env.POLYGON_RATE_MS || "300");
let _gapMs = RATE_MS;
let _successStreak = 0;
let _requestChain: Promise<void> = Promise.resolve();

function scheduleThrottle(gapMs: number): Promise<void> {
  const next = _requestChain.then(
    () => new Promise<void>(resolve => setTimeout(resolve, gapMs))
  );
  _requestChain = next.then(() => {});
  return next;
}

function onPolygonSuccess() {
  _successStreak++;
  if (_successStreak >= 10 && _gapMs > RATE_MS) {
    _gapMs = Math.max(RATE_MS, Math.floor(_gapMs * 0.7));
    _successStreak = 0;
    log(`Polygon rate gap recovered → ${_gapMs}ms`, "polygon");
  }
}

function onPolygon429() {
  _successStreak = 0;
  _gapMs = Math.min(15000, _gapMs * 2);
  log(`Polygon 429 — backing off, gap now ${_gapMs}ms`, "polygon");
}

interface PolygonAggBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
}

interface PolygonGroupedBar extends PolygonAggBar {
  T: string;
}

function polygonBarToCandle(bar: PolygonAggBar): Candle {
  return {
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    timestamp: bar.t,
  };
}

function polygonGroupedBarToDailyBar(bar: PolygonGroupedBar): DailyBar {
  return {
    date: new Date(bar.t).toISOString().split("T")[0],
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

function parseTimeframe(timeframe: string): { multiplier: number; timespan: string } {
  const m = timeframe.match(/^(\d+)(Min|Hour|Day)$/i);
  if (!m) return { multiplier: 5, timespan: "minute" };
  const num = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  const timespan = unit === "min" ? "minute" : unit === "hour" ? "hour" : "day";
  return { multiplier: num, timespan };
}

async function polygonFetch(url: string, retries = 5): Promise<any> {
  const apiKey = process.env.POLYGON_API_KEY || "";
  const fullUrl = url.includes("?")
    ? `${url}&apiKey=${apiKey}`
    : `${url}?apiKey=${apiKey}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await scheduleThrottle(_gapMs);
      const res = await fetch(fullUrl);
      if (res.ok) {
        const data = await res.json();
        const ok = data.status === "OK" || data.resultsCount !== undefined || data.results;
        if (ok) onPolygonSuccess();
        return ok ? data : null;
      }
      if (res.status === 429) {
        const body = await res.text().catch(() => "");
        onPolygon429();
        log(`Polygon 429 (attempt ${attempt + 1}): ${body.slice(0, 80)} — waiting ${_gapMs / 1000}s`, "polygon");
        await new Promise(r => setTimeout(r, _gapMs));
        continue;
      }
      if (res.status === 403 || res.status === 401) {
        const body = await res.text().catch(() => "");
        log(`Polygon auth error ${res.status}: ${body.slice(0, 120)}`, "polygon");
        return null;
      }
      return null;
    } catch (e: any) {
      log(`Polygon fetch error: ${e.message}`, "polygon");
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  delayMs = 0
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) break;
      if (delayMs > 0 && idx > 0) await new Promise(r => setTimeout(r, delayMs));
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function fetchSymbolBars(
  symbol: string,
  from: string,
  to: string,
  multiplier: number,
  timespan: string
): Promise<Candle[]> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
  const data = await polygonFetch(url);
  if (!data?.results) return [];
  return (data.results as PolygonAggBar[]).map(polygonBarToCandle);
}

export async function fetchBarsForDatePolygon(
  symbols: string[],
  date: string,
  timeframe: string = "5Min"
): Promise<Map<string, Candle[]>> {
  const { multiplier, timespan } = parseTimeframe(timeframe);
  const result = new Map<string, Candle[]>();

  const tasks = symbols.map(sym => async () => {
    const bars = await fetchSymbolBars(sym, date, date, multiplier, timespan);
    return { sym, bars };
  });

  const settled = await parallelLimit(tasks, 1);
  for (const { sym, bars } of settled) {
    if (bars.length > 0) result.set(sym, bars);
  }
  return result;
}

export async function fetchDailyBarsForDatePolygon(
  symbols: string[],
  date: string
): Promise<Map<string, Candle>> {
  const result = new Map<string, Candle>();
  const prevDate = new Date(date + "T12:00:00Z");
  prevDate.setDate(prevDate.getDate() - 3);
  const from = prevDate.toISOString().split("T")[0];

  const tasks = symbols.map(sym => async () => {
    const bars = await fetchSymbolBars(sym, from, date, 1, "day");
    return { sym, bars };
  });

  const settled = await parallelLimit(tasks, 1);
  for (const { sym, bars } of settled) {
    if (bars.length > 0) result.set(sym, bars[bars.length - 1]);
  }
  return result;
}

export async function fetchMultiDayDailyBarsPolygon(
  symbols: string[],
  date: string,
  lookbackDays: number = 20
): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();
  const endDate = new Date(date + "T12:00:00Z");
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - lookbackDays - 5);
  const from = startDate.toISOString().split("T")[0];

  const tasks = symbols.map(sym => async () => {
    const bars = await fetchSymbolBars(sym, from, date, 1, "day");
    return { sym, bars };
  });

  const settled = await parallelLimit(tasks, 1);
  for (const { sym, bars } of settled) {
    if (bars.length > 0) result.set(sym, bars);
  }
  return result;
}

// For the VCS cluster filter: uses Polygon's grouped daily endpoint
// to get all US equities for a date range in a small number of calls.
export async function fetchBulkDailyBarsPolygon(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, DailyBar[]>> {
  const result = new Map<string, DailyBar[]>(symbols.map(s => [s, []]));
  const symbolSet = new Set(symbols.map(s => s.toUpperCase()));

  // Build list of calendar dates in range
  const dates: string[] = [];
  const cur = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(cur.toISOString().split("T")[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (dates.length === 0) return result;

  // Fetch grouped daily bars for each date (one call per date, returns all US stocks)
  const tasks = dates.map(date => async () => {
    const url = `${POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`;
    const data = await polygonFetch(url);
    if (!data?.results) return;
    for (const bar of data.results as PolygonGroupedBar[]) {
      const sym = bar.T?.toUpperCase();
      if (!sym || !symbolSet.has(sym)) continue;
      const existing = result.get(sym) ?? [];
      existing.push(polygonGroupedBarToDailyBar(bar));
      result.set(sym, existing);
    }
  });

  // Run up to 5 grouped fetches in parallel
  await parallelLimit(tasks, 5);

  // Sort each symbol's bars by date
  for (const [sym, bars] of result.entries()) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    result.set(sym, bars);
  }

  return result;
}
