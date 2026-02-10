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
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", basePrice: 195.0, volatility: 0.008, trend: 0.0002, avgDailyVolume: 55000000 },
  { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology", basePrice: 420.0, volatility: 0.007, trend: 0.0003, avgDailyVolume: 22000000 },
  { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Technology", basePrice: 875.0, volatility: 0.015, trend: 0.0005, avgDailyVolume: 45000000 },
  { ticker: "AMZN", name: "Amazon.com Inc.", sector: "Consumer", basePrice: 185.0, volatility: 0.009, trend: 0.0002, avgDailyVolume: 38000000 },
  { ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", basePrice: 155.0, volatility: 0.008, trend: 0.0001, avgDailyVolume: 25000000 },
  { ticker: "META", name: "Meta Platforms", sector: "Technology", basePrice: 505.0, volatility: 0.012, trend: 0.0004, avgDailyVolume: 18000000 },
  { ticker: "TSLA", name: "Tesla Inc.", sector: "Consumer", basePrice: 245.0, volatility: 0.02, trend: -0.0001, avgDailyVolume: 95000000 },
  { ticker: "SPY", name: "S&P 500 ETF", sector: "ETF", basePrice: 510.0, volatility: 0.004, trend: 0.0001, avgDailyVolume: 75000000 },
  { ticker: "QQQ", name: "Nasdaq-100 ETF", sector: "ETF", basePrice: 440.0, volatility: 0.005, trend: 0.0002, avgDailyVolume: 40000000 },
  { ticker: "AMD", name: "AMD Inc.", sector: "Technology", basePrice: 175.0, volatility: 0.014, trend: 0.0003, avgDailyVolume: 48000000 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Finance", basePrice: 195.0, volatility: 0.006, trend: 0.0001, avgDailyVolume: 10000000 },
  { ticker: "V", name: "Visa Inc.", sector: "Finance", basePrice: 280.0, volatility: 0.005, trend: 0.0002, avgDailyVolume: 7000000 },
  { ticker: "NFLX", name: "Netflix Inc.", sector: "Technology", basePrice: 620.0, volatility: 0.013, trend: 0.0003, avgDailyVolume: 5500000 },
  { ticker: "CRM", name: "Salesforce Inc.", sector: "Technology", basePrice: 265.0, volatility: 0.01, trend: 0.0002, avgDailyVolume: 6000000 },
  { ticker: "AVGO", name: "Broadcom Inc.", sector: "Technology", basePrice: 1350.0, volatility: 0.012, trend: 0.0004, avgDailyVolume: 3200000 },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare", basePrice: 780.0, volatility: 0.009, trend: 0.0003, avgDailyVolume: 3000000 },
];

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
}

const priceStates = new Map<string, PriceState>();

function initializePriceState(ticker: SimulatedTicker): PriceState {
  const variance = (Math.random() - 0.5) * ticker.basePrice * 0.02;
  const price = ticker.basePrice + variance;
  const yesterdayRange = ticker.basePrice * ticker.volatility * 4;
  return {
    ticker: ticker.ticker,
    price,
    open: price,
    high: price,
    low: price,
    volume: Math.floor(Math.random() * 500000 + 100000),
    bars5m: [],
    bars15m: [],
    bars1h: [],
    signalState: "IDLE",
    resistanceLevel: null,
    breakoutCandle: null,
    retestBars: [],
    retestSwingLow: null,
    barCount: 0,
    dayVolume: Math.floor(Math.random() * 5000000 + 1000000),
    changePct: 0,
    rvol: 1.0,
    atr14: 0,
    vwap: price,
    prevDayHigh: price * (1 + Math.random() * 0.02),
    premarketHigh: price * (1 + Math.random() * 0.01),
    yesterdayRange,
    dailyATRbaseline: yesterdayRange * 0.25,
    spreadPct: 0.01 + Math.random() * 0.03,
    minutesSinceOpen: 0,
    lastScore: 0,
    lastScoreTier: "pass",
  };
}

function simulatePriceMove(state: PriceState, ticker: SimulatedTicker): void {
  const drift = ticker.trend;
  const vol = ticker.volatility;
  const rand = (Math.random() - 0.5) * 2;
  const change = state.price * (drift + vol * rand);
  state.price = Math.max(state.price + change, 1);
  state.high = Math.max(state.high, state.price);
  state.low = Math.min(state.low, state.price);
  const tickVol = Math.floor(Math.random() * 10000 + 1000);
  state.volume += tickVol;
  state.dayVolume += tickVol;
  state.changePct = ((state.price - ticker.basePrice) / ticker.basePrice) * 100;
  const expectedVolSoFar = ticker.avgDailyVolume * 0.3;
  state.rvol = expectedVolSoFar > 0 ? state.dayVolume / expectedVolSoFar : 1;
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
  state.volume = Math.floor(Math.random() * 50000 + 10000);
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
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const totalMin = est.getHours() * 60 + est.getMinutes();
  return totalMin >= 690 && totalMin < 810;
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
      DEFAULT_STRATEGY_CONFIG.higherTimeframe
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

export function startSimulatedDataFeed(
  broadcast: (type: string, data: any) => void,
  storage: IStorage
) {
  for (const ticker of SIMULATED_TICKERS) {
    const state = initializePriceState(ticker);
    for (let i = 0; i < 50; i++) {
      simulatePriceMove(state, ticker);
      if (i % 5 === 4) create5mCandle(state);
    }
    state.atr14 = calculateATR(state.bars5m, 14);
    state.vwap = calculateVWAP(state.bars5m);
    priceStates.set(ticker.ticker, state);
  }

  let tickCount = 0;

  setInterval(async () => {
    tickCount++;
    const priceUpdates: any[] = [];
    const lunchChop = isLunchChop();

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

      simulatePriceMove(state, tickerConfig);

      priceUpdates.push({
        ticker: state.ticker,
        price: Number(state.price.toFixed(2)),
        change: Number(state.changePct.toFixed(2)),
        volume: state.dayVolume,
        rvol: Number(state.rvol.toFixed(2)),
      });

      if (tickCount % 10 === 0) {
        const candle = create5mCandle(state);

        if (tickerConfig.ticker === "SPY" || tickerConfig.ticker === "QQQ") continue;

        const resistance = findResistance(state.bars5m, 48);
        if (resistance) {
          state.resistanceLevel = resistance.level;
        }

        const dollarVolume = state.price * tickerConfig.avgDailyVolume;
        const universeResult = checkUniverseFilter(
          state.price,
          dollarVolume,
          state.spreadPct,
          state.bars1h.length > 0 ? state.bars1h : state.bars5m,
          state.rvol,
          state.minutesSinceOpen,
          DEFAULT_STRATEGY_CONFIG.universe
        );

        if (!universeResult.passes) continue;

        const biasResult = checkHigherTimeframeBias(
          state.bars15m,
          state.prevDayHigh,
          state.premarketHigh,
          state.price,
          DEFAULT_STRATEGY_CONFIG.higherTimeframe
        );

        if (state.signalState === "IDLE" && state.resistanceLevel && !lunchChop) {
          const breakoutResult = checkBreakoutQualification(
            candle,
            state.bars5m.slice(0, -1),
            state.resistanceLevel,
            DEFAULT_STRATEGY_CONFIG.breakout
          );

          if (breakoutResult.qualified && biasResult.aligned && regimeResult.aligned && volGateResult.passes) {
            state.signalState = "BREAKOUT";
            state.breakoutCandle = candle;

            const rejections = resistance?.rejections ?? 2;

            const atrExpanding = state.atr14 > state.dailyATRbaseline * 1.1;
            const scoreResult = computeScore(
              state.rvol,
              biasResult,
              breakoutResult.metrics.volumeMultiplier,
              false,
              regimeResult,
              atrExpanding,
              false,
              DEFAULT_STRATEGY_CONFIG.scoring
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
              breakoutVolume: candle.volume,
              trendConfirmed: biasResult.aligned,
              volumeConfirmed: breakoutResult.metrics.volumeMultiplier >= 1.8,
              atrExpansion: atrExpanding,
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
              notes: `SETUP forming: Breakout above $${state.resistanceLevel.toFixed(2)} (${rejections} rej). Score ${scoreResult.score}/100 (${scoreResult.tier}). RVOL ${state.rvol.toFixed(1)}x. Body ${(breakoutResult.metrics.bodyPct * 100).toFixed(0)}%. Vol ${breakoutResult.metrics.volumeMultiplier.toFixed(1)}x. 15m bias ${biasResult.confirmations}/3. SPY ${regimeResult.aligned ? "aligned" : "misaligned"}.`,
            };

            broadcast("signal_update", signalData);

            for (const userId of activeUserIds) {
              try {
                await storage.createSignal({ userId, ...signalData });
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "SETUP",
                  title: `SETUP forming (Score ${scoreResult.score})`,
                  message: `${state.ticker} breakout above $${state.resistanceLevel.toFixed(2)}. Score ${scoreResult.score}/100 (${scoreResult.tier}). RVOL ${state.rvol.toFixed(1)}x. 15m bias ${biasResult.confirmations}/3.`,
                  priority: "high",
                  isRead: false,
                });
              } catch (e) {}
            }
          }
        }

        if (state.signalState === "BREAKOUT" && state.resistanceLevel && state.breakoutCandle) {
          const tolerance = state.resistanceLevel * 0.0015;
          if (Math.abs(state.price - state.resistanceLevel) <= tolerance) {
            state.signalState = "RETEST";
            state.retestSwingLow = state.low;
            state.retestBars = [candle];

            broadcast("signal_update", {
              ticker: state.ticker,
              state: "RETEST",
              resistanceLevel: state.resistanceLevel,
              price: state.price,
            });

            for (const userId of activeUserIds) {
              try {
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "RETEST",
                  title: "Retest in Progress",
                  message: `${state.ticker} pulling back to $${state.resistanceLevel.toFixed(2)} breakout level.`,
                  priority: "medium",
                  isRead: false,
                });
              } catch (e) {}
            }
          }

          if (state.price < state.resistanceLevel * (1 - 0.003)) {
            state.signalState = "IDLE";
            state.breakoutCandle = null;
            state.resistanceLevel = null;
          }
        }

        if (state.signalState === "RETEST" && state.resistanceLevel && state.breakoutCandle) {
          state.retestBars.push(candle);
          if (state.low < (state.retestSwingLow ?? state.low)) {
            state.retestSwingLow = state.low;
          }

          if (state.price < state.resistanceLevel * (1 - 0.003)) {
            state.signalState = "IDLE";
            state.breakoutCandle = null;
            state.retestBars = [];
            state.resistanceLevel = null;
            state.retestSwingLow = null;
            continue;
          }

          const retestResult = checkRetestRules(
            candle,
            state.breakoutCandle,
            state.retestBars,
            state.resistanceLevel,
            state.bars5m,
            DEFAULT_STRATEGY_CONFIG.retest
          );

          if (retestResult.valid && retestResult.entryPrice && retestResult.stopPrice && !lunchChop) {
            state.signalState = "TRIGGERED";

            const entryPrice = Number(retestResult.entryPrice.toFixed(2));
            const stopPrice = Number(retestResult.stopPrice.toFixed(2));
            const risk = entryPrice - stopPrice;
            const target1 = Number((entryPrice + risk).toFixed(2));
            const target2 = Number((entryPrice + risk * 2.5).toFixed(2));
            const riskReward = risk > 0 ? (target2 - entryPrice) / risk : 0;

            const prevCandle = state.bars5m.length >= 2 ? state.bars5m[state.bars5m.length - 2] : undefined;
            const pattern = detectCandlePattern(candle, prevCandle);

            const atrExpanding = state.atr14 > state.dailyATRbaseline * 1.1;
            const scoreResult = computeScore(
              state.rvol,
              biasResult,
              state.breakoutCandle ? state.breakoutCandle.volume / (candle.volume || 1) : 1,
              retestResult.metrics.volumeContracting,
              regimeResult,
              atrExpanding,
              false,
              DEFAULT_STRATEGY_CONFIG.scoring
            );

            state.lastScore = scoreResult.score;
            state.lastScoreTier = scoreResult.tier;

            if (scoreResult.tier === "pass") {
              state.signalState = "IDLE";
              state.breakoutCandle = null;
              state.retestBars = [];
              state.resistanceLevel = null;
              state.retestSwingLow = null;
              continue;
            }

            const regimeSizeMultiplier = regimeResult.sizeMultiplier;
            const scoreSizeMultiplier = scoreResult.sizeMultiplier;
            const combinedSizeMultiplier = regimeSizeMultiplier * scoreSizeMultiplier;

            const stopBasis = stopPrice > calculateVWAP(state.bars5m) ? "VWAP" : "retest_low";
            const entryModeUsed = DEFAULT_STRATEGY_CONFIG.retest.entryMode;

            const triggerData = {
              ticker: state.ticker,
              state: "TRIGGERED" as const,
              resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
              entryPrice,
              stopPrice,
              target1,
              target2,
              riskReward: Number(riskReward.toFixed(2)),
              currentPrice: entryPrice,
              trendConfirmed: biasResult.aligned,
              volumeConfirmed: true,
              atrExpansion: atrExpanding,
              candlePattern: pattern || "Green Candle",
              timeframe: "5m",
              rvol: Number(state.rvol.toFixed(2)),
              atrValue: Number(state.atr14.toFixed(4)),
              score: scoreResult.score,
              scoreTier: scoreResult.tier,
              marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
              entryMode: entryModeUsed,
              stopBasis,
              spyAligned: regimeResult.aligned,
              volatilityGatePassed: volGateResult.passes,
              scoreBreakdown: scoreResult.breakdown,
              notes: `TRIGGER at $${entryPrice}${pattern ? ` (${pattern})` : ""}. Stop $${stopPrice} (${stopBasis}). T1 $${target1} (+1R, partial 50%). T2 $${target2} (+2.5R trail). Score ${scoreResult.score}/100. RVOL ${state.rvol.toFixed(1)}x. Size ${(combinedSizeMultiplier * 100).toFixed(0)}%. Entry: ${entryModeUsed}.`,
            };

            broadcast("signal_update", triggerData);

            for (const userId of activeUserIds) {
              try {
                const signal = await storage.createSignal({ userId, ...triggerData });

                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "TRIGGER",
                  title: `TRIGGER hit - Score ${scoreResult.score} (${scoreResult.tier})${pattern ? ` - ${pattern}` : ""}`,
                  message: `${state.ticker} triggered at $${entryPrice}. Stop $${stopPrice}. T1 $${target1}. T2 $${target2}. R:R ${riskReward.toFixed(1)}. RVOL ${state.rvol.toFixed(1)}x. ${entryModeUsed} entry.`,
                  priority: "high",
                  isRead: false,
                  signalId: signal.id,
                });

                const user = await storage.getUser(userId);
                if (user && user.paperMode) {
                  const config = buildConfigFromUser(user);
                  const accountSize = user.accountSize ?? 100000;
                  const riskPct = config.risk.perTradeRiskPct / 100;
                  const dollarRisk = accountSize * riskPct;
                  let shares = risk > 0 ? Math.floor(dollarRisk / risk) : 0;
                  const maxPositionValue = accountSize * (config.risk.maxPositionPct / 100);
                  if (shares * entryPrice > maxPositionValue) {
                    shares = Math.floor(maxPositionValue / entryPrice);
                  }
                  shares = Math.floor(shares * combinedSizeMultiplier);
                  if (shares > 0) {
                    const timeStopMinutes = config.risk.timeStopMinutes;
                    const timeStopAt = new Date(Date.now() + timeStopMinutes * 60 * 1000);
                    await storage.createTrade({
                      userId,
                      signalId: signal.id,
                      ticker: state.ticker,
                      side: "long",
                      entryPrice,
                      stopPrice,
                      originalStopPrice: stopPrice,
                      target1,
                      target2,
                      shares,
                      status: "open",
                      dollarRisk: Number((shares * risk).toFixed(2)),
                      timeStopAt,
                      score: scoreResult.score,
                      scoreTier: scoreResult.tier,
                      entryMode: entryModeUsed,
                    });
                  }
                }
              } catch (e) {}
            }

            setTimeout(() => {
              state.signalState = "IDLE";
              state.breakoutCandle = null;
              state.retestBars = [];
              state.resistanceLevel = null;
              state.retestSwingLow = null;
            }, 120000);
          }
        }

        if (state.signalState === "TRIGGERED") {
          for (const userId of activeUserIds) {
            try {
              const trades = await storage.getTrades(userId);
              const openTrades = trades.filter(
                (t) => t.status === "open" && t.ticker === state.ticker
              );
              for (const trade of openTrades) {
                const riskPerShare = trade.entryPrice - (trade.originalStopPrice ?? trade.stopPrice);
                const minutesSinceEntry = trade.enteredAt
                  ? Math.floor((Date.now() - new Date(trade.enteredAt).getTime()) / 60000)
                  : 0;

                const exitDecision = checkExitRules(
                  candle,
                  state.bars5m,
                  trade.entryPrice,
                  trade.stopPrice,
                  trade.shares,
                  trade.isPartiallyExited ?? false,
                  riskPerShare,
                  minutesSinceEntry,
                  DEFAULT_STRATEGY_CONFIG.exits,
                  DEFAULT_STRATEGY_CONFIG.risk
                );

                if (exitDecision.shouldExit && exitDecision.exitType === "partial" && exitDecision.partialShares) {
                  const runnerShares = trade.shares - exitDecision.partialShares;
                  await storage.updateTrade(trade.id, {
                    isPartiallyExited: true,
                    partialExitPrice: exitDecision.exitPrice,
                    partialExitShares: exitDecision.partialShares,
                    stopPrice: exitDecision.newStopPrice ?? trade.stopPrice,
                    stopMovedToBE: true,
                    runnerShares,
                  });
                  await storage.createAlert({
                    userId,
                    ticker: state.ticker,
                    type: "PARTIAL_EXIT",
                    title: `Partial Exit - ${exitDecision.partialShares} shares`,
                    message: exitDecision.reason,
                    priority: "medium",
                    isRead: false,
                  });
                } else if (exitDecision.shouldExit && exitDecision.exitType !== "partial") {
                  const exitPrice = exitDecision.exitPrice ?? state.price;
                  const pnl = (exitPrice - trade.entryPrice) * trade.shares;
                  const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
                  const rMult = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : 0;
                  await storage.updateTrade(trade.id, {
                    status: "closed",
                    exitPrice,
                    pnl: Number(pnl.toFixed(2)),
                    pnlPercent: Number(pnlPct.toFixed(2)),
                    rMultiple: Number(rMult.toFixed(2)),
                    exitReason: exitDecision.exitType ?? "unknown",
                    exitedAt: new Date(),
                  });
                  await storage.createAlert({
                    userId,
                    ticker: state.ticker,
                    type: "EXIT",
                    title: `Exit - ${exitDecision.exitType}`,
                    message: `${state.ticker} closed at $${exitPrice.toFixed(2)}. P&L $${pnl.toFixed(2)} (${rMult.toFixed(1)}R). ${exitDecision.reason}`,
                    priority: pnl >= 0 ? "low" : "high",
                    isRead: false,
                  });
                } else if (!exitDecision.shouldExit && exitDecision.newStopPrice) {
                  await storage.updateTrade(trade.id, {
                    trailingStopPrice: exitDecision.newStopPrice,
                    stopPrice: exitDecision.newStopPrice,
                  });
                }
              }
            } catch (e) {}
          }
        }
      }
    }

    broadcast("price_update", priceUpdates);
  }, 2000);

  setInterval(() => {
    const now = new Date();
    const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hours = est.getHours();
    const minutes = est.getMinutes();
    const totalMin = hours * 60 + minutes;
    const day = est.getDay();
    const isOpen = totalMin >= 570 && totalMin < 960 && day >= 1 && day <= 5;
    const isLunch = totalMin >= 690 && totalMin < 810;

    const spyState = priceStates.get("SPY");
    const regimeResult = checkMarketRegime(spyState?.bars5m ?? [], DEFAULT_STRATEGY_CONFIG.marketRegime);

    broadcast("market_status", {
      isOpen,
      isLunchChop: isLunch,
      time: est.toISOString(),
      spyAligned: regimeResult.aligned,
      spyChopping: regimeResult.chopping,
    });
  }, 30000);

  log("Simulated market data feed started", "simulator");
}
