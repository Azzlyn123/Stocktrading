import WebSocket from "ws";
import { log } from "./index";
import type { Candle } from "./strategy/types";

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "";
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET || "";
const DATA_BASE_URL = "https://data.alpaca.markets/v2";
const WS_URL = "wss://stream.data.alpaca.markets/v2/iex";

const headers: Record<string, string> = {
  "APCA-API-KEY-ID": ALPACA_API_KEY,
  "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
};

export function isAlpacaConfigured(): boolean {
  return ALPACA_API_KEY.length > 0 && ALPACA_API_SECRET.length > 0;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

interface AlpacaSnapshot {
  latestTrade?: { p: number; s: number; t: string };
  latestQuote?: { bp: number; ap: number; bs: number; as: number };
  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

function alpacaBarToCandle(bar: AlpacaBar): Candle {
  return {
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    timestamp: new Date(bar.t).getTime(),
  };
}

export async function fetchHistoricalBars(
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<Candle[]> {
  const end = new Date();
  const start = new Date();
  if (timeframe === "5Min") {
    start.setDate(start.getDate() - 5);
  } else if (timeframe === "15Min") {
    start.setDate(start.getDate() - 10);
  } else if (timeframe === "1Hour") {
    start.setDate(start.getDate() - 30);
  } else {
    start.setDate(start.getDate() - 60);
  }

  const url = `${DATA_BASE_URL}/stocks/${symbol}/bars?timeframe=${timeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=${limit}&feed=iex&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      log(`Alpaca bars error for ${symbol}: ${res.status} ${text}`, "alpaca");
      return [];
    }
    const data = await res.json();
    const bars: AlpacaBar[] = data.bars || [];
    return bars.map(alpacaBarToCandle);
  } catch (e: any) {
    log(`Alpaca bars fetch failed for ${symbol}: ${e.message}`, "alpaca");
    return [];
  }
}

export async function fetchMultipleHistoricalBars(
  symbols: string[],
  timeframe: string,
  limit: number = 100
): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();
  const end = new Date();
  const start = new Date();
  if (timeframe === "5Min") {
    start.setDate(start.getDate() - 5);
  } else if (timeframe === "15Min") {
    start.setDate(start.getDate() - 10);
  } else {
    start.setDate(start.getDate() - 30);
  }

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=${timeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=${limit}&feed=iex&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      log(`Alpaca multi-bars error: ${res.status} ${text}`, "alpaca");
      return result;
    }
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      result.set(sym, (bars as AlpacaBar[]).map(alpacaBarToCandle));
    }
  } catch (e: any) {
    log(`Alpaca multi-bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export async function fetchBarsForDate(
  symbols: string[],
  date: string,
  timeframe: string = "5Min"
): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();

  const start = `${date}T09:30:00-05:00`;
  const end = `${date}T16:00:00-05:00`;

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=${timeframe}&start=${start}&end=${end}&limit=10000&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      log(`Alpaca date-bars error: ${res.status} ${text}`, "alpaca");
      return result;
    }
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      result.set(sym, (bars as AlpacaBar[]).map(alpacaBarToCandle));
    }
  } catch (e: any) {
    log(`Alpaca date-bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export async function fetchMultiDayDailyBars(
  symbols: string[],
  date: string,
  lookbackDays: number = 20
): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();
  const endDate = new Date(date + "T12:00:00Z");
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - lookbackDays - 5);
  const start = startDate.toISOString().split("T")[0];

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=1Day&start=${start}T00:00:00Z&end=${date}T00:00:00Z&limit=1000&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return result;
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      result.set(sym, (bars as AlpacaBar[]).map(alpacaBarToCandle));
    }
  } catch (e: any) {
    log(`Alpaca multi-day bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export async function fetchForwardDailyBars(
  symbols: string[],
  afterDate: string,
  forwardDays: number = 5
): Promise<Map<string, Candle[]>> {
  const result = new Map<string, Candle[]>();
  const startDate = new Date(afterDate + "T12:00:00Z");
  startDate.setDate(startDate.getDate() + 1);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + forwardDays + 3);
  const start = startDate.toISOString().split("T")[0];
  const end = endDate.toISOString().split("T")[0];

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=1Day&start=${start}T00:00:00Z&end=${end}T23:59:59Z&limit=1000&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return result;
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      const candles = (bars as AlpacaBar[]).map(alpacaBarToCandle);
      if (candles.length > 0) result.set(sym, candles.slice(0, forwardDays));
    }
  } catch (e: any) {
    log(`Alpaca forward daily bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export async function fetchDailyBarsForDate(
  symbols: string[],
  date: string
): Promise<Map<string, Candle>> {
  const result = new Map<string, Candle>();
  const prevDate = new Date(date + "T12:00:00Z");
  prevDate.setDate(prevDate.getDate() - 3);
  const start = prevDate.toISOString().split("T")[0];

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=1Day&start=${start}T00:00:00Z&end=${date}T00:00:00Z&limit=10&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return result;
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      const dailyBars = (bars as AlpacaBar[]).map(alpacaBarToCandle);
      if (dailyBars.length > 0) {
        result.set(sym, dailyBars[dailyBars.length - 1]);
      }
    }
  } catch (e: any) {
    log(`Alpaca daily-bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export interface TwoDayBars {
  priorClose: number;
  priorVolume: number;
  todayOpen: number;
  todayHigh: number;
  todayLow: number;
  todayClose: number;
  todayVolume: number;
}

export async function fetchTwoDayDailyBars(
  symbols: string[],
  date: string
): Promise<Map<string, TwoDayBars>> {
  const result = new Map<string, TwoDayBars>();
  const endDate = new Date(date + "T12:00:00Z");
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);
  const start = startDate.toISOString().split("T")[0];

  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=1Day&start=${start}T00:00:00Z&end=${date}T23:59:59Z&limit=10000&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return result;
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      const sorted = (bars as AlpacaBar[]).sort(
        (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
      );
      if (sorted.length >= 2) {
        const prior = sorted[sorted.length - 2];
        const today = sorted[sorted.length - 1];
        const todayDateStr = new Date(today.t).toISOString().split("T")[0];
        if (todayDateStr === date) {
          result.set(sym, {
            priorClose: prior.c,
            priorVolume: prior.v,
            todayOpen: today.o,
            todayHigh: today.h,
            todayLow: today.l,
            todayClose: today.c,
            todayVolume: today.v,
          });
        }
      }
    }
  } catch (e: any) {
    log(`Alpaca two-day bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchBulkDailyBars(
  symbols: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, DailyBar[]>> {
  const result = new Map<string, DailyBar[]>();
  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/bars?symbols=${symbolStr}&timeframe=1Day&start=${startDate}T00:00:00Z&end=${endDate}T23:59:59Z&limit=10000&feed=sip&adjustment=split`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return result;
    const data = await res.json();
    const barsMap: Record<string, AlpacaBar[]> = data.bars || {};
    for (const [sym, bars] of Object.entries(barsMap)) {
      const sorted = (bars as AlpacaBar[]).sort(
        (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
      );
      result.set(sym, sorted.map(b => ({
        date: new Date(b.t).toISOString().split("T")[0],
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      })));
    }
  } catch (e: any) {
    log(`Alpaca bulk daily bars fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

let cachedActiveSymbols: string[] | null = null;
let cachedAt = 0;

export async function fetchAllActiveEquitySymbols(): Promise<string[]> {
  const now = Date.now();
  if (cachedActiveSymbols && now - cachedAt < 24 * 60 * 60 * 1000) {
    return cachedActiveSymbols;
  }

  const url = "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity";
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      log(`Alpaca assets API error: ${res.status}`, "alpaca");
      return cachedActiveSymbols ?? [];
    }
    const data: any[] = await res.json();
    const symbols = data
      .filter((a: any) => {
        if (!a.tradable) return false;
        const sym = a.symbol as string;
        if (sym.length > 5 || sym.includes("/")) return false;
        const name = (a.name as string) || "";
        if (name.includes("Preferred") || name.includes("Warrant") ||
            name.includes("Unit") || name.includes("Rights")) return false;
        return true;
      })
      .map((a: any) => a.symbol as string);

    cachedActiveSymbols = symbols;
    cachedAt = now;
    log(`Alpaca: cached ${symbols.length} active equity symbols`, "alpaca");
    return symbols;
  } catch (e: any) {
    log(`Alpaca assets fetch failed: ${e.message}`, "alpaca");
    return cachedActiveSymbols ?? [];
  }
}

export async function fetchSnapshots(
  symbols: string[]
): Promise<Map<string, AlpacaSnapshot>> {
  const result = new Map<string, AlpacaSnapshot>();
  const symbolStr = symbols.join(",");
  const url = `${DATA_BASE_URL}/stocks/snapshots?symbols=${symbolStr}&feed=iex`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      log(`Alpaca snapshots error: ${res.status} ${text}`, "alpaca");
      return result;
    }
    const data = await res.json();
    for (const [sym, snap] of Object.entries(data)) {
      result.set(sym, snap as AlpacaSnapshot);
    }
  } catch (e: any) {
    log(`Alpaca snapshots fetch failed: ${e.message}`, "alpaca");
  }

  return result;
}

export interface LiveTradeUpdate {
  symbol: string;
  price: number;
  size: number;
  timestamp: number;
}

export interface LiveBarUpdate {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  vwap: number;
}

export interface LiveQuoteUpdate {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: number;
}

type TradeHandler = (trade: LiveTradeUpdate) => void;
type BarHandler = (bar: LiveBarUpdate) => void;
type QuoteHandler = (quote: LiveQuoteUpdate) => void;

export class AlpacaStream {
  private ws: WebSocket | null = null;
  private symbols: string[] = [];
  private onTrade: TradeHandler | null = null;
  private onBar: BarHandler | null = null;
  private onQuote: QuoteHandler | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private authenticated = false;
  private isRunning = false;

  constructor(symbols: string[]) {
    this.symbols = symbols;
  }

  setTradeHandler(handler: TradeHandler) {
    this.onTrade = handler;
  }

  setBarHandler(handler: BarHandler) {
    this.onBar = handler;
  }

  setQuoteHandler(handler: QuoteHandler) {
    this.onQuote = handler;
  }

  connect() {
    if (!isAlpacaConfigured()) {
      log("Alpaca API keys not configured, skipping live stream", "alpaca");
      return;
    }

    this.isRunning = true;
    this._connect();
  }

  private _connect() {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        log("Alpaca WebSocket connected", "alpaca");
      });

      this.ws.on("message", (raw) => {
        try {
          const messages = JSON.parse(raw.toString());
          if (!Array.isArray(messages)) return;

          for (const msg of messages) {
            if (msg.T === "success" && msg.msg === "connected") {
              this.ws?.send(
                JSON.stringify({
                  action: "auth",
                  key: ALPACA_API_KEY,
                  secret: ALPACA_API_SECRET,
                })
              );
            } else if (msg.T === "success" && msg.msg === "authenticated") {
              this.authenticated = true;
              log("Alpaca WebSocket authenticated", "alpaca");
              const tradeSymbols = this.symbols.slice(0, 30);
              const quoteSymbols = this.symbols.slice(0, 10);
              this.ws?.send(
                JSON.stringify({
                  action: "subscribe",
                  trades: tradeSymbols,
                  bars: tradeSymbols,
                  quotes: quoteSymbols,
                })
              );
            } else if (msg.T === "error") {
              log(`Alpaca WS error: ${msg.code} ${msg.msg}`, "alpaca");
            } else if (msg.T === "subscription") {
              log(
                `Alpaca subscribed - trades: ${msg.trades?.length || 0}, bars: ${msg.bars?.length || 0}, quotes: ${msg.quotes?.length || 0}`,
                "alpaca"
              );
            } else if (msg.T === "t" && this.onTrade) {
              this.onTrade({
                symbol: msg.S,
                price: msg.p,
                size: msg.s,
                timestamp: new Date(msg.t).getTime(),
              });
            } else if (msg.T === "b" && this.onBar) {
              this.onBar({
                symbol: msg.S,
                open: msg.o,
                high: msg.h,
                low: msg.l,
                close: msg.c,
                volume: msg.v,
                timestamp: new Date(msg.t).getTime(),
                vwap: msg.vw || 0,
              });
            } else if (msg.T === "q" && this.onQuote) {
              this.onQuote({
                symbol: msg.S,
                bidPrice: msg.bp,
                askPrice: msg.ap,
                bidSize: msg.bs,
                askSize: msg.as,
                timestamp: new Date(msg.t).getTime(),
              });
            }
          }
        } catch (e: any) {
          log(`Alpaca WS parse error: ${e.message}`, "alpaca");
        }
      });

      this.ws.on("close", () => {
        this.authenticated = false;
        log("Alpaca WebSocket disconnected", "alpaca");
        if (this.isRunning) {
          this.reconnectTimeout = setTimeout(() => this._connect(), 5000);
        }
      });

      this.ws.on("error", (err) => {
        log(`Alpaca WebSocket error: ${err.message}`, "alpaca");
        this.ws?.close();
      });
    } catch (e: any) {
      log(`Alpaca WS connection failed: ${e.message}`, "alpaca");
      if (this.isRunning) {
        this.reconnectTimeout = setTimeout(() => this._connect(), 5000);
      }
    }
  }

  disconnect() {
    this.isRunning = false;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }
}

export async function checkMarketClock(): Promise<{
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
}> {
  try {
    const res = await fetch("https://paper-api.alpaca.markets/v2/clock", {
      headers,
    });
    if (!res.ok) return { isOpen: false, nextOpen: null, nextClose: null };
    const data = await res.json();
    return {
      isOpen: data.is_open,
      nextOpen: data.next_open,
      nextClose: data.next_close,
    };
  } catch {
    return { isOpen: false, nextOpen: null, nextClose: null };
  }
}
