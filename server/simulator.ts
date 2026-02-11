import type { IStorage } from "./storage";
import { log } from "./index";
import {
  buildConfigFromUser,
  calculateATR,
  calculateVWAP,
  findResistance,
  detectCandlePattern,
  checkUniverseFilter,
  checkHigherTimeframeBias,
  checkBreakoutQualification,
  checkRetestRules,
  checkMarketRegime,
  checkVolatilityGate,
  computeScore,
  checkExitRules,
  type Candle,
  type StrategyConfig,
} from "./strategy";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy/config";
import {
  isAlpacaConfigured,
  fetchHistoricalBars,
  fetchMultipleHistoricalBars,
  fetchSnapshots,
  checkMarketClock,
  AlpacaStream,
  type LiveTradeUpdate,
  type LiveBarUpdate,
  type LiveQuoteUpdate,
} from "./alpaca";

interface SimulatedTicker {
  ticker: string;
  name: string;
  sector: string;
  basePrice: number;
  volatility: number;
  trend: number;
  avgDailyVolume: number;
}

const SIMULATED_TICKERS: SimulatedTicker[] = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", basePrice: 195.0, volatility: 0.25, trend: 0.015, avgDailyVolume: 55000000 },
  { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology", basePrice: 420.0, volatility: 0.22, trend: 0.018, avgDailyVolume: 22000000 },
  { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Technology", basePrice: 875.0, volatility: 0.35, trend: 0.025, avgDailyVolume: 45000000 },
  { ticker: "AMZN", name: "Amazon.com Inc.", sector: "Consumer", basePrice: 185.0, volatility: 0.25, trend: 0.015, avgDailyVolume: 38000000 },
  { ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", basePrice: 155.0, volatility: 0.22, trend: 0.012, avgDailyVolume: 25000000 },
  { ticker: "META", name: "Meta Platforms", sector: "Technology", basePrice: 505.0, volatility: 0.30, trend: 0.020, avgDailyVolume: 18000000 },
  { ticker: "TSLA", name: "Tesla Inc.", sector: "Consumer", basePrice: 245.0, volatility: 0.40, trend: 0.025, avgDailyVolume: 95000000 },
  { ticker: "SPY", name: "S&P 500 ETF", sector: "ETF", basePrice: 510.0, volatility: 0.10, trend: 0.005, avgDailyVolume: 75000000 },
  { ticker: "QQQ", name: "Nasdaq-100 ETF", sector: "ETF", basePrice: 440.0, volatility: 0.12, trend: 0.006, avgDailyVolume: 40000000 },
  { ticker: "AMD", name: "AMD Inc.", sector: "Technology", basePrice: 175.0, volatility: 0.35, trend: 0.022, avgDailyVolume: 48000000 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Finance", basePrice: 195.0, volatility: 0.18, trend: 0.010, avgDailyVolume: 10000000 },
  { ticker: "V", name: "Visa Inc.", sector: "Finance", basePrice: 280.0, volatility: 0.15, trend: 0.008, avgDailyVolume: 7000000 },
  { ticker: "NFLX", name: "Netflix Inc.", sector: "Technology", basePrice: 620.0, volatility: 0.30, trend: 0.018, avgDailyVolume: 5500000 },
  { ticker: "CRM", name: "Salesforce Inc.", sector: "Technology", basePrice: 265.0, volatility: 0.25, trend: 0.015, avgDailyVolume: 6000000 },
  { ticker: "AVGO", name: "Broadcom Inc.", sector: "Technology", basePrice: 1350.0, volatility: 0.28, trend: 0.020, avgDailyVolume: 3200000 },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare", basePrice: 780.0, volatility: 0.22, trend: 0.015, avgDailyVolume: 3000000 },
];

const DEMO_CONFIG: StrategyConfig = {
  universe: {
    minPrice: 5,
    minAvgDollarVolume: 1_000_000,
    maxSpreadPct: 1.0,
    minDailyATRpct: 0.1,
    minRVOL: 0.1,
    rvolCutoffMinutes: 60,
  },
  higherTimeframe: {
    requiredConfirmations: 0,
  },
  breakout: {
    minBodyPct: 0.10,
    minVolumeMultiplier: 0.1,
    minRangeMultiplier: 0.1,
    bufferPct: 0.01,
  },
  retest: {
    maxPullbackPct: 95,
    tolerancePct: 2.0,
    entryMode: "aggressive" as const,
  },
  marketRegime: {
    maxVwapCrosses: 50,
    vwapCrossWindowMinutes: 60,
    chopSizeReduction: 1.0,
  },
  volatilityGate: {
    firstRangeMinPct: 1,
    atrExpansionMultiplier: 0.1,
  },
  scoring: {
    rvolThreshold: 0.1,
    breakoutVolumeThreshold: 0.1,
    fullSizeMin: 10,
    halfSizeMin: 5,
  },
  exits: {
    partialAtR: 1.0,
    partialPct: 50,
    useEMA9Trail: true,
    usePriorLowTrail: true,
    hardExitRedCandles: 2,
  },
  risk: {
    perTradeRiskPct: 1.0,
    maxPositionPct: 10,
    maxDailyLossPct: 10,
    maxLosingTrades: 20,
    cooldownMinutes: 0.1,
    timeStopMinutes: 5,
    timeStopR: 0.1,
  },
  riskMode: "balanced",
  powerSetupEnabled: true,
};

interface PriceState {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  bars5m: Candle[];
  bars15m: Candle[];
  bars1h: Candle[];
  signalState: "IDLE" | "BREAKOUT" | "RETEST" | "TRIGGERED";
  resistanceLevel: number | null;
  breakoutCandle: Candle | null;
  retestBars: Candle[];
  retestSwingLow: number | null;
  barCount: number;
  dayVolume: number;
  changePct: number;
  rvol: number;
  atr14: number;
  vwap: number;
  prevDayHigh: number;
  premarketHigh: number;
  yesterdayRange: number;
  dailyATRbaseline: number;
  spreadPct: number;
  minutesSinceOpen: number;
  lastScore: number;
  lastScoreTier: string;
  trendPhase: "rally" | "pullback" | "consolidation";
  trendPhaseBars: number;
  lastBreakoutTime: number;
  relStrengthVsSpy: number;
}

const priceStates = new Map<string, PriceState>();
let currentDataSource: "live" | "simulated" = "simulated";
let alpacaStream: AlpacaStream | null = null;
let marketIsOpen = false;

export function getDataSource(): "live" | "simulated" {
  return currentDataSource;
}

export function isLiveConnected(): boolean {
  return alpacaStream?.isConnected() ?? false;
}

function initializePriceState(ticker: SimulatedTicker): PriceState {
  const variance = (Math.random() - 0.5) * ticker.basePrice * 0.02;
  const price = ticker.basePrice + variance;
  const yesterdayRange = ticker.basePrice * ticker.volatility * 6;
  return {
    ticker: ticker.ticker,
    price,
    open: price,
    high: price,
    low: price,
    volume: Math.floor(Math.random() * 500000 + 200000),
    bars5m: [],
    bars15m: [],
    bars1h: [],
    signalState: "IDLE",
    resistanceLevel: null,
    breakoutCandle: null,
    retestBars: [],
    retestSwingLow: null,
    barCount: 0,
    dayVolume: Math.floor(Math.random() * 5000000 + 2000000),
    changePct: 0,
    rvol: 1.5 + Math.random() * 2.0,
    atr14: 0,
    vwap: price,
    prevDayHigh: price * (1 + Math.random() * 0.015),
    premarketHigh: price * (1 + Math.random() * 0.01),
    yesterdayRange,
    dailyATRbaseline: yesterdayRange * 0.15,
    spreadPct: 0.01 + Math.random() * 0.02,
    minutesSinceOpen: 30,
    lastScore: 0,
    lastScoreTier: "pass",
    trendPhase: "rally",
    trendPhaseBars: 0,
    lastBreakoutTime: 0,
    relStrengthVsSpy: 0,
  };
}

function simulatePriceMove(state: PriceState, ticker: SimulatedTicker): void {
  let drift = ticker.trend;
  let volScale = 1.0;

  if (state.trendPhase === "rally") {
    drift = Math.abs(ticker.trend) * 10;
    volScale = 4.0;
  } else if (state.trendPhase === "pullback") {
    drift = -Math.abs(ticker.trend) * 8;
    volScale = 3.0;
  } else {
    drift = ticker.trend * 2;
    volScale = 2.0;
  }

  const vol = ticker.volatility * volScale;
  const rand = (Math.random() - 0.5) * 4;
  const change = state.price * (drift + vol * rand);
  state.price = Math.max(state.price + change, 1);
  state.high = Math.max(state.high, state.price);
  state.low = Math.min(state.low, state.price);
  const tickVol = Math.floor(Math.random() * 30000 + 5000);
  state.volume += tickVol;
  state.dayVolume += tickVol;
  state.changePct = ((state.price - ticker.basePrice) / ticker.basePrice) * 100;
  const expectedVolSoFar = ticker.avgDailyVolume * 0.15;
  state.rvol = expectedVolSoFar > 0 ? state.dayVolume / expectedVolSoFar : 2.0;
}

function createBreakoutCandle(state: PriceState, resistance: number): Candle {
  const range = state.price * 0.008;
  const openPrice = resistance - range * 0.2;
  const closePrice = resistance + range * 0.3;
  const highPrice = closePrice + range * 0.1;
  const lowPrice = openPrice - range * 0.1;
  const vol = Math.floor(state.volume * (2.0 + Math.random()));

  state.price = closePrice;
  state.high = Math.max(state.high, highPrice);
  state.low = Math.min(state.low, lowPrice);

  return {
    open: openPrice,
    high: highPrice,
    low: lowPrice,
    close: closePrice,
    volume: vol,
    timestamp: Date.now(),
  };
}

function createRetestCandle(state: PriceState, resistance: number): Candle {
  const range = state.price * 0.003;
  const tolerance = resistance * 0.002;
  const closePrice = resistance + tolerance * (Math.random() * 0.5);
  const lowPrice = resistance - tolerance;
  const openPrice = closePrice + range * 0.3;
  const highPrice = openPrice + range * 0.1;
  const vol = Math.floor(state.volume * 0.6);

  state.price = closePrice;
  state.low = Math.min(state.low, lowPrice);

  return {
    open: openPrice,
    high: highPrice,
    low: lowPrice,
    close: closePrice,
    volume: vol,
    timestamp: Date.now(),
  };
}

function create5mCandle(state: PriceState): Candle {
  const candle: Candle = {
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.price,
    volume: state.volume,
    timestamp: Date.now(),
  };
  state.bars5m.push(candle);
  if (state.bars5m.length > 200) state.bars5m.shift();
  state.open = state.price;
  state.high = state.price;
  state.low = state.price;
  state.volume = Math.floor(Math.random() * 80000 + 20000);
  state.barCount++;
  state.minutesSinceOpen += 5;

  if (state.barCount % 3 === 0 && state.bars5m.length >= 3) {
    const last3 = state.bars5m.slice(-3);
    const bar15m: Candle = {
      open: last3[0].open,
      high: Math.max(...last3.map((c) => c.high)),
      low: Math.min(...last3.map((c) => c.low)),
      close: last3[last3.length - 1].close,
      volume: last3.reduce((s, c) => s + c.volume, 0),
      timestamp: candle.timestamp,
    };
    state.bars15m.push(bar15m);
    if (state.bars15m.length > 100) state.bars15m.shift();
  }

  if (state.barCount % 12 === 0) {
    state.bars1h.push({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.timestamp,
    });
    if (state.bars1h.length > 60) state.bars1h.shift();
  }

  state.vwap = calculateVWAP(state.bars5m);
  state.atr14 = calculateATR(state.bars5m, 14);

  return candle;
}

function isLunchChop(): boolean {
  return false;
}

let activeUserIds: Set<string> = new Set();

export function registerUser(userId: string) {
  activeUserIds.add(userId);
}

export function unregisterUser(userId: string) {
  activeUserIds.delete(userId);
}

export interface ScannerItem {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  volume: number;
  avgDailyVolume: number;
  dollarVolume: number;
  rvol: number;
  atr14: number;
  signalState: string;
  resistanceLevel: number | null;
  passesFilters: boolean;
  trend1H: boolean;
  spreadPct: number;
  dailyATRpct: number;
  vwap: number;
  score: number;
  scoreTier: string;
}

export function getScannerData(filters: {
  minPrice: number;
  minAvgVolume: number;
  minDollarVolume: number;
}): ScannerItem[] {
  const items: ScannerItem[] = [];

  for (const tickerConfig of SIMULATED_TICKERS) {
    const state = priceStates.get(tickerConfig.ticker);
    if (!state) continue;

    const dollarVolume = state.price * tickerConfig.avgDailyVolume;
    const dailyATRpct = state.price > 0 ? (state.atr14 / state.price) * 100 : 0;

    const passesFilters =
      state.price >= filters.minPrice &&
      tickerConfig.avgDailyVolume >= filters.minAvgVolume &&
      dollarVolume >= filters.minDollarVolume;

    const biasResult = checkHigherTimeframeBias(
      state.bars15m,
      state.prevDayHigh,
      state.premarketHigh,
      state.price,
      DEMO_CONFIG.higherTimeframe
    );

    items.push({
      ticker: state.ticker,
      name: tickerConfig.name,
      sector: tickerConfig.sector,
      price: Number(state.price.toFixed(2)),
      changePct: Number(state.changePct.toFixed(2)),
      volume: state.dayVolume,
      avgDailyVolume: tickerConfig.avgDailyVolume,
      dollarVolume: Number(dollarVolume.toFixed(0)),
      rvol: Number(state.rvol.toFixed(2)),
      atr14: Number(state.atr14.toFixed(2)),
      signalState: state.signalState,
      resistanceLevel: state.resistanceLevel ? Number(state.resistanceLevel.toFixed(2)) : null,
      passesFilters,
      trend1H: biasResult.aligned,
      spreadPct: Number(state.spreadPct.toFixed(3)),
      dailyATRpct: Number(dailyATRpct.toFixed(2)),
      vwap: Number(state.vwap.toFixed(2)),
      score: state.lastScore,
      scoreTier: state.lastScoreTier,
    });
  }

  return items.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

async function initializeLiveData(): Promise<boolean> {
  if (!isAlpacaConfigured()) {
    log("Alpaca not configured, using simulated data", "alpaca");
    return false;
  }

  try {
    const clock = await checkMarketClock();
    marketIsOpen = clock.isOpen;
    log(`Market is ${marketIsOpen ? "OPEN" : "CLOSED"}. Next open: ${clock.nextOpen}`, "alpaca");

    const allSymbols = SIMULATED_TICKERS.map((t) => t.ticker);

    log("Fetching historical 5m bars from Alpaca...", "alpaca");
    const bars5mMap = await fetchMultipleHistoricalBars(allSymbols, "5Min", 100);

    log("Fetching historical 15m bars from Alpaca...", "alpaca");
    const bars15mMap = await fetchMultipleHistoricalBars(allSymbols, "15Min", 50);

    log("Fetching snapshots from Alpaca...", "alpaca");
    const snapshots = await fetchSnapshots(allSymbols);

    let liveCount = 0;
    for (const tickerConfig of SIMULATED_TICKERS) {
      const sym = tickerConfig.ticker;
      const bars5m = bars5mMap.get(sym) || [];
      const bars15m = bars15mMap.get(sym) || [];
      const snap = snapshots.get(sym);

      if (bars5m.length === 0 && !snap) continue;

      const state = priceStates.get(sym);
      if (!state) continue;

      if (bars5m.length > 0) {
        state.bars5m = bars5m.slice(-200);
        const lastBar = bars5m[bars5m.length - 1];
        state.price = lastBar.close;
        state.high = Math.max(...bars5m.slice(-20).map((b) => b.high));
        state.low = Math.min(...bars5m.slice(-20).map((b) => b.low));
        state.open = bars5m.length >= 78 ? bars5m[bars5m.length - 78].open : bars5m[0].open;
        state.atr14 = calculateATR(state.bars5m, 14);
        state.vwap = calculateVWAP(state.bars5m);
        state.dayVolume = bars5m.slice(-78).reduce((s, b) => s + b.volume, 0);
        state.changePct = ((state.price - state.open) / state.open) * 100;
      }

      if (bars15m.length > 0) {
        state.bars15m = bars15m.slice(-100);
      }

      if (snap) {
        if (snap.latestTrade) {
          state.price = snap.latestTrade.p;
        }
        if (snap.latestQuote) {
          const mid = (snap.latestQuote.bp + snap.latestQuote.ap) / 2;
          state.spreadPct = mid > 0 ? ((snap.latestQuote.ap - snap.latestQuote.bp) / mid) * 100 : 0.02;
        }
        if (snap.prevDailyBar) {
          state.prevDayHigh = snap.prevDailyBar.h;
          state.yesterdayRange = snap.prevDailyBar.h - snap.prevDailyBar.l;
          state.dailyATRbaseline = state.yesterdayRange * 0.15;
        }
        if (snap.dailyBar) {
          state.dayVolume = snap.dailyBar.v;
        }
      }

      const expectedVolSoFar = tickerConfig.avgDailyVolume * 0.4;
      state.rvol = expectedVolSoFar > 0 ? state.dayVolume / expectedVolSoFar : 1.5;

      liveCount++;
    }

    if (liveCount > 0) {
      log(`Loaded live data for ${liveCount}/${allSymbols.length} symbols`, "alpaca");
      return true;
    } else {
      log("No live data available from Alpaca, falling back to simulator", "alpaca");
      return false;
    }
  } catch (e: any) {
    log(`Alpaca initialization failed: ${e.message}`, "alpaca");
    return false;
  }
}

function startAlpacaStream(broadcast: (type: string, data: any) => void) {
  const symbols = SIMULATED_TICKERS.map((t) => t.ticker);
  alpacaStream = new AlpacaStream(symbols);

  alpacaStream.setTradeHandler((trade: LiveTradeUpdate) => {
    const state = priceStates.get(trade.symbol);
    if (!state) return;

    state.price = trade.price;
    state.high = Math.max(state.high, trade.price);
    state.low = Math.min(state.low, trade.price);
    state.dayVolume += trade.size;

    const tickerConfig = SIMULATED_TICKERS.find((t) => t.ticker === trade.symbol);
    if (tickerConfig) {
      state.changePct = ((trade.price - state.open) / state.open) * 100;
      const expectedVolSoFar = tickerConfig.avgDailyVolume * 0.4;
      state.rvol = expectedVolSoFar > 0 ? state.dayVolume / expectedVolSoFar : 1.5;
    }
  });

  alpacaStream.setBarHandler((bar: LiveBarUpdate) => {
    const state = priceStates.get(bar.symbol);
    if (!state) return;

    const candle: Candle = {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      timestamp: bar.timestamp,
    };

    state.bars5m.push(candle);
    if (state.bars5m.length > 200) state.bars5m.shift();
    state.barCount++;

    if (state.barCount % 3 === 0 && state.bars5m.length >= 3) {
      const last3 = state.bars5m.slice(-3);
      const bar15m: Candle = {
        open: last3[0].open,
        high: Math.max(...last3.map((b) => b.high)),
        low: Math.min(...last3.map((b) => b.low)),
        close: last3[2].close,
        volume: last3.reduce((s, b) => s + b.volume, 0),
        timestamp: last3[0].timestamp,
      };
      state.bars15m.push(bar15m);
      if (state.bars15m.length > 100) state.bars15m.shift();
    }

    state.atr14 = calculateATR(state.bars5m, 14);
    state.vwap = calculateVWAP(state.bars5m);
    state.price = bar.close;
  });

  alpacaStream.setQuoteHandler((quote: LiveQuoteUpdate) => {
    const state = priceStates.get(quote.symbol);
    if (!state) return;

    const mid = (quote.bidPrice + quote.askPrice) / 2;
    if (mid > 0) {
      state.spreadPct = ((quote.askPrice - quote.bidPrice) / mid) * 100;
    }
  });

  alpacaStream.connect();
  log("Alpaca live stream started", "alpaca");
}

export async function startSimulatedDataFeed(
  broadcast: (type: string, data: any) => void,
  storage: IStorage
) {
  for (const ticker of SIMULATED_TICKERS) {
    const state = initializePriceState(ticker);
    for (let i = 0; i < 60; i++) {
      simulatePriceMove(state, ticker);
      if (i % 5 === 4) create5mCandle(state);
    }
    state.atr14 = calculateATR(state.bars5m, 14);
    state.vwap = calculateVWAP(state.bars5m);
    priceStates.set(ticker.ticker, state);
  }

  const liveDataLoaded = await initializeLiveData();
  if (liveDataLoaded) {
    currentDataSource = "live";
    startAlpacaStream(broadcast);
    log("Running with LIVE market data from Alpaca", "alpaca");
  } else {
    currentDataSource = "simulated";
    log("Running with SIMULATED market data", "simulator");
  }

  setInterval(async () => {
    const clock = await checkMarketClock().catch(() => ({ isOpen: false, nextOpen: null, nextClose: null }));
    const wasOpen = marketIsOpen;
    marketIsOpen = clock.isOpen;

    if (marketIsOpen && !wasOpen && isAlpacaConfigured()) {
      const loaded = await initializeLiveData();
      if (loaded) {
        currentDataSource = "live";
        if (!alpacaStream?.isConnected()) {
          startAlpacaStream(broadcast);
        }
        log("Market opened - switched to LIVE data", "alpaca");
      }
    } else if (!marketIsOpen && wasOpen) {
      currentDataSource = "simulated";
      log("Market closed - switched to SIMULATED data", "simulator");
    }
  }, 60000);

  let tickCount = 0;

  setInterval(async () => {
    tickCount++;
    const priceUpdates: any[] = [];

    const spyState = priceStates.get("SPY");
    const spyBars5m = spyState?.bars5m ?? [];

    const regimeResult = checkMarketRegime(spyBars5m, DEFAULT_STRATEGY_CONFIG.marketRegime);

    const volGateResult = checkVolatilityGate(
      spyBars5m,
      spyState?.yesterdayRange ?? 0,
      spyState?.dailyATRbaseline ?? 0,
      DEFAULT_STRATEGY_CONFIG.volatilityGate
    );

    for (const tickerConfig of SIMULATED_TICKERS) {
      const state = priceStates.get(tickerConfig.ticker);
      if (!state) continue;

      if (currentDataSource === "simulated") {
        simulatePriceMove(state, tickerConfig);
      }

      priceUpdates.push({
        ticker: state.ticker,
        price: Number(state.price.toFixed(2)),
        change: Number(state.changePct.toFixed(2)),
        volume: state.dayVolume,
        rvol: Number(state.rvol.toFixed(2)),
        dataSource: currentDataSource,
      });

      if (tickCount % 5 === 0) {
        let candle: Candle;

        if (currentDataSource === "simulated") {
          state.trendPhaseBars++;

          if (state.trendPhase === "rally" && state.trendPhaseBars > 1 + Math.floor(Math.random() * 2)) {
            state.trendPhase = "pullback";
            state.trendPhaseBars = 0;
          } else if (state.trendPhase === "pullback" && state.trendPhaseBars > 1) {
            state.trendPhase = Math.random() > 0.2 ? "rally" : "consolidation";
            state.trendPhaseBars = 0;
          } else if (state.trendPhase === "consolidation" && state.trendPhaseBars > 1) {
            state.trendPhase = "rally";
            state.trendPhaseBars = 0;
          }

          candle = create5mCandle(state);
        } else {
          candle = state.bars5m.length > 0 ? state.bars5m[state.bars5m.length - 1] : create5mCandle(state);
        }

        if (tickerConfig.ticker === "SPY" || tickerConfig.ticker === "QQQ") continue;

        const resistance = findResistance(state.bars5m, 30);
        if (resistance) {
          state.resistanceLevel = resistance.level;
        } else if (!state.resistanceLevel) {
          state.resistanceLevel = state.price * (1 + 0.003 + Math.random() * 0.005);
        }

        const biasResult = checkHigherTimeframeBias(
          state.bars15m,
          state.prevDayHigh,
          state.premarketHigh,
          state.price,
          DEFAULT_STRATEGY_CONFIG.higherTimeframe
        );

        const dollarVolume = state.price * tickerConfig.avgDailyVolume;

        const userIds = Array.from(activeUserIds);
        for (const userId of userIds) {
          try {
            const user = await storage.getUser(userId);
            if (!user) continue;

            const config = buildConfigFromUser(user);

            const universeResult = checkUniverseFilter(
              state.price,
              dollarVolume,
              state.spreadPct,
              state.bars1h.length > 0 ? state.bars1h : state.bars5m,
              state.rvol,
              state.minutesSinceOpen,
              config.universe,
              config.riskMode
            );

            // RELATIVE STRENGTH VS SPY
            const spyCandles = spyBars5m.slice(-20);
            const tickerCandles = state.bars5m.slice(-20);
            let relStrengthVsSpy = 0;
            if (spyCandles.length > 0 && tickerCandles.length > 0) {
              const spyMove = (spyCandles[spyCandles.length - 1].close / spyCandles[0].open) - 1;
              const tickerMove = (tickerCandles[tickerCandles.length - 1].close / tickerCandles[0].open) - 1;
              relStrengthVsSpy = tickerMove - spyMove;
            }
            state.relStrengthVsSpy = relStrengthVsSpy;

            const minSinceOpen = state.minutesSinceOpen;
            const inWindow = (minSinceOpen >= 15 && minSinceOpen <= 90) || (minSinceOpen >= 240 && minSinceOpen <= 375);

            const trades = await storage.getTrades(userId);
            const todayET = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
            const todayTrades = trades.filter(t => t.exitedAt && new Date(t.exitedAt).toLocaleDateString("en-US", { timeZone: "America/New_York" }) === todayET);
            const lossCount = todayTrades.filter(t => (t.pnl ?? 0) < 0).length;
            const netR = todayTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);
            const tradingLocked = lossCount >= config.risk.maxLosingTrades || netR <= -3;

            const passesStrategy =
              universeResult.passes &&
              biasResult.aligned &&
              regimeResult.aligned &&
              volGateResult.passes &&
              relStrengthVsSpy > 0 &&
              inWindow &&
              !tradingLocked;

            const hasOpenTrade = trades.some((t) => t.status === "open" && t.ticker === state.ticker);
            const timeSinceLastBreakout = Date.now() - state.lastBreakoutTime;
            const cooldownMs = config.risk.cooldownMinutes * 60 * 1000;

            if (state.signalState === "IDLE" && state.resistanceLevel && timeSinceLastBreakout > cooldownMs && !hasOpenTrade) {
              let shouldBreakout = false;
              let boCandle: Candle;

              if (currentDataSource === "live") {
                const recentCandle = state.bars5m.length > 0 ? state.bars5m[state.bars5m.length - 1] : null;
                if (recentCandle && recentCandle.close > state.resistanceLevel) {
                  shouldBreakout = true;
                  boCandle = recentCandle;
                } else {
                  boCandle = candle;
                }
              } else {
                const nearResistance = state.price >= state.resistanceLevel * 0.998;
                shouldBreakout = nearResistance || (state.trendPhase === "rally" && Math.random() > 0.2) || Math.random() > 0.6;
                boCandle = createBreakoutCandle(state, state.resistanceLevel);
              }

              if (shouldBreakout) {
                if (currentDataSource === "simulated") {
                  state.bars5m.push(boCandle);
                  if (state.bars5m.length > 200) state.bars5m.shift();
                  state.barCount++;
                  state.vwap = calculateVWAP(state.bars5m);
                  state.atr14 = calculateATR(state.bars5m, 14);
                }

                const breakoutResult = checkBreakoutQualification(
                  boCandle,
                  state.bars5m.slice(0, -1),
                  state.resistanceLevel,
                  config.breakout
                );

                if (breakoutResult.qualified) {
                  state.signalState = "BREAKOUT";
                  state.breakoutCandle = boCandle;
                  state.lastBreakoutTime = Date.now();

                  const rejections = resistance?.rejections ?? 2;
                  const isPowerSetup = config.powerSetupEnabled &&
                    breakoutResult.metrics.volumeMultiplier >= 2.0 &&
                    relStrengthVsSpy > 0 &&
                    !todayTrades.some(t => t.isPowerSetup);

                  const scoreResult = computeScore(
                    state.rvol,
                    biasResult,
                    breakoutResult.metrics.volumeMultiplier,
                    false,
                    regimeResult,
                    true,
                    Math.random() > 0.6,
                    config.scoring,
                    isPowerSetup
                  );

                  state.lastScore = scoreResult.score;
                  state.lastScoreTier = scoreResult.tier;

                  if (scoreResult.tier === "pass") {
                    state.signalState = "IDLE";
                    continue;
                  }

                  const signalData = {
                    ticker: state.ticker,
                    state: "BREAKOUT" as const,
                    resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
                    currentPrice: Number(state.price.toFixed(2)),
                    breakoutPrice: Number(state.price.toFixed(2)),
                    breakoutVolume: boCandle.volume,
                    trendConfirmed: biasResult.aligned,
                    volumeConfirmed: breakoutResult.metrics.volumeMultiplier >= 0.8,
                    atrExpansion: true,
                    timeframe: "5m",
                    rvol: Number(state.rvol.toFixed(2)),
                    atrValue: Number(state.atr14.toFixed(4)),
                    rejectionCount: rejections,
                    score: scoreResult.score,
                    scoreTier: scoreResult.tier,
                    marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                    spyAligned: regimeResult.aligned,
                    volatilityGatePassed: volGateResult.passes,
                    scoreBreakdown: scoreResult.breakdown,
                    relStrengthVsSpy: Number(relStrengthVsSpy.toFixed(4)),
                    isPowerSetup,
                    notes: `SETUP forming: Breakout above $${state.resistanceLevel.toFixed(2)}. Score ${scoreResult.score}/100. RVOL ${state.rvol.toFixed(1)}x. SPY ${regimeResult.aligned ? "aligned" : "misaligned"}.`,
                  };

                  broadcast("signal_update", signalData);
                  await storage.createSignal({ userId, ...signalData });
                  await storage.createAlert({
                    userId,
                    ticker: state.ticker,
                    type: "SETUP",
                    title: `SETUP forming (Score ${scoreResult.score})`,
                    message: `${state.ticker} breakout above $${state.resistanceLevel.toFixed(2)}.`,
                    priority: "high",
                    isRead: false,
                  });
                }
              }
            }

            if (state.signalState === "BREAKOUT" && state.resistanceLevel && state.breakoutCandle) {
              let retCandle: Candle;
              if (currentDataSource === "live") {
                retCandle = state.bars5m.length > 0 ? state.bars5m[state.bars5m.length - 1] : candle;
              } else {
                retCandle = createRetestCandle(state, state.resistanceLevel);
                state.bars5m.push(retCandle);
                if (state.bars5m.length > 200) state.bars5m.shift();
                state.barCount++;
                state.vwap = calculateVWAP(state.bars5m);
                state.atr14 = calculateATR(state.bars5m, 14);
              }

              state.signalState = "RETEST";
              state.retestSwingLow = retCandle.low;
              state.retestBars = [retCandle];

              broadcast("signal_update", { ticker: state.ticker, state: "RETEST", resistanceLevel: state.resistanceLevel, price: state.price });
              await storage.createAlert({
                userId, ticker: state.ticker, type: "RETEST",
                title: "Retest in Progress", message: `${state.ticker} pulling back to $${state.resistanceLevel.toFixed(2)}.`,
                priority: "medium", isRead: false,
              });
            }

            if (state.signalState === "RETEST" && state.resistanceLevel && state.breakoutCandle) {
              state.retestBars.push(candle);
              if (state.low < (state.retestSwingLow ?? state.low)) state.retestSwingLow = state.low;

              const retestResult = checkRetestRules(candle, state.breakoutCandle, state.retestBars, state.resistanceLevel, state.bars5m, config.retest);

              if (retestResult.valid && retestResult.entryPrice && retestResult.stopPrice && passesStrategy) {
                const riskPerShare = Math.abs(retestResult.entryPrice - retestResult.stopPrice);
                const dollarRiskPerTrade = (user.accountSize ?? 100000) * (config.risk.perTradeRiskPct / 100);
                let shares = Math.floor(dollarRiskPerTrade / riskPerShare);
                
                const isPowerSetup = config.powerSetupEnabled && breakoutResult.metrics.volumeMultiplier >= 2.0 && relStrengthVsSpy > 0;
                if (isPowerSetup) shares = Math.floor(shares * 1.25);

                const maxPosSize = (user.accountSize ?? 100000) * (config.risk.maxPositionPct / 100);
                if (shares * retestResult.entryPrice > maxPosSize) shares = Math.floor(maxPosSize / retestResult.entryPrice);

                if (shares > 0) {
                  state.signalState = "TRIGGERED";
                  const target1 = retestResult.entryPrice + (riskPerShare * config.exits.partialAtR);
                  const target2 = retestResult.entryPrice + (riskPerShare * 2.5);

                  const trade = await storage.createTrade({
                    userId, ticker: state.ticker, side: "long",
                    entryPrice: retestResult.entryPrice, stopPrice: retestResult.stopPrice,
                    originalStopPrice: retestResult.stopPrice, target1, target2, shares,
                    status: "open", score: state.lastScore, scoreTier: state.lastScoreTier,
                    entryMode: config.retest.entryMode, dollarRisk: shares * riskPerShare,
                    isPowerSetup,
                  });

                  broadcast("trade_update", trade);
                  await storage.createAlert({
                    userId, ticker: state.ticker, type: "TRIGGER",
                    title: `TRIGGER hit - Score ${state.lastScore}`,
                    message: `${state.ticker} triggered at $${retestResult.entryPrice.toFixed(2)}.`,
                    priority: "high", isRead: false,
                  });
                }
              }
            }

            const openTrades = trades.filter((t) => t.status === "open" && t.ticker === state.ticker);
            for (const trade of openTrades) {
              const minutesSinceEntry = Math.floor((Date.now() - new Date(trade.enteredAt!).getTime()) / 60000);
              const riskPerShare = Math.abs(trade.entryPrice - trade.stopPrice);
              
              const exitDecision = checkExitRules(
                candle, state.bars5m, trade.entryPrice, trade.stopPrice, trade.shares,
                trade.isPartiallyExited ?? false, riskPerShare, minutesSinceEntry,
                config.exits, config.risk, config.riskMode, state.atr14
              );

              if (exitDecision.shouldExit) {
                if (exitDecision.exitType === "partial") {
                  await storage.updateTrade(trade.id, {
                    isPartiallyExited: true, partialExitPrice: exitDecision.exitPrice!,
                    partialExitShares: exitDecision.partialShares!, stopPrice: exitDecision.newStopPrice!,
                    runnerShares: trade.shares - exitDecision.partialShares!,
                  });
                } else {
                  const pnl = (exitDecision.exitPrice! - trade.entryPrice) * trade.shares;
                  const realizedR = (exitDecision.exitPrice! - trade.entryPrice) / riskPerShare;
                  await storage.updateTrade(trade.id, {
                    status: "closed", exitPrice: exitDecision.exitPrice!, exitedAt: new Date(),
                    exitReason: exitDecision.exitType!, pnl, realizedR,
                    pnlPercent: ((exitDecision.exitPrice! - trade.entryPrice) / trade.entryPrice) * 100,
                  });
                  await storage.upsertDailySummary(userId, pnl, pnl >= 0, (user.accountSize ?? 100000) + pnl);
                }
              } else if (exitDecision.newStopPrice) {
                await storage.updateTrade(trade.id, { stopPrice: exitDecision.newStopPrice });
              }
            }
          } catch (e) {}
        }
      }
    }

    broadcast("price_update", priceUpdates);
    broadcast("market_status", { isOpen: marketIsOpen, isLunchChop: isLunchChop(), spyAligned: regimeResult.aligned, spyChopping: regimeResult.chopping });
  }, 2000);
}
