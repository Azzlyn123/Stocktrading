import type { IStorage } from "./storage";
import { log } from "./index";
import {
  buildTieredConfigFromUser,
  calculateATR,
  calculateVWAP,
  findResistance,
  checkHigherTimeframeBias,
  checkTieredBreakout,
  checkTieredRetest,
  checkMarketRegime,
  checkVolatilityGate,
  checkTieredExitRules,
  selectTier,
  type Candle,
  type TradeTier,
} from "./strategy";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy/config";
import { analyzeClosedTrade, computeLearningPenalty } from "./strategy/learning";
import { isAlpacaConfigured, fetchBarsForDate, fetchDailyBarsForDate, fetchMultiDayDailyBars } from "./alpaca";

const BACKTEST_TICKERS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "JPM", "V", "NFLX", "CRM", "AVGO", "LLY"
];

const SIM_CONFIG = {
  slippageBps: 5,
  spreadBps: 3,
  commissionPerShare: 0.005,
  minCommission: 1.0,
};

function applySlippage(price: number, direction: "entry" | "exit", side: "long"): number {
  const totalBps = SIM_CONFIG.slippageBps + SIM_CONFIG.spreadBps;
  const pctAdj = totalBps / 10000;
  if (side === "long") {
    return direction === "entry" ? price * (1 + pctAdj) : price * (1 - pctAdj);
  }
  return price;
}

function calculateCommission(shares: number): number {
  return Math.max(SIM_CONFIG.minCommission, shares * SIM_CONFIG.commissionPerShare);
}

interface HistoricalTickerState {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  bars5m: Candle[];
  bars15m: Candle[];
  signalState: "IDLE" | "BREAKOUT" | "RETEST" | "TRIGGERED";
  resistanceLevel: number | null;
  breakoutCandle: Candle | null;
  retestBars: Candle[];
  barCount: number;
  dayVolume: number;
  rvol: number;
  atr14: number;
  vwap: number;
  prevDayHigh: number;
  prevDayLow: number;
  yesterdayRange: number;
  dailyATRbaseline: number;
  spreadPct: number;
  minutesSinceOpen: number;
  selectedTier: TradeTier | null;
  retestBarsSinceBreakout: number;
  lastBreakoutBarIndex: number;
  activeTrade: {
    entryPrice: number;
    stopPrice: number;
    originalStopPrice: number;
    target1: number;
    target2: number;
    shares: number;
    isPartiallyExited: boolean;
    partialExitPrice: number | null;
    partialExitShares: number | null;
    stopMovedToBE: boolean;
    runnerShares: number | null;
    trailingStopPrice: number | null;
    entryBarIndex: number;
    dollarRisk: number;
    score: number;
    scoreTier: string;
    tier: TradeTier;
    direction: "LONG";
    realizedR: number;
    riskPerShare: number;
    signalId: string | null;
  } | null;
}

const activeSimulations = new Map<string, { cancel: boolean }>();
let autoRunState: {
  active: boolean;
  cancel: boolean;
  userId: string;
  startedAt: number;
  durationMinutes: number;
  datesCompleted: string[];
  datesRemaining: string[];
  currentDate: string | null;
  totalTrades: number;
  totalLessons: number;
  totalPnl: number;
  skippedByLearning: number;
} | null = null;

export function getActiveSimulations(): string[] {
  return Array.from(activeSimulations.keys());
}

export function getAutoRunStatus() {
  if (!autoRunState) return null;
  const elapsed = (Date.now() - autoRunState.startedAt) / 1000;
  const remaining = Math.max(0, autoRunState.durationMinutes * 60 - elapsed);
  return {
    active: autoRunState.active,
    elapsedSeconds: Math.round(elapsed),
    remainingSeconds: Math.round(remaining),
    durationMinutes: autoRunState.durationMinutes,
    datesCompleted: autoRunState.datesCompleted,
    datesRemaining: autoRunState.datesRemaining,
    currentDate: autoRunState.currentDate,
    totalTrades: autoRunState.totalTrades,
    totalLessons: autoRunState.totalLessons,
    totalPnl: Number(autoRunState.totalPnl.toFixed(2)),
    skippedByLearning: autoRunState.skippedByLearning,
  };
}

export function cancelAutoRun(): boolean {
  if (autoRunState && autoRunState.active) {
    autoRunState.cancel = true;
    activeSimulations.forEach((sim) => {
      sim.cancel = true;
    });
    return true;
  }
  return false;
}

function getWeekdaysGoingBack(fromDate: Date, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(fromDate);
  d.setDate(d.getDate() - 1);
  while (dates.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(d.toISOString().split("T")[0]);
    }
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

export async function startAutoRun(
  userId: string,
  durationMinutes: number,
  storage: IStorage
): Promise<{ started: boolean; message: string }> {
  if (autoRunState?.active) {
    return { started: false, message: "Auto-run is already active." };
  }

  const maxDates = Math.max(3, Math.ceil(durationMinutes * 2));
  const dates = getWeekdaysGoingBack(new Date(), maxDates);

  autoRunState = {
    active: true,
    cancel: false,
    userId,
    startedAt: Date.now(),
    durationMinutes,
    datesCompleted: [],
    datesRemaining: [...dates],
    currentDate: null,
    totalTrades: 0,
    totalLessons: 0,
    totalPnl: 0,
    skippedByLearning: 0,
  };

  log(`[AutoRun] Starting ${durationMinutes}-minute auto-run across ${dates.length} dates`, "historical");

  runAutoRunLoop(userId, storage).catch((err) => {
    log(`[AutoRun] Error: ${err.message}`, "historical");
  });

  return { started: true, message: `Auto-run started for ${durationMinutes} minutes across ${dates.length} trading days.` };
}

async function runAutoRunLoop(userId: string, storage: IStorage) {
  if (!autoRunState) return;

  const deadline = autoRunState.startedAt + autoRunState.durationMinutes * 60 * 1000;

  while (autoRunState.datesRemaining.length > 0 && Date.now() < deadline && !autoRunState.cancel) {
    const date = autoRunState.datesRemaining.shift()!;
    autoRunState.currentDate = date;

    log(`[AutoRun] Simulating ${date} (${autoRunState.datesCompleted.length + 1}/${autoRunState.datesCompleted.length + autoRunState.datesRemaining.length + 1})`, "historical");

    const run = await storage.createSimulationRun({
      userId,
      simulationDate: date,
      status: "pending",
      tickers: null,
    });

    await runHistoricalSimulation(run.id, date, userId, storage);

    const completedRun = await storage.getSimulationRun(run.id);
    if (completedRun) {
      autoRunState.totalTrades += completedRun.tradesGenerated ?? 0;
      autoRunState.totalLessons += completedRun.lessonsGenerated ?? 0;
      autoRunState.totalPnl += completedRun.totalPnl ?? 0;
    }

    autoRunState.datesCompleted.push(date);

    if (Date.now() >= deadline) {
      log(`[AutoRun] Time limit reached after ${autoRunState.datesCompleted.length} dates`, "historical");
      break;
    }
  }

  autoRunState.active = false;
  autoRunState.currentDate = null;
  log(`[AutoRun] Finished: ${autoRunState.datesCompleted.length} dates, ${autoRunState.totalTrades} trades, ${autoRunState.totalLessons} lessons, P&L: $${autoRunState.totalPnl.toFixed(2)}`, "historical");
}

export function incrementAutoRunSkipped() {
  if (autoRunState) {
    autoRunState.skippedByLearning++;
  }
}

export function cancelSimulation(runId: string): boolean {
  const sim = activeSimulations.get(runId);
  if (sim) {
    sim.cancel = true;
    return true;
  }
  return false;
}

export async function runHistoricalSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList?: string[]
): Promise<void> {
  const tickers = tickerList ?? BACKTEST_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));

  const control = { cancel: false };
  activeSimulations.set(runId, control);

  try {
    await storage.updateSimulationRun(runId, { status: "running", tickers });

    if (!isAlpacaConfigured()) {
      await storage.updateSimulationRun(runId, {
        status: "failed",
        errorMessage: "Alpaca API keys not configured. Historical data requires Alpaca integration.",
        completedAt: new Date(),
      });
      return;
    }

    log(`[HistSim] Fetching 5m bars for ${simulationDate}...`, "historical");
    const bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");

    log(`[HistSim] Fetching 15m bars for ${simulationDate}...`, "historical");
    const bars15mMap = await fetchBarsForDate(allSymbols, simulationDate, "15Min");

    log(`[HistSim] Fetching previous day bars...`, "historical");
    const prevDayBars = await fetchDailyBarsForDate(allSymbols, simulationDate);

    log(`[HistSim] Fetching 20-day daily bars for RVOL/ATR baseline...`, "historical");
    const multiDayBars = await fetchMultiDayDailyBars(allSymbols, simulationDate, 20);

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      await storage.updateSimulationRun(runId, {
        status: "failed",
        errorMessage: `No SPY data available for ${simulationDate}. Markets may have been closed.`,
        completedAt: new Date(),
      });
      return;
    }

    let totalBars = 0;
    for (const t of tickers) {
      totalBars += (bars5mMap.get(t) ?? []).length;
    }

    await storage.updateSimulationRun(runId, { totalBars });

    const user = await storage.getUser(userId);
    if (!user) {
      await storage.updateSimulationRun(runId, {
        status: "failed",
        errorMessage: "User not found",
        completedAt: new Date(),
      });
      return;
    }

    const tieredConfig = buildTieredConfigFromUser(user);
    let processedBars = 0;
    let tradesGenerated = 0;
    let lessonsGenerated = 0;
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossPnlTotal = 0;
    let totalCommissions = 0;
    let totalSlippageCosts = 0;
    const tradeRs: number[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const skippedSetups: Array<{ ticker: string; score: number; penalty: number; reason: string; barIndex: number; price: number }> = [];

    for (const ticker of tickers) {
      if (control.cancel) {
        await storage.updateSimulationRun(runId, {
          status: "cancelled",
          processedBars,
          tradesGenerated,
          lessonsGenerated,
          totalPnl: Number(totalPnl.toFixed(2)),
          completedAt: new Date(),
        });
        return;
      }

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const prevDay = prevDayBars.get(ticker);
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 10) {
        processedBars += tickerBars5m.length;
        log(`[HistSim] ${ticker} skipped - only ${tickerBars5m.length} bars (need 10+)`, "historical");
        continue;
      }

      const avgDailyVolume = dailyHistory.length > 1
        ? dailyHistory.slice(0, -1).reduce((s, b) => s + b.volume, 0) / (dailyHistory.length - 1)
        : 0;

      let dailyATRbaseline = 0;
      if (dailyHistory.length >= 5) {
        const ranges = dailyHistory.slice(-5).map(b => b.high - b.low);
        dailyATRbaseline = ranges.reduce((s, r) => s + r, 0) / ranges.length;
        dailyATRbaseline = dailyATRbaseline / 78 * 1.2;
      } else if (prevDay) {
        dailyATRbaseline = (prevDay.high - prevDay.low) / 78 * 1.2;
      } else {
        dailyATRbaseline = tickerBars5m[0].open * 0.002;
      }

      const state: HistoricalTickerState = {
        ticker,
        price: tickerBars5m[0].open,
        open: tickerBars5m[0].open,
        high: tickerBars5m[0].high,
        low: tickerBars5m[0].low,
        volume: 0,
        bars5m: [],
        bars15m: [],
        signalState: "IDLE",
        resistanceLevel: null,
        breakoutCandle: null,
        retestBars: [],
        barCount: 0,
        dayVolume: 0,
        rvol: 1.0,
        atr14: 0,
        vwap: 0,
        prevDayHigh: prevDay ? prevDay.high : tickerBars5m[0].open * 1.01,
        prevDayLow: prevDay ? prevDay.low : tickerBars5m[0].open * 0.99,
        yesterdayRange: prevDay ? (prevDay.high - prevDay.low) : tickerBars5m[0].open * 0.02,
        dailyATRbaseline,
        spreadPct: 0.02,
        minutesSinceOpen: 0,
        selectedTier: null,
        retestBarsSinceBreakout: 0,
        lastBreakoutBarIndex: -100,
        activeTrade: null,
      };

      let lastRegimeResult = checkMarketRegime([], DEFAULT_STRATEGY_CONFIG.marketRegime);

      let diag = { resistFound: 0, breakoutsAboveResist: 0, tierSelected: 0, boQualified: 0, retestValid: 0, entryAttempted: 0 };

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        state.bars5m.push(bar);
        if (state.bars5m.length > 200) state.bars5m.shift();
        state.barCount++;
        state.minutesSinceOpen = (i + 1) * 5;
        state.price = bar.close;
        state.high = Math.max(state.high, bar.high);
        state.low = Math.min(state.low, bar.low);
        state.dayVolume += bar.volume;
        state.volume = bar.volume;

        if (avgDailyVolume > 0 && state.barCount > 0) {
          const fractionOfDay = state.barCount / 78;
          const expectedVolume = avgDailyVolume * fractionOfDay;
          state.rvol = expectedVolume > 0 ? state.dayVolume / expectedVolume : 1.0;
        }

        if (state.barCount % 3 === 0 && state.bars5m.length >= 3) {
          const last3 = state.bars5m.slice(-3);
          const bar15m: Candle = {
            open: last3[0].open,
            high: Math.max(...last3.map(c => c.high)),
            low: Math.min(...last3.map(c => c.low)),
            close: last3[2].close,
            volume: last3.reduce((s, c) => s + c.volume, 0),
            timestamp: bar.timestamp,
          };
          state.bars15m.push(bar15m);
          if (state.bars15m.length > 100) state.bars15m.shift();
        }

        state.atr14 = calculateATR(state.bars5m, 14);
        state.vwap = calculateVWAP(state.bars5m);

        const spyBarsToNow = spyBars5m.filter(b => b.timestamp <= bar.timestamp);
        const regimeResult = checkMarketRegime(spyBarsToNow.slice(-40), DEFAULT_STRATEGY_CONFIG.marketRegime);
        lastRegimeResult = regimeResult;

        const volGateResult = checkVolatilityGate(
          state.bars5m,
          state.yesterdayRange,
          state.dailyATRbaseline,
          DEFAULT_STRATEGY_CONFIG.volatilityGate
        );

        if (i < 5) {
          processedBars++;
          continue;
        }

        const biasResult = checkHigherTimeframeBias(
          state.bars15m,
          state.prevDayHigh,
          state.prevDayHigh * 1.005,
          state.price,
          DEFAULT_STRATEGY_CONFIG.higherTimeframe
        );

        const accountSize = user.accountSize ?? 100000;

        if (state.activeTrade) {
          const trade = state.activeTrade;
          const riskPerShare = trade.riskPerShare;
          const minutesSinceEntry = (i - trade.entryBarIndex) * 5;

          const exitResult = checkTieredExitRules(
            bar,
            state.bars5m.slice(-10),
            trade.entryPrice,
            trade.stopPrice,
            trade.shares,
            trade.isPartiallyExited,
            riskPerShare,
            minutesSinceEntry,
            tieredConfig.exits,
            tieredConfig.risk,
            state.atr14
          );

          if (exitResult.shouldExit) {
            let exitPrice = applySlippage(exitResult.exitPrice ?? bar.close, "exit", "long");
            let exitReason = exitResult.reason || "exit";
            const shares = trade.shares;

            if (exitResult.exitType === "partial") {
              const partialShares = exitResult.partialShares ?? Math.floor(shares * (tieredConfig.exits.partialPct / 100));
              trade.isPartiallyExited = true;
              trade.partialExitPrice = exitPrice;
              trade.partialExitShares = partialShares;
              trade.runnerShares = shares - partialShares;
              trade.stopMovedToBE = true;
              if (exitResult.newStopPrice) {
                trade.stopPrice = exitResult.newStopPrice;
              } else {
                trade.stopPrice = trade.entryPrice;
              }
              trade.realizedR += (exitPrice - trade.entryPrice) / riskPerShare * (partialShares / shares);
              processedBars++;
              continue;
            }

            const grossPnl = (exitPrice - trade.entryPrice) * shares;
            const commission = calculateCommission(shares) * 2;
            const pnl = grossPnl - commission;
            log(`[HistSim] ${ticker} slippage cost: $${(grossPnl - pnl).toFixed(2)}`, "historical");
            const rMultiple = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : 0;
            const pnlPct = trade.entryPrice > 0 ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++;
            else lossCount++;
            grossPnlTotal += grossPnl;
            totalCommissions += commission;
            const slippageCost = trade.entryPrice * shares * (SIM_CONFIG.slippageBps + SIM_CONFIG.spreadBps) / 10000 * 2;
            totalSlippageCosts += slippageCost;
            tradeRs.push(totalR);
            tradeGrossPnls.push(grossPnl);
            tradeNetPnls.push(pnl);
            const trSession = state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power";
            const trRegime = regimeResult.aligned ? "trending" : regimeResult.chopping ? "choppy" : "neutral";
            const trTier = trade.tier;
            if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesByTier[trTier]) tradesByTier[trTier] = { wins: 0, losses: 0, pnl: 0 };
            tradesByRegime[trRegime].pnl += pnl;
            tradesBySession[trSession].pnl += pnl;
            tradesByTier[trTier].pnl += pnl;
            if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier[trTier].wins++; }
            else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier[trTier].losses++; }

            const tradeRecord = await storage.createTrade({
              userId,
              signalId: trade.signalId,
              ticker,
              side: "long",
              entryPrice: Number(trade.entryPrice.toFixed(2)),
              exitPrice: Number(exitPrice.toFixed(2)),
              stopPrice: Number(trade.originalStopPrice.toFixed(2)),
              originalStopPrice: Number(trade.originalStopPrice.toFixed(2)),
              target1: Number(trade.target1.toFixed(2)),
              target2: Number(trade.target2.toFixed(2)),
              shares,
              pnl: Number(pnl.toFixed(2)),
              pnlPercent: Number(pnlPct.toFixed(2)),
              rMultiple: Number(totalR.toFixed(2)),
              status: "closed",
              exitReason: `[SIM] ${exitReason}`,
              isPartiallyExited: trade.isPartiallyExited,
              partialExitPrice: trade.partialExitPrice ? Number(trade.partialExitPrice.toFixed(2)) : null,
              partialExitShares: trade.partialExitShares,
              stopMovedToBE: trade.stopMovedToBE,
              runnerShares: trade.runnerShares,
              trailingStopPrice: trade.trailingStopPrice ? Number(trade.trailingStopPrice.toFixed(2)) : null,
              dollarRisk: Number(trade.dollarRisk.toFixed(2)),
              score: trade.score,
              scoreTier: trade.scoreTier,
              entryMode: "conservative",
              isPowerSetup: false,
              realizedR: Number(totalR.toFixed(2)),
              tier: trade.tier,
              direction: "LONG",
            });

            tradesGenerated++;

            const signal = trade.signalId ? (await storage.getSignalById(trade.signalId)) ?? null : null;
            const lessonResult = analyzeClosedTrade({
              trade: {
                ...tradeRecord,
                enteredAt: new Date(bar.timestamp - minutesSinceEntry * 60000),
                exitedAt: new Date(bar.timestamp),
              },
              signal,
              spyAligned: regimeResult.aligned,
              isLunchChop: state.minutesSinceOpen >= 120 && state.minutesSinceOpen <= 240,
              session: state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power",
            });

            await storage.createLesson({
              ...lessonResult,
              exitReason: `[SIM] ${exitReason}`,
              lessonDetail: `[Historical Sim ${simulationDate}] ${lessonResult.lessonDetail}`,
              marketContext: { ...(lessonResult.marketContext as Record<string, any>), simulationDate },
              durationMinutes: minutesSinceEntry,
            });
            lessonsGenerated++;

            state.activeTrade = null;
            state.signalState = "IDLE";
          } else if (exitResult.newStopPrice && exitResult.newStopPrice > trade.stopPrice) {
            trade.trailingStopPrice = exitResult.newStopPrice;
            trade.stopPrice = exitResult.newStopPrice;
          }

          processedBars++;
          continue;
        }

        if (state.signalState === "IDLE" && (i - state.lastBreakoutBarIndex) > 10) {
          const resistance = findResistance(state.bars5m, 30);
          if (resistance) {
            diag.resistFound++;
            const resistDistPct = state.price > 0 ? Math.abs(resistance.level - state.price) / state.price : 1;
            if (resistDistPct <= 0.03) {
              state.resistanceLevel = resistance.level;
            }
          }

          if (state.resistanceLevel && bar.close > state.resistanceLevel) {
            diag.breakoutsAboveResist++;
            const avgVol = state.bars5m.length > 20
              ? state.bars5m.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20
              : state.bars5m.slice(0, -1).reduce((s, b) => s + b.volume, 0) / Math.max(state.bars5m.length - 1, 1);
            const volRatio = bar.volume / Math.max(avgVol, 1);

            const rawAtr = calculateATR(state.bars5m, 14);
            const atrRatio = state.dailyATRbaseline > 0 ? rawAtr / state.dailyATRbaseline : 1.0;

            const tier = selectTier(volRatio, atrRatio, tieredConfig);

            if (tier) {
              diag.tierSelected++;
              const breakoutResult = checkTieredBreakout(
                bar, state.bars5m.slice(0, -1), state.resistanceLevel,
                "RESISTANCE", tieredConfig.tiers[tier], tieredConfig.strategy
              );

              if (breakoutResult.qualified) {
                diag.boQualified++;
                state.signalState = "BREAKOUT";
                state.breakoutCandle = bar;
                state.selectedTier = tier;
                state.retestBarsSinceBreakout = 0;
                state.lastBreakoutBarIndex = i;

                await storage.createSignal({
                  userId,
                  ticker,
                  state: "BREAKOUT",
                  resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
                  currentPrice: Number(state.price.toFixed(2)),
                  breakoutPrice: Number(state.price.toFixed(2)),
                  breakoutVolume: bar.volume,
                  trendConfirmed: biasResult.aligned,
                  volumeConfirmed: true,
                  atrExpansion: atrRatio >= 1.1,
                  timeframe: "5m",
                  rvol: Number(state.rvol.toFixed(2)),
                  atrValue: Number(state.atr14.toFixed(4)),
                  rejectionCount: 2,
                  score: Math.round(volRatio * 30 + atrRatio * 20),
                  scoreTier: tier,
                  marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                  spyAligned: regimeResult.aligned,
                  volatilityGatePassed: volGateResult.passes,
                  scoreBreakdown: { volRatio, atrRatio, tier, simDate: simulationDate },
                  relStrengthVsSpy: 0,
                  isPowerSetup: false,
                  tier,
                  direction: "LONG",
                  notes: `[SIM ${simulationDate}] Tier ${tier} breakout above $${state.resistanceLevel.toFixed(2)}`,
                });

                log(`[HistSim] ${ticker} BREAKOUT at $${state.price.toFixed(2)} (Tier ${tier}) on ${simulationDate}`, "historical");
              }
            }
          }
        }

        if (state.signalState === "BREAKOUT" && state.resistanceLevel && state.breakoutCandle && state.selectedTier) {
          state.retestBarsSinceBreakout++;
          const tierConfig = tieredConfig.tiers[state.selectedTier];

          if (state.retestBarsSinceBreakout > tierConfig.retestTimeoutCandles) {
            state.signalState = "IDLE";
            state.selectedTier = null;
            state.breakoutCandle = null;
            state.retestBars = [];
          } else {
            const retestResult = checkTieredRetest(
              bar, state.breakoutCandle, state.retestBars, state.resistanceLevel,
              "RESISTANCE", state.bars5m, tierConfig, "LONG"
            );

            if (retestResult.valid && retestResult.entryPrice && retestResult.stopPrice) {
              diag.retestValid++;
              const entryPrice = applySlippage(retestResult.entryPrice, "entry", "long");
              const stopPrice = retestResult.stopPrice;
              const riskPerShare = Math.abs(entryPrice - stopPrice);

              if (riskPerShare > 0) {
                const dollarRisk = accountSize * tieredConfig.tiers[state.selectedTier].riskPct;
                const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));
                const target1 = entryPrice + riskPerShare * (tieredConfig.exits.partialAtR ?? 1.5);
                const target2 = entryPrice + riskPerShare * (tieredConfig.exits.finalTargetR ?? 2.5);
                const rvolScore = state.rvol >= 2.0 ? 20 : state.rvol >= 1.5 ? 18 : state.rvol >= 1.0 ? 14 : state.rvol >= 0.7 ? 10 : 5;
                const trendScore = biasResult.aligned ? 15 : 8;
                const boVolScore = 20;
                const retestScore = 15;
                const regimeScore = regimeResult.aligned ? 15 : regimeResult.chopping ? 0 : 8;
                const atrScore = state.atr14 > state.dailyATRbaseline * 1.3 ? 10 : 5;
                let score = Math.min(100, rvolScore + trendScore + boVolScore + retestScore + regimeScore + atrScore);

                const session = state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power";
                let appliedPenalty = 0;
                try {
                  const recentLessons = (await storage.getRecentLessons(100)).filter(l => {
                    const ctx = l.marketContext as Record<string, any> | null;
                    if (ctx?.simulationDate) {
                      return ctx.simulationDate < simulationDate;
                    }
                    return true;
                  });
                  const penaltyResult = computeLearningPenalty(
                    recentLessons.map(l => ({
                      ticker: l.ticker,
                      tier: l.tier,
                      outcomeCategory: l.outcomeCategory,
                      lessonTags: l.lessonTags,
                      marketContext: l.marketContext,
                      pnl: l.pnl,
                      scoreAtEntry: l.scoreAtEntry,
                    })),
                    ticker,
                    state.selectedTier ?? "C",
                    regimeResult.aligned,
                    session
                  );

                  if (penaltyResult.penalty > 0) {
                    const cappedPenalty = Math.min(penaltyResult.penalty, 20);
                    appliedPenalty = cappedPenalty;
                    score = Math.max(0, score - cappedPenalty);
                    log(`[HistSim] ${ticker} LEARNING PENALTY: -${cappedPenalty} pts (raw: -${penaltyResult.penalty}), score ${score + cappedPenalty} -> ${score}. ${penaltyResult.reasons.join("; ")}`, "historical");
                  }
                } catch (lpErr) {
                  log(`[HistSim] Learning penalty error: ${lpErr}`, "historical");
                }

                const minScore = DEFAULT_STRATEGY_CONFIG.scoring.halfSizeMin;
                if (score < minScore) {
                  log(`[HistSim] ${ticker} SKIPPED entry - score ${score} below threshold ${minScore} after learning penalty`, "historical");
                  incrementAutoRunSkipped();
                  skippedSetups.push({
                    ticker,
                    score,
                    penalty: appliedPenalty,
                    reason: `Score ${score} below ${minScore}`,
                    barIndex: i,
                    price: bar.close,
                  });
                  state.signalState = "IDLE";
                  state.selectedTier = null;
                  processedBars++;
                  continue;
                }

                state.signalState = "TRIGGERED";
                state.activeTrade = {
                  entryPrice,
                  stopPrice,
                  originalStopPrice: stopPrice,
                  target1,
                  target2,
                  shares,
                  isPartiallyExited: false,
                  partialExitPrice: null,
                  partialExitShares: null,
                  stopMovedToBE: false,
                  runnerShares: null,
                  trailingStopPrice: null,
                  entryBarIndex: i,
                  dollarRisk,
                  score,
                  scoreTier: state.selectedTier,
                  tier: state.selectedTier,
                  direction: "LONG",
                  realizedR: 0,
                  riskPerShare,
                  signalId: null,
                };

                log(`[HistSim] ${ticker} ENTRY at $${entryPrice.toFixed(2)} stop=$${stopPrice.toFixed(2)} (Tier ${state.selectedTier}) on ${simulationDate}`, "historical");
              } else {
                state.signalState = "IDLE";
                state.selectedTier = null;
              }
            } else {
              state.retestBars.push(bar);
            }
          }
        }

        processedBars++;

        if (processedBars % 20 === 0) {
          await storage.updateSimulationRun(runId, {
            processedBars,
            tradesGenerated,
            lessonsGenerated,
            totalPnl: Number(totalPnl.toFixed(2)),
          });
        }
      }

      log(`[HistSim] ${ticker} pipeline: bars=${tickerBars5m.length}, resistFound=${diag.resistFound}, closedAbove=${diag.breakoutsAboveResist}, tierOk=${diag.tierSelected}, boQualified=${diag.boQualified}, retestValid=${diag.retestValid}, rvol=${state.rvol.toFixed(2)}, atrBase=${state.dailyATRbaseline.toFixed(4)}`, "historical");

      if (state.activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = state.activeTrade;
        const exitPrice = applySlippage(lastBar.close, "exit", "long");
        const grossPnl = (exitPrice - trade.entryPrice) * trade.shares;
        const commission = calculateCommission(trade.shares) * 2;
        const pnl = grossPnl - commission;
        log(`[HistSim] ${ticker} slippage cost: $${(grossPnl - pnl).toFixed(2)}`, "historical");
        const rMultiple = trade.riskPerShare > 0 ? (exitPrice - trade.entryPrice) / trade.riskPerShare : 0;
        const totalR = trade.realizedR + rMultiple;
        totalPnl += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;
        grossPnlTotal += grossPnl;
        totalCommissions += commission;
        const slippageCost2 = trade.entryPrice * trade.shares * (SIM_CONFIG.slippageBps + SIM_CONFIG.spreadBps) / 10000 * 2;
        totalSlippageCosts += slippageCost2;
        tradeRs.push(totalR);
        tradeGrossPnls.push(grossPnl);
        tradeNetPnls.push(pnl);
        const trRegime2 = lastRegimeResult.aligned ? "trending" : lastRegimeResult.chopping ? "choppy" : "neutral";
        const trTier2 = trade.tier;
        if (!tradesByRegime[trRegime2]) tradesByRegime[trRegime2] = { wins: 0, losses: 0, pnl: 0 };
        if (!tradesBySession["power"]) tradesBySession["power"] = { wins: 0, losses: 0, pnl: 0 };
        if (!tradesByTier[trTier2]) tradesByTier[trTier2] = { wins: 0, losses: 0, pnl: 0 };
        tradesByRegime[trRegime2].pnl += pnl;
        tradesBySession["power"].pnl += pnl;
        tradesByTier[trTier2].pnl += pnl;
        if (pnl > 0) { tradesByRegime[trRegime2].wins++; tradesBySession["power"].wins++; tradesByTier[trTier2].wins++; }
        else { tradesByRegime[trRegime2].losses++; tradesBySession["power"].losses++; tradesByTier[trTier2].losses++; }

        const tradeRecord = await storage.createTrade({
          userId,
          signalId: trade.signalId,
          ticker,
          side: "long",
          entryPrice: Number(trade.entryPrice.toFixed(2)),
          exitPrice: Number(exitPrice.toFixed(2)),
          stopPrice: Number(trade.originalStopPrice.toFixed(2)),
          originalStopPrice: Number(trade.originalStopPrice.toFixed(2)),
          target1: Number(trade.target1.toFixed(2)),
          target2: Number(trade.target2.toFixed(2)),
          shares: trade.shares,
          pnl: Number(pnl.toFixed(2)),
          pnlPercent: Number(((exitPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2)),
          rMultiple: Number(totalR.toFixed(2)),
          status: "closed",
          exitReason: "[SIM] End of day close",
          isPartiallyExited: trade.isPartiallyExited,
          partialExitPrice: trade.partialExitPrice ? Number(trade.partialExitPrice.toFixed(2)) : null,
          partialExitShares: trade.partialExitShares,
          stopMovedToBE: trade.stopMovedToBE,
          runnerShares: trade.runnerShares,
          trailingStopPrice: trade.trailingStopPrice ? Number(trade.trailingStopPrice.toFixed(2)) : null,
          dollarRisk: Number(trade.dollarRisk.toFixed(2)),
          score: trade.score,
          scoreTier: trade.scoreTier,
          entryMode: "conservative",
          isPowerSetup: false,
          realizedR: Number(totalR.toFixed(2)),
          tier: trade.tier,
          direction: "LONG",
        });

        tradesGenerated++;

        const lessonResult = analyzeClosedTrade({
          trade: {
            ...tradeRecord,
            enteredAt: new Date(lastBar.timestamp - (tickerBars5m.length - trade.entryBarIndex) * 5 * 60000),
            exitedAt: new Date(lastBar.timestamp),
          },
          signal: null,
          spyAligned: lastRegimeResult.aligned,
          isLunchChop: false,
          session: "power",
        });

        await storage.createLesson({
          ...lessonResult,
          exitReason: "[SIM] End of day close",
          lessonDetail: `[Historical Sim ${simulationDate}] ${lessonResult.lessonDetail}`,
          marketContext: { ...(lessonResult.marketContext as Record<string, any>), simulationDate },
          durationMinutes: (tickerBars5m.length - trade.entryBarIndex) * 5,
        });
        lessonsGenerated++;

        state.activeTrade = null;
      }
    }

    const buyHoldReturns: Record<string, number> = {};
    let totalBuyHoldPnl = 0;
    for (const ticker of tickers) {
      const bars = bars5mMap.get(ticker);
      if (bars && bars.length >= 2) {
        const openPrice = bars[0].open;
        const closePrice = bars[bars.length - 1].close;
        const shares = Math.floor(10000 / openPrice);
        const bhPnl = (closePrice - openPrice) * shares;
        buyHoldReturns[ticker] = Number(bhPnl.toFixed(2));
        totalBuyHoldPnl += bhPnl;
      }
    }

    let baselinePnl = 0;
    for (const ticker of tickers) {
      const bars = bars5mMap.get(ticker);
      if (!bars || bars.length < 25) continue;
      let ema5 = bars[0].close;
      let ema20 = bars[0].close;
      let baselineEntry: number | null = null;
      const k5 = 2 / 6, k20 = 2 / 21;
      for (let bi = 1; bi < bars.length; bi++) {
        const prevEma5 = ema5, prevEma20 = ema20;
        ema5 = bars[bi].close * k5 + ema5 * (1 - k5);
        ema20 = bars[bi].close * k20 + ema20 * (1 - k20);
        if (prevEma5 <= prevEma20 && ema5 > ema20 && !baselineEntry && bi > 5) {
          baselineEntry = bars[bi].close;
        }
      }
      if (baselineEntry) {
        const shares = Math.floor(10000 / baselineEntry);
        baselinePnl += (bars[bars.length - 1].close - baselineEntry) * shares;
      }
    }

    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : null;
    const avgR = tradeRs.length > 0 ? tradeRs.reduce((a, b) => a + b, 0) / tradeRs.length : 0;
    const grossWins = tradeNetPnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
    const grossLosses = Math.abs(tradeNetPnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

    let peak = 0, maxDD = 0, equity = 0;
    for (const pnl of tradeNetPnls) {
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    const avgPnl = tradeNetPnls.length > 0 ? tradeNetPnls.reduce((a, b) => a + b, 0) / tradeNetPnls.length : 0;
    const stdPnl = tradeNetPnls.length > 1 ? Math.sqrt(tradeNetPnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / (tradeNetPnls.length - 1)) : 0;
    const sharpe = stdPnl > 0 ? (avgPnl / stdPnl) * Math.sqrt(252) : 0;
    const avgSlippage = totalTrades > 0 ? totalSlippageCosts / totalTrades : 0;

    await storage.updateSimulationRun(runId, {
      status: "completed",
      processedBars,
      tradesGenerated,
      lessonsGenerated,
      totalPnl: Number(totalPnl.toFixed(2)),
      grossPnl: Number(grossPnlTotal.toFixed(2)),
      totalCommission: Number(totalCommissions.toFixed(2)),
      totalSlippageCost: Number(totalSlippageCosts.toFixed(2)),
      winRate: winRate !== null ? Number(winRate.toFixed(1)) : null,
      benchmarks: {
        buyAndHold: Number(totalBuyHoldPnl.toFixed(2)),
        buyAndHoldByTicker: buyHoldReturns,
        emaBaseline: Number(baselinePnl.toFixed(2)),
      },
      metrics: {
        expectancy: Number(avgR.toFixed(3)),
        profitFactor: Number(profitFactor.toFixed(2)),
        maxDrawdown: Number(maxDD.toFixed(2)),
        sharpe: Number(sharpe.toFixed(2)),
        avgSlippagePerTrade: Number(avgSlippage.toFixed(2)),
        avgCommissionPerTrade: totalTrades > 0 ? Number((totalCommissions / totalTrades).toFixed(2)) : 0,
        totalR: Number(tradeRs.reduce((a, b) => a + b, 0).toFixed(2)),
      },
      breakdown: {
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      },
      skippedSetups: skippedSetups.slice(0, 50),
      completedAt: new Date(),
    });

    log(`[HistSim] Completed simulation for ${simulationDate}: ${tradesGenerated} trades, ${lessonsGenerated} lessons, P&L: $${totalPnl.toFixed(2)}`, "historical");
  } catch (error: any) {
    log(`[HistSim] Error: ${error.message}`, "historical");
    await storage.updateSimulationRun(runId, {
      status: "failed",
      errorMessage: error.message,
      completedAt: new Date(),
    });
  } finally {
    activeSimulations.delete(runId);
  }
}
