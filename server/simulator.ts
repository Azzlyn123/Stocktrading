import type { IStorage } from "./storage";
import { log } from "./index";
import {
  buildConfigFromUser,
  buildTieredConfigFromUser,
  calculateATR,
  calculateVWAP,
  lastEMA,
  findResistance,
  detectCandlePattern,
  checkUniverseFilter,
  checkHigherTimeframeBias,
  checkBreakoutQualification,
  checkTieredBreakout,
  checkRetestRules,
  checkTieredRetest,
  checkMarketRegime,
  checkVolatilityGate,
  computeScore,
  checkExitRules,
  checkTieredExitRules,
  selectTier,
  DEFAULT_TIERED_CONFIG,
  type Candle,
  type StrategyConfig,
  type TieredStrategyConfig,
  type TradeTier,
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

const TIERED_CONFIG = DEFAULT_TIERED_CONFIG;

/** @deprecated Use TIERED_CONFIG instead. Kept for backward compatibility. */
const DEMO_CONFIG: StrategyConfig = {
  universe: {
    minPrice: 10,
    minAvgDollarVolume: 100_000_000,
    maxSpreadPct: 0.05,
    minDailyATRpct: 1.2,
    minRVOL: 1.5,
    rvolCutoffMinutes: 60,
  },
  higherTimeframe: {
    requiredConfirmations: 2,
  },
  breakout: {
    minBodyPct: 0.55,
    minVolumeMultiplier: 1.5,
    minRangeMultiplier: 1.0,
    bufferPct: 0.02,
  },
  retest: {
    maxPullbackPct: 55,
    tolerancePct: 1.0,
    entryMode: "conservative" as const,
  },
  marketRegime: {
    maxVwapCrosses: 3,
    vwapCrossWindowMinutes: 20,
    chopSizeReduction: 0.5,
  },
  volatilityGate: {
    firstRangeMinPct: 70,
    atrExpansionMultiplier: 1.3,
  },
  scoring: {
    rvolThreshold: 1.5,
    breakoutVolumeThreshold: 1.8,
    fullSizeMin: 80,
    halfSizeMin: 65,
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
    maxPositionPct: 5,
    maxDailyLossPct: 6,
    maxLosingTrades: 3,
    cooldownMinutes: 15,
    timeStopMinutes: 30,
    timeStopR: 0.5,
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
  selectedTier: TradeTier | null;
  retestBarsSinceBreakout: number;
  confirmationCandle: Candle | null;
  scaleFactor: number;
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
    selectedTier: null,
    retestBarsSinceBreakout: 0,
    confirmationCandle: null,
    scaleFactor: 1,
  };
}

function simulatePriceMove(state: PriceState, ticker: SimulatedTicker): void {
  let drift = ticker.trend;
  let volScale = 1.0;

  if (state.trendPhase === "rally") {
    drift = Math.abs(ticker.trend) * 5;
    volScale = 1.8;
  } else if (state.trendPhase === "pullback") {
    drift = -Math.abs(ticker.trend) * 2;
    volScale = 1.2;
  } else {
    drift = ticker.trend * 0.3;
    volScale = 0.8;
  }

  const vol = ticker.volatility * volScale * 0.15;
  const rand = (Math.random() - 0.5) * 2;
  const change = state.price * (drift * 0.01 + vol * rand);
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

let sharedUserId: string | null = null;

export function registerUser(userId: string) {
  if (!sharedUserId) {
    sharedUserId = userId;
  }
}

export function unregisterUser(userId: string) {
}

export function getSharedUserId(): string | null {
  return sharedUserId;
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
  tier: TradeTier | null;
  volRatio: number;
  atrRatio: number;
  distanceToResistancePct: number | null;
  selectedTier: TradeTier | null;
  blockedReasons: string[];
  relStrengthVsSpy: number;
  spyAligned: boolean;
  inSession: boolean;
}

export function getScannerData(filters: {
  minPrice: number;
  minAvgVolume: number;
  minDollarVolume: number;
}): ScannerItem[] {
  const items: ScannerItem[] = [];

  const spyState = priceStates.get("SPY");
  const spyBars5m = spyState?.bars5m ?? [];
  const regimeResult = checkMarketRegime(spyBars5m, DEFAULT_STRATEGY_CONFIG.marketRegime);
  const inSession = isInTradingSession(TIERED_CONFIG);

  for (const tickerConfig of SIMULATED_TICKERS) {
    const state = priceStates.get(tickerConfig.ticker);
    if (!state) continue;
    if (tickerConfig.ticker === "SPY" || tickerConfig.ticker === "QQQ") continue;

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

    const avgVol = state.bars5m.length > 0 ? state.bars5m.reduce((s, b) => s + b.volume, 0) / state.bars5m.length : 1;
    const volRatio = state.dayVolume / Math.max(avgVol, 1);
    const atrRatio = state.atr14 > 0 ? calculateATR(state.bars5m, 14) / state.atr14 : 1;
    const qualifyingTier = selectTier(volRatio, atrRatio, TIERED_CONFIG);

    const distanceToResistancePct = state.resistanceLevel && state.price > 0
      ? ((state.resistanceLevel - state.price) / state.price) * 100
      : null;

    const blockedReasons: string[] = [];
    if (!passesFilters) blockedReasons.push("Fails universe filters");
    if (!inSession) blockedReasons.push("Outside session window");
    if (!state.resistanceLevel) blockedReasons.push("No resistance level found");
    if (state.resistanceLevel && state.price < state.resistanceLevel) {
      blockedReasons.push(`Below resistance ($${state.resistanceLevel.toFixed(2)})`);
    }
    if (!biasResult.aligned) blockedReasons.push("15m bias not aligned");
    if (!regimeResult.aligned) blockedReasons.push("SPY not aligned");
    if (!qualifyingTier) blockedReasons.push("No tier qualified (vol/ATR too low)");
    if (state.relStrengthVsSpy <= 0) blockedReasons.push("Weak vs SPY");
    if (state.signalState !== "IDLE") blockedReasons.push(`In state: ${state.signalState}`);

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
      tier: qualifyingTier,
      volRatio: Number(volRatio.toFixed(2)),
      atrRatio: Number(atrRatio.toFixed(2)),
      distanceToResistancePct: distanceToResistancePct != null ? Number(distanceToResistancePct.toFixed(2)) : null,
      selectedTier: state.selectedTier,
      blockedReasons,
      relStrengthVsSpy: Number((state.relStrengthVsSpy ?? 0).toFixed(4)),
      spyAligned: regimeResult.aligned,
      inSession,
    });
  }

  return items.sort((a, b) => {
    if (a.signalState !== "IDLE" && b.signalState === "IDLE") return -1;
    if (a.signalState === "IDLE" && b.signalState !== "IDLE") return 1;
    const aReady = a.blockedReasons.length;
    const bReady = b.blockedReasons.length;
    if (aReady !== bReady) return aReady - bReady;
    return Math.abs(b.changePct) - Math.abs(a.changePct);
  });
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

function isInTradingSession(config: TieredStrategyConfig): boolean {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  for (const [start, end] of [config.sessions.open, config.sessions.mid, config.sessions.power]) {
    if (timeStr >= start && timeStr <= end) return true;
  }
  return false;
}

function checkMarketCondition(spyBars: Candle[], config: TieredStrategyConfig, tier: TradeTier, direction: "LONG" | "SHORT"): boolean {
  if (tier === "A" && config.marketFilter.tierABypass) return true;
  if (tier === "B" || tier === "C") return true;
  if (spyBars.length === 0) return false;
  const spyVwap = calculateVWAP(spyBars);
  const spyPrice = spyBars[spyBars.length - 1].close;
  if (direction === "LONG" && config.marketFilter.requireAboveVWAPForLong) return spyPrice > spyVwap;
  if (direction === "SHORT" && config.marketFilter.requireBelowVWAPForShort) return spyPrice < spyVwap;
  return true;
}

function getCurrentSession(config: TieredStrategyConfig): string {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  const [openStart, openEnd] = config.sessions.open;
  const [midStart, midEnd] = config.sessions.mid;
  const [powerStart, powerEnd] = config.sessions.power;

  if (timeStr >= openStart && timeStr <= openEnd) return "open";
  if (timeStr >= midStart && timeStr <= midEnd) return "mid";
  if (timeStr >= powerStart && timeStr <= powerEnd) return "power";
  return "closed";
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

  if (!sharedUserId) {
    const firstUser = await storage.getFirstUser();
    if (firstUser) {
      sharedUserId = firstUser.id;
      log(`Shared simulator initialized with user: ${firstUser.username}`, "simulator");
    }
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

  try {
    const staleSignals = await storage.getAllSignals();
    for (const sig of staleSignals) {
      if (sig.state && sig.state !== "CLOSED" && sig.state !== "IDLE") {
        await storage.updateSignal(sig.id, { state: "CLOSED", notes: (sig.notes ?? "") + " [Auto-closed on restart]", closedAt: new Date() });
        log(`Cleaned up stale signal ${sig.ticker} (was ${sig.state})`, "simulator");
      }
    }
  } catch (e) {
    log(`Error cleaning stale signals: ${e}`, "simulator");
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

          if (state.trendPhase === "rally" && state.trendPhaseBars > 3 + Math.floor(Math.random() * 3)) {
            state.trendPhase = "pullback";
            state.trendPhaseBars = 0;
          } else if (state.trendPhase === "pullback" && state.trendPhaseBars > 2 + Math.floor(Math.random() * 2)) {
            state.trendPhase = Math.random() > 0.2 ? "rally" : "consolidation";
            state.trendPhaseBars = 0;
          } else if (state.trendPhase === "consolidation" && state.trendPhaseBars > 2 + Math.floor(Math.random() * 3)) {
            state.trendPhase = "rally";
            state.trendPhaseBars = 0;
          }

          candle = create5mCandle(state);
        } else {
          const lastBar = state.bars5m.length > 0 ? state.bars5m[state.bars5m.length - 1] : null;
          if (lastBar && state.price > 0) {
            const scaleMismatch = Math.abs(lastBar.close - state.price) / state.price;
            if (scaleMismatch > 0.03) {
              state.scaleFactor = state.price / lastBar.close;
            } else {
              state.scaleFactor = 1;
            }
          }
          candle = {
            open: state.price * 0.999,
            high: state.price * 1.001,
            low: state.price * 0.998,
            close: state.price,
            volume: state.volume || (lastBar?.volume ?? 50000),
            timestamp: Date.now(),
          };
        }

        if (tickerConfig.ticker === "SPY" || tickerConfig.ticker === "QQQ") continue;

        if (state.signalState === "IDLE") {
          const resistance = findResistance(state.bars5m, 30);
          if (resistance) {
            const resistDistPct = state.price > 0 ? Math.abs(resistance.level - state.price) / state.price : 1;
            if (resistDistPct <= 0.03) {
              state.resistanceLevel = resistance.level;
            } else if (!state.resistanceLevel) {
              state.resistanceLevel = state.price * (1 + 0.0005 + Math.random() * 0.001);
            }
          } else if (!state.resistanceLevel) {
            state.resistanceLevel = state.price * (1 + 0.0005 + Math.random() * 0.001);
          }
          if (state.resistanceLevel && state.price > 0) {
            const distPct = (state.resistanceLevel - state.price) / state.price;
            if (distPct > 0.03 || distPct < -0.01) {
              state.resistanceLevel = state.price * (1 + 0.0005 + Math.random() * 0.001);
            }
          }
        }

        const biasResult = checkHigherTimeframeBias(
          state.bars15m,
          state.prevDayHigh,
          state.premarketHigh,
          state.price,
          DEFAULT_STRATEGY_CONFIG.higherTimeframe
        );

        const dollarVolume = state.price * tickerConfig.avgDailyVolume;

        if (!sharedUserId) {
          const firstUser = await storage.getFirstUser();
          if (firstUser) sharedUserId = firstUser.id;
        }
        const userId = sharedUserId;
        if (userId) {
          try {
            const user = await storage.getUser(userId);
            if (!user) { sharedUserId = null; }
            if (user) {
            const tieredConfig = buildTieredConfigFromUser(user);
            const inSession = isInTradingSession(tieredConfig);

            const spyCandles = spyBars5m.slice(-20);
            const tickerCandles = state.bars5m.slice(-20);
            let relStrengthVsSpy = 0;
            if (spyCandles.length > 0 && tickerCandles.length > 0) {
              const spyMove = (spyCandles[spyCandles.length - 1].close / spyCandles[0].open) - 1;
              const tickerMove = (tickerCandles[tickerCandles.length - 1].close / tickerCandles[0].open) - 1;
              relStrengthVsSpy = tickerMove - spyMove;
            }
            state.relStrengthVsSpy = relStrengthVsSpy;

            const trades = await storage.getAllTrades();
            const todayET = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
            const todayTrades = trades.filter(t => t.exitedAt && new Date(t.exitedAt).toLocaleDateString("en-US", { timeZone: "America/New_York" }) === todayET);
            const lossCount = todayTrades.filter(t => (t.pnl ?? 0) < 0).length;
            const dailyR = todayTrades.reduce((sum, t) => sum + (t.realizedR ?? 0), 0);
            const tradingLocked = lossCount >= tieredConfig.daily.maxLosingTrades || dailyR <= tieredConfig.daily.maxDailyLossR;

            let consecutiveLosses = 0;
            const sortedTodayTrades = todayTrades.sort((a, b) => new Date(b.exitedAt!).getTime() - new Date(a.exitedAt!).getTime());
            for (const t of sortedTodayTrades) {
              if ((t.pnl ?? 0) < 0) consecutiveLosses++;
              else break;
            }

            const passesUniverse = state.price >= tieredConfig.filters.minPrice &&
              dollarVolume >= tieredConfig.filters.minDollarVolume &&
              state.spreadPct <= tieredConfig.filters.maxSpreadPct &&
              !tieredConfig.filters.blacklist.includes(state.ticker);

            const hasOpenTrade = trades.some((t) => t.status === "open" && t.ticker === state.ticker);
            const timeSinceLastBreakout = Date.now() - state.lastBreakoutTime;
            const cooldownMs = tieredConfig.risk.cooldownMinutes * 60 * 1000;

            if (tickCount % 15 === 0) {
              const distPct = state.resistanceLevel ? ((state.resistanceLevel - state.price) / state.price * 100).toFixed(2) : "N/A";
              log(`[${state.ticker}] state=${state.signalState} price=$${state.price.toFixed(2)} resist=$${state.resistanceLevel?.toFixed(2) ?? "none"} dist=${distPct}% session=${inSession} univ=${passesUniverse} locked=${tradingLocked} cooldown=${timeSinceLastBreakout > cooldownMs ? "clear" : "active"} src=${currentDataSource}`, "scanner");
            }

            if (state.signalState === "IDLE" && state.resistanceLevel && timeSinceLastBreakout > cooldownMs && !hasOpenTrade && !tradingLocked && inSession && passesUniverse) {
              let shouldBreakout = false;
              let boCandle: Candle;

              let usingSyntheticCandle = false;
              if (currentDataSource === "live") {
                const recentBars = state.bars5m.slice(-3);
                let recentCandle = recentBars.length > 0 ? recentBars[recentBars.length - 1] : null;

                if (recentCandle && state.price > 0) {
                  const scaleMismatch = Math.abs(recentCandle.close - state.price) / state.price;
                  if (scaleMismatch > 0.03) {
                    log(`[${state.ticker}] BAR SCALE MISMATCH: barClose=$${recentCandle.close.toFixed(2)} vs livePrice=$${state.price.toFixed(2)} (${(scaleMismatch*100).toFixed(1)}% diff). Using synthetic candle.`, "scanner");
                    recentCandle = null;
                  }
                }

                const synthCandle = (breakAbove: boolean): Candle => ({
                  open: state.price * (breakAbove ? 0.997 : 1.001),
                  high: state.price * (breakAbove ? 1.003 : 1.002),
                  low: state.price * 0.995,
                  close: state.price,
                  volume: state.volume || 50000,
                  timestamp: Date.now(),
                });

                if (recentCandle && recentCandle.close > state.resistanceLevel) {
                  shouldBreakout = true;
                  boCandle = recentCandle;
                } else if (recentCandle && recentCandle.high > state.resistanceLevel && state.price > state.resistanceLevel) {
                  shouldBreakout = true;
                  boCandle = recentCandle;
                } else if (state.price > state.resistanceLevel) {
                  shouldBreakout = true;
                  boCandle = synthCandle(true);
                  usingSyntheticCandle = true;
                } else if (state.price >= state.resistanceLevel * 0.9985) {
                  shouldBreakout = true;
                  boCandle = synthCandle(true);
                  boCandle.close = state.resistanceLevel * 1.0005;
                  boCandle.high = state.resistanceLevel * 1.003;
                  usingSyntheticCandle = true;
                } else {
                  boCandle = recentCandle || synthCandle(false);
                  if (!recentCandle) usingSyntheticCandle = true;
                }
              } else {
                const nearResistance = state.price >= state.resistanceLevel * 0.995;
                shouldBreakout = nearResistance || (state.trendPhase === "rally" && Math.random() > 0.4);
                boCandle = createBreakoutCandle(state, state.resistanceLevel);
              }

              if (shouldBreakout) {
                log(`[${state.ticker}] BREAKOUT CANDIDATE: price=$${state.price.toFixed(2)} resist=$${state.resistanceLevel.toFixed(2)} candleClose=$${boCandle.close.toFixed(2)} candleHigh=$${boCandle.high.toFixed(2)}`, "scanner");

                if (currentDataSource === "simulated") {
                  state.bars5m.push(boCandle);
                  if (state.bars5m.length > 200) state.bars5m.shift();
                  state.barCount++;
                  state.vwap = calculateVWAP(state.bars5m);
                  state.atr14 = calculateATR(state.bars5m, 14);
                }

                const direction: "LONG" | "SHORT" = "LONG";
                const levelType = direction === "LONG" ? "RESISTANCE" as const : "SUPPORT" as const;

                let volRatio: number;
                if (usingSyntheticCandle) {
                  volRatio = 1.0;
                } else {
                  const avgVol = state.bars5m.length > tieredConfig.strategy.volumeLookback ?
                    state.bars5m.slice(-tieredConfig.strategy.volumeLookback).reduce((s, b) => s + b.volume, 0) / tieredConfig.strategy.volumeLookback :
                    state.bars5m.reduce((s, b) => s + b.volume, 0) / Math.max(state.bars5m.length, 1);
                  volRatio = boCandle.volume / Math.max(avgVol, 1);
                }

                const rawAtr = calculateATR(state.bars5m, tieredConfig.strategy.atrLen);
                const atr = rawAtr * (state.scaleFactor || 1);
                const atrRatio = state.atr14 > 0 ? atr / state.atr14 : 1.0;

                let tier = selectTier(volRatio, atrRatio, tieredConfig);
                if (tier && consecutiveLosses >= 2) {
                  const demoted = tier === "A" ? "B" : tier === "B" ? "C" : null;
                  if (demoted) {
                    log(`[${state.ticker}] Tier demoted ${tier}→${demoted} after ${consecutiveLosses} consecutive losses`, "scanner");
                    tier = demoted;
                  } else {
                    log(`[${state.ticker}] Tier C skipped after ${consecutiveLosses} consecutive losses`, "scanner");
                    tier = null;
                  }
                }
                log(`[${state.ticker}] Tier selection: volRatio=${volRatio.toFixed(2)} atrRatio=${atrRatio.toFixed(2)} tier=${tier ?? "NONE"} consLosses=${consecutiveLosses}`, "scanner");

                if (tier) {
                  const marketOk = checkMarketCondition(spyBars5m, tieredConfig, tier, direction);
                  log(`[${state.ticker}] Market check: marketOk=${marketOk} tier=${tier}`, "scanner");
                  if (marketOk) {
                    const breakoutResult = checkTieredBreakout(boCandle, state.bars5m.slice(0, -1), state.resistanceLevel, levelType, tieredConfig.tiers[tier], tieredConfig.strategy, usingSyntheticCandle ? volRatio : undefined);
                    log(`[${state.ticker}] Breakout qualification: qualified=${breakoutResult.qualified} reasons=${breakoutResult.reasons.join("; ") || "all passed"}`, "scanner");

                    if (breakoutResult.qualified) {
                      state.signalState = "BREAKOUT";
                      state.breakoutCandle = boCandle;
                      state.lastBreakoutTime = Date.now();
                      state.selectedTier = tier;
                      state.retestBarsSinceBreakout = 0;

                      state.lastScore = Math.round(volRatio * 30 + atrRatio * 20);
                      state.lastScoreTier = tier;

                      await storage.createSignal({
                        userId, ticker: state.ticker,
                        state: "BREAKOUT",
                        resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
                        currentPrice: Number(state.price.toFixed(2)),
                        breakoutPrice: Number(state.price.toFixed(2)),
                        breakoutVolume: boCandle.volume,
                        trendConfirmed: biasResult.aligned,
                        volumeConfirmed: true,
                        atrExpansion: atrRatio >= 1.1,
                        timeframe: "5m",
                        rvol: Number(state.rvol.toFixed(2)),
                        atrValue: Number((state.atr14 * (state.scaleFactor || 1)).toFixed(4)),
                        rejectionCount: 2,
                        score: state.lastScore,
                        scoreTier: tier,
                        marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                        spyAligned: regimeResult.aligned,
                        volatilityGatePassed: volGateResult.passes,
                        scoreBreakdown: { volRatio, atrRatio, tier },
                        relStrengthVsSpy: Number(relStrengthVsSpy.toFixed(4)),
                        isPowerSetup: false,
                        tier: tier,
                        direction: direction,
                        notes: `Tier ${tier} breakout above $${state.resistanceLevel.toFixed(2)}. VolRatio ${volRatio.toFixed(1)}x. ATRratio ${atrRatio.toFixed(1)}x.`,
                      });

                      broadcast("signal_update", { ticker: state.ticker, state: "BREAKOUT", tier, direction });
                      await storage.createAlert({
                        userId, ticker: state.ticker, type: "SETUP",
                        title: `Tier ${tier} BREAKOUT`,
                        message: `${state.ticker} breakout above $${state.resistanceLevel.toFixed(2)}. Volume ${volRatio.toFixed(1)}x.`,
                        priority: tier === "A" ? "high" : "medium", isRead: false,
                      });
                    }
                  }
                }
              }
            }

            if (state.signalState === "BREAKOUT" && state.resistanceLevel && state.breakoutCandle && state.selectedTier) {
              state.retestBarsSinceBreakout++;
              const tierConfig = tieredConfig.tiers[state.selectedTier];

              if (state.retestBarsSinceBreakout > tierConfig.retestTimeoutCandles) {
                log(`[${state.ticker}] BREAKOUT timed out after ${state.retestBarsSinceBreakout} candles (max ${tierConfig.retestTimeoutCandles}). Resetting to IDLE.`, "scanner");
                const staleBreakoutSignals = await storage.getAllSignals();
                const stale = staleBreakoutSignals.find(s => s.ticker === state.ticker && s.state === "BREAKOUT");
                if (stale) {
                  await storage.updateSignal(stale.id, { state: "CLOSED", notes: (stale.notes ?? "") + " [Retest timeout]", closedAt: new Date() });
                }
                state.signalState = "IDLE";
                state.selectedTier = null;
                state.breakoutCandle = null;
                state.retestBars = [];
              } else {
                let retCandle: Candle;
                if (currentDataSource === "live") {
                  retCandle = candle; // Always use live-price candle in live mode
                } else {
                  retCandle = createRetestCandle(state, state.resistanceLevel);
                  state.bars5m.push(retCandle);
                  if (state.bars5m.length > 200) state.bars5m.shift();
                  state.barCount++;
                  state.vwap = calculateVWAP(state.bars5m);
                  state.atr14 = calculateATR(state.bars5m, 14);
                }

                const direction = "LONG" as const;
                const retestResult = checkTieredRetest(retCandle, state.breakoutCandle, state.retestBars, state.resistanceLevel, "RESISTANCE", state.bars5m, tierConfig, direction);
                log(`[${state.ticker}] BREAKOUT→RETEST check (bar ${state.retestBarsSinceBreakout}/${tierConfig.retestTimeoutCandles}): valid=${retestResult.valid} reasons=${retestResult.reasons.join("; ") || "all passed"} candleClose=$${retCandle.close.toFixed(2)} level=$${state.resistanceLevel.toFixed(2)}`, "scanner");

                if (retestResult.valid) {
                  state.signalState = "RETEST";
                  state.retestSwingLow = retCandle.low;
                  state.retestBars.push(retCandle);
                  state.confirmationCandle = retCandle;
                  log(`[${state.ticker}] >> RETEST CONFIRMED. Tier ${state.selectedTier}. Waiting for entry.`, "scanner");

                  const existingSignals = await storage.getAllSignals();
                  const activeSignal = existingSignals.find(s => s.ticker === state.ticker && s.state === "BREAKOUT");
                  if (activeSignal) {
                    await storage.updateSignal(activeSignal.id, { state: "RETEST", currentPrice: Number(state.price.toFixed(2)) });
                  }

                  broadcast("signal_update", { ticker: state.ticker, state: "RETEST", resistanceLevel: state.resistanceLevel, price: state.price, tier: state.selectedTier });
                  await storage.createAlert({
                    userId, ticker: state.ticker, type: "RETEST",
                    title: `Tier ${state.selectedTier} Retest`,
                    message: `${state.ticker} pulling back to $${state.resistanceLevel.toFixed(2)}.`,
                    priority: "medium", isRead: false,
                  });
                } else {
                  state.retestBars.push(retCandle);
                }
              }
            }

            if (state.signalState === "RETEST" && state.resistanceLevel && state.breakoutCandle && state.selectedTier) {
              state.retestBars.push(candle);
              state.retestBarsSinceBreakout++;
              const tierConfig = tieredConfig.tiers[state.selectedTier];

              if (state.retestBarsSinceBreakout > tierConfig.retestTimeoutCandles) {
                log(`[${state.ticker}] RETEST timed out after ${state.retestBarsSinceBreakout} candles. Resetting to IDLE.`, "scanner");
                const staleRetestSignals = await storage.getAllSignals();
                const staleRetest = staleRetestSignals.find(s => s.ticker === state.ticker && (s.state === "RETEST" || s.state === "BREAKOUT"));
                if (staleRetest) {
                  await storage.updateSignal(staleRetest.id, { state: "CLOSED", notes: (staleRetest.notes ?? "") + " [Retest timeout]", closedAt: new Date() });
                }
                state.signalState = "IDLE";
                state.selectedTier = null;
                state.breakoutCandle = null;
                state.retestBars = [];
              } else {
                const direction = "LONG" as const;
                const retestResult = checkTieredRetest(candle, state.breakoutCandle, state.retestBars, state.resistanceLevel, "RESISTANCE", state.bars5m, tierConfig, direction);
                log(`[${state.ticker}] RETEST→ENTRY check: valid=${retestResult.valid} entry=$${retestResult.entryPrice?.toFixed(2) ?? "none"} stop=$${retestResult.stopPrice?.toFixed(2) ?? "none"} reasons=${retestResult.reasons.join("; ") || "all passed"} session=${inSession} locked=${tradingLocked}`, "scanner");

                if (retestResult.valid && retestResult.entryPrice && retestResult.stopPrice && inSession && !tradingLocked) {
                  const sf2 = state.scaleFactor;
                  const normalizedCloses = sf2 !== 1 
                    ? state.bars5m.map(b => b.close * sf2) 
                    : state.bars5m.map(b => b.close);
                  const ema9 = lastEMA(normalizedCloses, 9);
                  const ema20 = lastEMA(normalizedCloses, 20);
                  const emaAligned = ema9 > ema20;
                  if (!emaAligned) {
                    log(`[${state.ticker}] ENTRY BLOCKED: EMA9 ($${ema9.toFixed(2)}) <= EMA20 ($${ema20.toFixed(2)})`, "scanner");
                  }

                  const riskPerShare = Math.abs(retestResult.entryPrice - retestResult.stopPrice);
                  const nextResistance = state.resistanceLevel ? state.resistanceLevel * 1.01 : retestResult.entryPrice * 1.02;
                  const roomTo2R = (nextResistance - retestResult.entryPrice) >= (riskPerShare * 2);
                  if (!roomTo2R) {
                    log(`[${state.ticker}] ENTRY BLOCKED: No 2R room. Room=$${(nextResistance - retestResult.entryPrice).toFixed(2)} vs 2R=$${(riskPerShare * 2).toFixed(2)}`, "scanner");
                  }

                  if (!emaAligned || !roomTo2R) {
                    log(`[${state.ticker}] Entry gates failed. EMA=${emaAligned} Room2R=${roomTo2R}. Skipping entry.`, "scanner");
                  }

                  if (emaAligned && roomTo2R) {
                  const minRisk = retestResult.entryPrice * 0.003;
                  const effectiveRisk = Math.max(riskPerShare, minRisk);
                  const equity = user.accountSize ?? 100000;
                  const riskDollars = equity * tierConfig.riskPct;
                  let shares = Math.floor(riskDollars / effectiveRisk);

                  const maxPosSize = equity * (tieredConfig.risk.maxPositionPct / 100);
                  if (shares * retestResult.entryPrice > maxPosSize) shares = Math.floor(maxPosSize / retestResult.entryPrice);

                  if (shares > 0) {
                    state.signalState = "TRIGGERED";
                    const target1 = retestResult.entryPrice + (riskPerShare * tieredConfig.exits.partialAtR);
                    const target2 = retestResult.entryPrice + (riskPerShare * tieredConfig.exits.finalTargetR);
                    log(`[${state.ticker}] >> TRADE TRIGGERED! Tier ${state.selectedTier} entry=$${retestResult.entryPrice.toFixed(2)} stop=$${retestResult.stopPrice.toFixed(2)} shares=${shares} risk=$${riskDollars.toFixed(0)} T1=$${target1.toFixed(2)} T2=$${target2.toFixed(2)}`, "scanner");

                    const existingSignals2 = await storage.getAllSignals();
                    const activeSignal2 = existingSignals2.find(s => s.ticker === state.ticker && (s.state === "RETEST" || s.state === "BREAKOUT"));
                    if (activeSignal2) {
                      await storage.updateSignal(activeSignal2.id, {
                        state: "TRIGGERED",
                        currentPrice: Number(state.price.toFixed(2)),
                        entryPrice: retestResult.entryPrice,
                        stopPrice: retestResult.stopPrice,
                        target1,
                        target2,
                        positionSize: shares,
                        dollarRisk: riskDollars,
                        riskReward: riskPerShare > 0 ? (target2 - retestResult.entryPrice) / riskPerShare : 0,
                        entryMode: "conservative",
                      });
                    }

                    const trade = await storage.createTrade({
                      userId, ticker: state.ticker, side: "long",
                      entryPrice: retestResult.entryPrice, stopPrice: retestResult.stopPrice,
                      originalStopPrice: retestResult.stopPrice, target1, target2, shares,
                      status: "open", score: state.lastScore, scoreTier: state.selectedTier,
                      entryMode: "conservative", dollarRisk: riskDollars,
                      isPowerSetup: false, tier: state.selectedTier, direction: "LONG",
                    });

                    broadcast("trade_update", trade);
                    await storage.createAlert({
                      userId, ticker: state.ticker, type: "TRIGGER",
                      title: `Tier ${state.selectedTier} ENTRY`,
                      message: `${state.ticker} entered at $${retestResult.entryPrice.toFixed(2)}. Risk $${riskDollars.toFixed(0)}.`,
                      priority: "high", isRead: false,
                    });
                  }
                  }
                }
              }
            }

            const openTrades = trades.filter((t) => t.status === "open" && t.ticker === state.ticker);
            for (const trade of openTrades) {
              const minutesSinceEntry = Math.floor((Date.now() - new Date(trade.enteredAt!).getTime()) / 60000);
              const riskPerShare = Math.abs(trade.entryPrice - trade.stopPrice);

              const sf = state.scaleFactor;
              const normalizedBars = sf !== 1 ? state.bars5m.map(b => ({
                ...b,
                open: b.open * sf,
                high: b.high * sf,
                low: b.low * sf,
                close: b.close * sf,
              })) : state.bars5m;
              const normalizedATR = state.atr14 * sf;

              const exitDecision = checkTieredExitRules(
                candle, normalizedBars, trade.entryPrice, trade.stopPrice, trade.shares,
                trade.isPartiallyExited ?? false, riskPerShare, minutesSinceEntry,
                tieredConfig.exits, tieredConfig.risk, normalizedATR
              );

              if (exitDecision.shouldExit) {
                if (exitDecision.exitType === "partial") {
                  await storage.updateTrade(trade.id, {
                    isPartiallyExited: true, partialExitPrice: exitDecision.exitPrice!,
                    partialExitShares: exitDecision.partialShares!, stopPrice: exitDecision.newStopPrice!,
                    runnerShares: trade.shares - exitDecision.partialShares!,
                  });
                } else {
                  const exitPrice = exitDecision.exitPrice!;
                  const priceDiff = Math.abs(exitPrice - trade.entryPrice) / trade.entryPrice;
                  if (priceDiff > 0.20) {
                    log(`[${state.ticker}] EXIT SANITY FAIL: exitPrice=$${exitPrice.toFixed(2)} vs entry=$${trade.entryPrice.toFixed(2)} (${(priceDiff*100).toFixed(1)}% diff). Using entry as exit.`, "scanner");
                    const sanitizedExit = trade.entryPrice;
                    const pnl = (sanitizedExit - trade.entryPrice) * trade.shares;
                    const realizedR = riskPerShare > 0 ? (sanitizedExit - trade.entryPrice) / riskPerShare : 0;
                    await storage.updateTrade(trade.id, {
                      status: "closed", exitPrice: sanitizedExit, exitedAt: new Date(),
                      exitReason: "sanity_check", pnl, realizedR,
                      pnlPercent: 0,
                    });
                    await storage.upsertDailySummary(userId, 0, true, (user.accountSize ?? 100000));
                  } else {
                    const pnl = (exitPrice - trade.entryPrice) * trade.shares;
                    const realizedR = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : 0;
                    await storage.updateTrade(trade.id, {
                      status: "closed", exitPrice, exitedAt: new Date(),
                      exitReason: exitDecision.exitType!, pnl, realizedR,
                      pnlPercent: ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100,
                    });
                    await storage.upsertDailySummary(userId, pnl, pnl >= 0, (user.accountSize ?? 100000) + pnl);
                  }
                }
              } else if (exitDecision.newStopPrice) {
                await storage.updateTrade(trade.id, { stopPrice: exitDecision.newStopPrice });
              }
            }
            }
          } catch (e) {}
        }
      }
    }

    broadcast("price_update", priceUpdates);
    broadcast("market_status", {
      isOpen: marketIsOpen,
      isLunchChop: isLunchChop(),
      spyAligned: regimeResult.aligned,
      spyChopping: regimeResult.chopping,
      currentSession: getCurrentSession(TIERED_CONFIG),
    });
  }, 2000);
}
