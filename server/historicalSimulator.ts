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
import { analyzeClosedTrade } from "./strategy/learning";
import { isAlpacaConfigured, fetchBarsForDate, fetchDailyBarsForDate } from "./alpaca";

const BACKTEST_TICKERS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "JPM", "V", "NFLX", "CRM", "AVGO", "LLY"
];

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

export function getActiveSimulations(): string[] {
  return Array.from(activeSimulations.keys());
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
  const allSymbols = [...new Set([...tickers, "SPY"])];

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

      if (tickerBars5m.length < 10) {
        processedBars += tickerBars5m.length;
        continue;
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
        rvol: 1.5,
        atr14: 0,
        vwap: 0,
        prevDayHigh: prevDay ? prevDay.high : tickerBars5m[0].open * 1.01,
        prevDayLow: prevDay ? prevDay.low : tickerBars5m[0].open * 0.99,
        yesterdayRange: prevDay ? (prevDay.high - prevDay.low) : tickerBars5m[0].open * 0.02,
        dailyATRbaseline: prevDay ? ((prevDay.high - prevDay.low) * 0.15) : tickerBars5m[0].open * 0.003,
        spreadPct: 0.02,
        minutesSinceOpen: 0,
        selectedTier: null,
        retestBarsSinceBreakout: 0,
        lastBreakoutBarIndex: -100,
        activeTrade: null,
      };

      let lastRegimeResult = checkMarketRegime([], DEFAULT_STRATEGY_CONFIG.marketRegime);

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
            let exitPrice = exitResult.exitPrice ?? bar.close;
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

            const pnl = (exitPrice - trade.entryPrice) * shares;
            const rMultiple = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : 0;
            const pnlPct = trade.entryPrice > 0 ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++;
            else lossCount++;

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

            const signal = trade.signalId ? await storage.getSignalById(trade.signalId) : null;
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
            const resistDistPct = state.price > 0 ? Math.abs(resistance.level - state.price) / state.price : 1;
            if (resistDistPct <= 0.03) {
              state.resistanceLevel = resistance.level;
            }
          }

          if (state.resistanceLevel && bar.close > state.resistanceLevel) {
            const avgVol = state.bars5m.length > 20
              ? state.bars5m.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20
              : state.bars5m.slice(0, -1).reduce((s, b) => s + b.volume, 0) / Math.max(state.bars5m.length - 1, 1);
            const volRatio = bar.volume / Math.max(avgVol, 1);

            const rawAtr = calculateATR(state.bars5m, 14);
            const atrRatio = state.dailyATRbaseline > 0 ? rawAtr / state.dailyATRbaseline : 1.0;

            const tier = selectTier(volRatio, atrRatio, tieredConfig);

            if (tier) {
              const breakoutResult = checkTieredBreakout(
                bar, state.bars5m.slice(0, -1), state.resistanceLevel,
                "RESISTANCE", tieredConfig.tiers[tier], tieredConfig.strategy
              );

              if (breakoutResult.qualified) {
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
              const entryPrice = retestResult.entryPrice;
              const stopPrice = retestResult.stopPrice;
              const riskPerShare = Math.abs(entryPrice - stopPrice);

              if (riskPerShare > 0) {
                const dollarRisk = accountSize * tieredConfig.tiers[state.selectedTier].riskPct;
                const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));
                const target1 = entryPrice + riskPerShare * (tieredConfig.exits.partialAtR ?? 1.5);
                const target2 = entryPrice + riskPerShare * (tieredConfig.exits.finalTargetR ?? 2.5);
                const score = Math.round((state.rvol > 1.5 ? 20 : 10) + (biasResult.aligned ? 15 : 0) + 20 + 15);

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

      if (state.activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = state.activeTrade;
        const exitPrice = lastBar.close;
        const pnl = (exitPrice - trade.entryPrice) * trade.shares;
        const rMultiple = trade.riskPerShare > 0 ? (exitPrice - trade.entryPrice) / trade.riskPerShare : 0;
        const totalR = trade.realizedR + rMultiple;
        totalPnl += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;

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

    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : null;

    await storage.updateSimulationRun(runId, {
      status: "completed",
      processedBars,
      tradesGenerated,
      lessonsGenerated,
      totalPnl: Number(totalPnl.toFixed(2)),
      winRate: winRate !== null ? Number(winRate.toFixed(1)) : null,
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
