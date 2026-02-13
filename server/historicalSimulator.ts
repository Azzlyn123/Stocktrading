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
import {
  analyzeClosedTrade,
  computeLearningPenalty,
} from "./strategy/learning";
import {
  isAlpacaConfigured,
  fetchBarsForDate,
  fetchDailyBarsForDate,
  fetchMultiDayDailyBars,
} from "./alpaca";
import type { TradeRecord, ExitReasonType } from "./analytics/tradeAnalytics";
import { addTrade } from "./analytics/tradeStore";

function classifyExitReason(reason: string): ExitReasonType {
  const r = reason.toLowerCase();
  if (r.includes("stop hit") || r.includes("stop_loss") || r.includes("structure break") || r.includes("trailing stop")) return "STOP_LOSS";
  if (r.includes("time stop") || r.includes("time_stop")) return "TIME_STOP";
  if (r.includes("hard exit") || r.includes("hard_exit") || r.includes("red candle")) return "HARD_EXIT";
  if (r.includes("target") || r.includes("final target")) return "TARGET_2";
  if (r.includes("end of day") || r.includes("eod")) return "EOD";
  if (r.includes("manual")) return "MANUAL";
  return "UNKNOWN";
}

function buildAnalyticsRecord(
  trade: {
    entryPrice: number;
    stopPrice: number;
    shares: number;
    tier: string;
    direction: string;
    entryBarIndex: number;
  },
  ticker: string,
  exitPrice: number,
  exitReason: string,
  exitBarTimestamp: number,
  entryBarTimestamp: number,
  totalR: number,
  pnl: number,
  tradeId?: string,
): TradeRecord {
  const riskDist = Math.abs(trade.entryPrice - trade.stopPrice);
  return {
    id: tradeId || `${ticker}-${Date.now()}`,
    symbol: ticker,
    tier: trade.tier as "A" | "B" | "C",
    direction: trade.direction as "LONG" | "SHORT",
    entryTime: new Date(entryBarTimestamp).toISOString(),
    exitTime: new Date(exitBarTimestamp).toISOString(),
    entryPrice: Number(trade.entryPrice.toFixed(2)),
    stopPrice: Number(trade.stopPrice.toFixed(2)),
    exitPrice: Number(exitPrice.toFixed(2)),
    qty: trade.shares,
    riskDollars: riskDist === 0 ? 0 : riskDist * trade.shares,
    rMultiple: totalR,
    pnlDollars: pnl,
    durationMinutes: (exitBarTimestamp - entryBarTimestamp) / 60000,
    exitReason: classifyExitReason(exitReason),
    notes: riskDist === 0 ? "invalid risk distance" : undefined,
  };
}

function isTickAligned(price: number, tick = 0.01, eps = 1e-6){
  const q = price / tick;
  return Math.abs(q - Math.round(q)) < eps;
}
const BACKTEST_TICKERS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AMD",
  "JPM",
  "V",
  "NFLX",
  "CRM",
  "AVGO",
  "LLY",
];

type Side = "long" | "short";
type FillDirection = "entry" | "exit";
type ExitKind = "STOP" | "TARGET" | "MARKET" | "EOD";

const SIM_DEBUG = true;

interface TraceStep {
  step: string;
  barIndex: number;
  barTime: number;
  ticker: string;
  decisionPrice: number;
  rawFillPrice: number;
  frictionAdjustedPrice: number;
  finalFillPrice: number;
  slippageBps: number;
  commissionTotal: number;
  rMultiple: number | null;
  pnl: number | null;
  side: "long";
  direction: "entry" | "exit";
  exitKind?: string;
  exitReason?: string;
  isAmbiguousBar?: boolean;
  gapThrough?: boolean;
  notes?: string;
}

interface InvariantViolation {
  rule: string;
  message: string;
  barIndex: number;
  ticker: string;
  context: Record<string, any>;
}

const SIM_ASSERT_THROW = false;

function simAssert(
  condition: boolean,
  message: string,
  violations: InvariantViolation[],
  rule: string,
  barIndex: number,
  ticker: string,
  context?: Record<string, any>,
): void {
  if (!SIM_DEBUG) return;
  if (!condition) {
    const ctxStr = context ? ` | Context: ${JSON.stringify(context)}` : "";
    const err = `[SIM ASSERT FAILED] ${message}${ctxStr}`;
    log(err, "historical");
    violations.push({
      rule,
      message,
      barIndex,
      ticker,
      context: context ?? {},
    });
    if (SIM_ASSERT_THROW) {
      throw new Error(err);
    }
  }
}

const SIM_CONFIG = {
  baseSlippageBps: 2.5,
  halfSpreadBps: 3,
  slippageK: 0.25,
  commissionPerShare: 0.005,
  minCommission: 1.0,
  tickSize: 0.01,
};

interface CostOverrides {
  baseSlippageBps?: number;
  halfSpreadBps?: number;
  slippageK?: number;
  commissionPerShare?: number;
  minCommission?: number;
  tickSize?: number;
}

function effectiveConfig(overrides?: CostOverrides) {
  if (!overrides) return SIM_CONFIG;
  return { ...SIM_CONFIG, ...overrides };
}

interface SimulationBarData {
  bars5mMap: Map<string, Candle[]>;
  bars15mMap: Map<string, Candle[]>;
  prevDayBars: Map<string, any>;
  multiDayBars: Map<string, any[]>;
}

interface CostSensitivityResult {
  baseSlippageBps: number;
  halfSpreadBps: number;
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdown: number;
  netPnl: number;
  grossPnl: number;
  totalCosts: number;
  isBaseline: boolean;
}

type BreakdownBucket = { wins: number; losses: number; pnl: number };

export interface DryRunResult {
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  netPnl: number;
  totalCommissions: number;
  totalSlippageCosts: number;
  tradeRs: number[];
  maxDrawdown: number;
  byRegime: Record<string, BreakdownBucket>;
  bySession: Record<string, BreakdownBucket>;
  byTier: Record<string, BreakdownBucket>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dynamicSlippageBps(
  price: number,
  atr14: number,
  overrides?: CostOverrides,
): number {
  const cfg = effectiveConfig(overrides);
  const ratioBps = price > 0 ? (atr14 / price) * 10000 : 0;
  const unclamped = cfg.baseSlippageBps + cfg.slippageK * ratioBps;
  return clamp(unclamped, cfg.baseSlippageBps, 50);
}

function roundToTick(price: number, tick: number, mode: "up" | "down"): number {
  const q = price / tick;
  const rq = mode === "up" ? Math.ceil(q) : Math.floor(q);
  return Number((rq * tick).toFixed(2));
}

function roundingMode(side: Side, direction: FillDirection): "up" | "down" {
  if (side === "long") return direction === "entry" ? "up" : "down";
  return direction === "entry" ? "down" : "up";
}

function applyFrictionAndRound(params: {
  rawPrice: number;
  side: Side;
  direction: FillDirection;
  atr14: number;
  costOverrides?: CostOverrides;
}): number {
  const { rawPrice, side, direction, atr14, costOverrides } = params;
  const cfg = effectiveConfig(costOverrides);
  const slipBps = dynamicSlippageBps(rawPrice, atr14, costOverrides);
  const totalBps = slipBps + cfg.halfSpreadBps;
  const pct = totalBps / 10000;
  const sign =
    side === "long"
      ? direction === "entry"
        ? +1
        : -1
      : direction === "entry"
        ? -1
        : +1;
  const withFriction = rawPrice * (1 + sign * pct);
  const mode = roundingMode(side, direction);
  return roundToTick(withFriction, cfg.tickSize, mode);
}

function applyFrictionAndRoundWithTrace(params: {
  rawPrice: number;
  side: Side;
  direction: FillDirection;
  atr14: number;
  costOverrides?: CostOverrides;
}): { finalPrice: number; frictionAdjustedPrice: number; slippageBps: number } {
  const { rawPrice, side, direction, atr14, costOverrides } = params;
  const cfg = effectiveConfig(costOverrides);
  const slipBps = dynamicSlippageBps(rawPrice, atr14, costOverrides);
  const totalBps = slipBps + cfg.halfSpreadBps;
  const pct = totalBps / 10000;
  const sign =
    side === "long"
      ? direction === "entry"
        ? +1
        : -1
      : direction === "entry"
        ? -1
        : +1;
  const frictionAdjustedPrice = rawPrice * (1 + sign * pct);
  const mode = roundingMode(side, direction);
  const finalPrice = roundToTick(frictionAdjustedPrice, cfg.tickSize, mode);
  return { finalPrice, frictionAdjustedPrice, slippageBps: slipBps };
}

function rawExitFillLong(params: {
  kind: ExitKind;
  level?: number;
  barOpen: number;
  barHigh: number;
  barLow: number;
  barClose: number;
}): number {
  const { kind, level, barOpen, barHigh, barLow, barClose } = params;
  if (kind === "MARKET" || kind === "EOD") {
    return barOpen;
  }
  if (kind === "STOP") {
    if (level == null) return barClose;
    if (barOpen <= level) return barOpen;
    if (barLow <= level) return level;
    return barClose;
  }
  if (level == null) return barClose;
  if (barOpen >= level) return level;
  if (barHigh >= level) return level;
  return barClose;
}

function calculateCommission(
  shares: number,
  overrides?: CostOverrides,
): number {
  const cfg = effectiveConfig(overrides);
  const absShares = Math.abs(shares);
  return Math.max(cfg.minCommission, absShares * cfg.commissionPerShare);
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
    pendingExit: {
      reason: string;
      exitType: string;
      decisionBarIndex: number;
    } | null;
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

export function getWeekdaysGoingBack(fromDate: Date, count: number): string[] {
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
  storage: IStorage,
  exactDays?: number,
): Promise<{ started: boolean; message: string }> {
  if (autoRunState?.active) {
    return { started: false, message: "Auto-run is already active." };
  }

  const maxDates = exactDays ?? Math.max(3, Math.ceil(durationMinutes * 2));
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

  log(
    `[AutoRun] Starting ${durationMinutes}-minute auto-run across ${dates.length} dates`,
    "historical",
  );

  runAutoRunLoop(userId, storage).catch((err) => {
    log(`[AutoRun] Error: ${err.message}`, "historical");
  });

  return {
    started: true,
    message: `Auto-run started for ${durationMinutes} minutes across ${dates.length} trading days.`,
  };
}

async function runAutoRunLoop(userId: string, storage: IStorage) {
  if (!autoRunState) return;

  const deadline =
    autoRunState.startedAt + autoRunState.durationMinutes * 60 * 1000;

  while (
    autoRunState.datesRemaining.length > 0 &&
    Date.now() < deadline &&
    !autoRunState.cancel
  ) {
    const date = autoRunState.datesRemaining.shift()!;
    autoRunState.currentDate = date;

    log(
      `[AutoRun] Simulating ${date} (${autoRunState.datesCompleted.length + 1}/${autoRunState.datesCompleted.length + autoRunState.datesRemaining.length + 1})`,
      "historical",
    );

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
      log(
        `[AutoRun] Time limit reached after ${autoRunState.datesCompleted.length} dates`,
        "historical",
      );
      break;
    }
  }

  autoRunState.active = false;
  autoRunState.currentDate = null;
  log(
    `[AutoRun] Finished: ${autoRunState.datesCompleted.length} dates, ${autoRunState.totalTrades} trades, ${autoRunState.totalLessons} lessons, P&L: $${autoRunState.totalPnl.toFixed(2)}`,
    "historical",
  );
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
  tickerList?: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    preloadedBars?: SimulationBarData;
  },
): Promise<DryRunResult | void> {
  const tickers = tickerList ?? BACKTEST_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;

  const control = { cancel: false };
  if (!isDryRun) {
    activeSimulations.set(runId, control);
  }

  try {
    if (!isDryRun) {
      await storage.updateSimulationRun(runId, { status: "running", tickers });
    }

    let bars5mMap: Map<string, Candle[]>;
    let bars15mMap: Map<string, Candle[]>;
    let prevDayBars: Map<string, any>;
    let multiDayBars: Map<string, any[]>;

    if (options?.preloadedBars) {
      bars5mMap = options.preloadedBars.bars5mMap;
      bars15mMap = options.preloadedBars.bars15mMap;
      prevDayBars = options.preloadedBars.prevDayBars;
      multiDayBars = options.preloadedBars.multiDayBars;
    } else {
      if (!isAlpacaConfigured()) {
        if (!isDryRun) {
          await storage.updateSimulationRun(runId, {
            status: "failed",
            errorMessage:
              "Alpaca API keys not configured. Historical data requires Alpaca integration.",
            completedAt: new Date(),
          });
        }
        return;
      }

      log(`[HistSim] Fetching 5m bars for ${simulationDate}...`, "historical");
      bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");

      log(`[HistSim] Fetching 15m bars for ${simulationDate}...`, "historical");
      bars15mMap = await fetchBarsForDate(allSymbols, simulationDate, "15Min");

      log(`[HistSim] Fetching previous day bars...`, "historical");
      prevDayBars = await fetchDailyBarsForDate(allSymbols, simulationDate);

      log(
        `[HistSim] Fetching 20-day daily bars for RVOL/ATR baseline...`,
        "historical",
      );
      multiDayBars = await fetchMultiDayDailyBars(
        allSymbols,
        simulationDate,
        20,
      );
    }

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data available for ${simulationDate}. Markets may have been closed.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    let totalBars = 0;
    for (const t of tickers) {
      totalBars += (bars5mMap.get(t) ?? []).length;
    }

    if (!isDryRun) {
      await storage.updateSimulationRun(runId, { totalBars });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: "User not found",
          completedAt: new Date(),
        });
      }
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
    const tradesByRegime: Record<
      string,
      { wins: number; losses: number; pnl: number }
    > = {};
    const tradesBySession: Record<
      string,
      { wins: number; losses: number; pnl: number }
    > = {};
    const tradesByTier: Record<
      string,
      { wins: number; losses: number; pnl: number }
    > = {};
    const skippedSetups: Array<{
      ticker: string;
      score: number;
      penalty: number;
      reason: string;
      barIndex: number;
      price: number;
    }> = [];
    const tradeTraces: TraceStep[] = [];
    const invariantViolations: InvariantViolation[] = [];

    for (const ticker of tickers) {
      if (control.cancel) {
        if (!isDryRun) {
          await storage.updateSimulationRun(runId, {
            status: "cancelled",
            processedBars,
            tradesGenerated,
            lessonsGenerated,
            totalPnl: Number(totalPnl.toFixed(2)),
            completedAt: new Date(),
          });
        }
        return;
      }

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const prevDay = prevDayBars.get(ticker);
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 10) {
        processedBars += tickerBars5m.length;
        log(
          `[HistSim] ${ticker} skipped - only ${tickerBars5m.length} bars (need 10+)`,
          "historical",
        );
        continue;
      }

      const avgDailyVolume =
        dailyHistory.length > 1
          ? dailyHistory.slice(0, -1).reduce((s, b) => s + b.volume, 0) /
            (dailyHistory.length - 1)
          : 0;

      let dailyATRbaseline = 0;
      if (dailyHistory.length >= 5) {
        const ranges = dailyHistory.slice(-5).map((b) => b.high - b.low);
        dailyATRbaseline = ranges.reduce((s, r) => s + r, 0) / ranges.length;
        dailyATRbaseline = (dailyATRbaseline / 78) * 1.2;
      } else if (prevDay) {
        dailyATRbaseline = ((prevDay.high - prevDay.low) / 78) * 1.2;
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
        yesterdayRange: prevDay
          ? prevDay.high - prevDay.low
          : tickerBars5m[0].open * 0.02,
        dailyATRbaseline,
        spreadPct: 0.02,
        minutesSinceOpen: 0,
        selectedTier: null,
        retestBarsSinceBreakout: 0,
        lastBreakoutBarIndex: -100,
        activeTrade: null,
      };

      let lastRegimeResult = checkMarketRegime(
        [],
        DEFAULT_STRATEGY_CONFIG.marketRegime,
      );

      let diag = {
        resistFound: 0,
        breakoutsAboveResist: 0,
        tierSelected: 0,
        boQualified: 0,
        retestValid: 0,
        entryAttempted: 0,
      };

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
          state.rvol =
            expectedVolume > 0 ? state.dayVolume / expectedVolume : 1.0;
        }

        if (state.barCount % 3 === 0 && state.bars5m.length >= 3) {
          const last3 = state.bars5m.slice(-3);
          const bar15m: Candle = {
            open: last3[0].open,
            high: Math.max(...last3.map((c) => c.high)),
            low: Math.min(...last3.map((c) => c.low)),
            close: last3[2].close,
            volume: last3.reduce((s, c) => s + c.volume, 0),
            timestamp: bar.timestamp,
          };
          state.bars15m.push(bar15m);
          if (state.bars15m.length > 100) state.bars15m.shift();
        }

        state.atr14 = calculateATR(state.bars5m, 14);
        state.vwap = calculateVWAP(state.bars5m);

        const spyBarsToNow = spyBars5m.filter(
          (b) => b.timestamp <= bar.timestamp,
        );
        const regimeResult = checkMarketRegime(
          spyBarsToNow.slice(-40),
          DEFAULT_STRATEGY_CONFIG.marketRegime,
        );
        lastRegimeResult = regimeResult;

        const volGateResult = checkVolatilityGate(
          state.bars5m,
          state.yesterdayRange,
          state.dailyATRbaseline,
          DEFAULT_STRATEGY_CONFIG.volatilityGate,
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
          DEFAULT_STRATEGY_CONFIG.higherTimeframe,
        );

        const accountSize = user.accountSize ?? 100000;

        if (state.activeTrade) {
          const trade = state.activeTrade;
          const riskPerShare = trade.riskPerShare;
          const minutesSinceEntry = (i - trade.entryBarIndex) * 5;

          if (trade.pendingExit) {
            const rawFill = bar.open;
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side: "long",
              direction: "exit",
              atr14: state.atr14,
              costOverrides,
            });
            const exitPrice = exitTrace.finalPrice;
            const exitReason = trade.pendingExit.reason;
            const shares = trade.shares;

            const grossPnl = (exitPrice - trade.entryPrice) * shares;
            const commission = calculateCommission(shares, costOverrides) * 2;
            const pnl = grossPnl - commission;
            const slipBps = exitTrace.slippageBps;
            log(
              `[HistSim] ${ticker} PENDING EXIT filled at open $${exitPrice.toFixed(2)} (raw $${rawFill.toFixed(2)}, slip ${slipBps.toFixed(1)}bps)`,
              "historical",
            );

            if (SIM_DEBUG) {
              simAssert(
                i > trade.pendingExit.decisionBarIndex,
                "Pending exit fill barIndex must be > decision barIndex",
                invariantViolations,
                "PENDING_FILL_BAR_ORDER",
                i,
                ticker,
                { fillBar: i, decisionBar: trade.pendingExit.decisionBarIndex },
              );
             
              simAssert(
                exitTrace.frictionAdjustedPrice <= rawFill,
                "Long exit friction-adjusted price must be <= raw price",
                invariantViolations,
                "EXIT_ADVERSE_DIRECTION",
                i,
                ticker,
                {
                  frictionAdjusted: exitTrace.frictionAdjustedPrice,
                  raw: rawFill,
                },
              );
            }

            const rMultiplePend =
              riskPerShare > 0
                ? (exitPrice - trade.entryPrice) / riskPerShare
                : 0;
            if (tradeTraces.length < 200) {
              tradeTraces.push({
                step: "PENDING_EXIT_FILL",
                barIndex: i,
                barTime: bar.timestamp,
                ticker,
                decisionPrice: rawFill,
                rawFillPrice: rawFill,
                frictionAdjustedPrice: exitTrace.frictionAdjustedPrice,
                finalFillPrice: exitPrice,
                slippageBps: slipBps,
                commissionTotal: commission,
                rMultiple: rMultiplePend,
                pnl,
                side: "long",
                direction: "exit",
                exitKind: "PENDING",
                exitReason,
              });
            }
            const rMultiple =
              riskPerShare > 0
                ? (exitPrice - trade.entryPrice) / riskPerShare
                : 0;
            const pnlPct =
              trade.entryPrice > 0
                ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++;
            else lossCount++;
            grossPnlTotal += grossPnl;
            totalCommissions += commission;
            const slippageCost =
              ((trade.entryPrice *
                shares *
                (dynamicSlippageBps(
                  trade.entryPrice,
                  state.atr14,
                  costOverrides,
                ) +
                  effectiveConfig(costOverrides).halfSpreadBps)) /
                10000) *
              2;
            totalSlippageCosts += slippageCost;
            tradeRs.push(totalR);
            tradeGrossPnls.push(grossPnl);
            tradeNetPnls.push(pnl);
            const trSession =
              state.minutesSinceOpen <= 90
                ? "open"
                : state.minutesSinceOpen <= 240
                  ? "mid"
                  : "power";
            const trRegime = regimeResult.aligned
              ? "trending"
              : regimeResult.chopping
                ? "choppy"
                : "neutral";
            const trTier = trade.tier;
            if (!tradesByRegime[trRegime])
              tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesBySession[trSession])
              tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesByTier[trTier])
              tradesByTier[trTier] = { wins: 0, losses: 0, pnl: 0 };
            tradesByRegime[trRegime].pnl += pnl;
            tradesBySession[trSession].pnl += pnl;
            tradesByTier[trTier].pnl += pnl;
            if (pnl > 0) {
              tradesByRegime[trRegime].wins++;
              tradesBySession[trSession].wins++;
              tradesByTier[trTier].wins++;
            } else {
              tradesByRegime[trRegime].losses++;
              tradesBySession[trSession].losses++;
              tradesByTier[trTier].losses++;
            }

            addTrade(buildAnalyticsRecord(
              trade, ticker, exitPrice, exitReason,
              bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp,
              totalR, pnl,
            ));

            if (!isDryRun) {
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
                partialExitPrice: trade.partialExitPrice
                  ? Number(trade.partialExitPrice.toFixed(2))
                  : null,
                partialExitShares: trade.partialExitShares,
                stopMovedToBE: trade.stopMovedToBE,
                runnerShares: trade.runnerShares,
                trailingStopPrice: trade.trailingStopPrice
                  ? Number(trade.trailingStopPrice.toFixed(2))
                  : null,
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

              const signal = trade.signalId
                ? ((await storage.getSignalById(trade.signalId)) ?? null)
                : null;
              const lessonResult = analyzeClosedTrade({
                trade: {
                  ...tradeRecord,
                  enteredAt: new Date(
                    bar.timestamp - minutesSinceEntry * 60000,
                  ),
                  exitedAt: new Date(bar.timestamp),
                },
                signal,
                spyAligned: regimeResult.aligned,
                isLunchChop:
                  state.minutesSinceOpen >= 120 &&
                  state.minutesSinceOpen <= 240,
                session:
                  state.minutesSinceOpen <= 90
                    ? "open"
                    : state.minutesSinceOpen <= 240
                      ? "mid"
                      : "power",
              });
              await storage.createLesson({
                ...lessonResult,
                exitReason: `[SIM] ${exitReason}`,
                lessonDetail: `[Historical Sim ${simulationDate}] ${lessonResult.lessonDetail}`,
                marketContext: {
                  ...(lessonResult.marketContext as Record<string, any>),
                  simulationDate,
                },
                durationMinutes: minutesSinceEntry,
              });
              lessonsGenerated++;
            } else {
              tradesGenerated++;
            }

            state.activeTrade = null;
            state.signalState = "IDLE";
            processedBars++;
            continue;
          }

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
            state.atr14,
          );

          if (exitResult.shouldExit) {
            const shares = trade.shares;
            const exitType = exitResult.exitType;

            const isIntrabar =
              exitType === "stop_loss" ||
              exitType === "target" ||
              exitType === "partial" ||
              exitType === "trailing_stop";

            if (!isIntrabar) {
              trade.pendingExit = {
                reason: exitResult.reason || "exit",
                exitType: exitType || "hard_exit",
                decisionBarIndex: i,
              };
              log(
                `[HistSim] ${ticker} PENDING EXIT set: ${exitResult.reason} (will fill at next bar open)`,
                "historical",
              );
              if (tradeTraces.length < 200) {
                tradeTraces.push({
                  step: "PENDING_EXIT_SET",
                  barIndex: i,
                  barTime: bar.timestamp,
                  ticker,
                  decisionPrice: bar.close,
                  rawFillPrice: bar.close,
                  frictionAdjustedPrice: bar.close,
                  finalFillPrice: bar.close,
                  slippageBps: 0,
                  commissionTotal: 0,
                  rMultiple: null,
                  pnl: null,
                  side: "long",
                  direction: "exit",
                  exitKind: "PENDING",
                  exitReason: exitResult.reason || "exit",
                  notes: `Pending exit set, will fill at next bar open`,
                });
              }
              processedBars++;
              continue;
            }

            const targetLevel = trade.isPartiallyExited
              ? trade.entryPrice +
                riskPerShare * (tieredConfig.exits.finalTargetR ?? 2.5)
              : trade.entryPrice +
                riskPerShare * (tieredConfig.exits.partialAtR ?? 1.5);
            let effectiveExitType = exitType;
            let effectiveExitKind: ExitKind =
              exitType === "stop_loss" || exitType === "trailing_stop"
                ? "STOP"
                : "TARGET";

            const isAmbiguousBar =
              bar.low <= trade.stopPrice && bar.high >= targetLevel;
            if (isAmbiguousBar && effectiveExitKind === "TARGET") {
              effectiveExitKind = "STOP";
              effectiveExitType = "stop_loss";
              log(
                `[HistSim] ${ticker} AMBIGUOUS BAR: low $${bar.low.toFixed(2)} <= stop $${trade.stopPrice.toFixed(2)} AND high $${bar.high.toFixed(2)} >= target $${targetLevel.toFixed(2)} → assuming stop hit first`,
                "historical",
              );
            }

            if (SIM_DEBUG && isAmbiguousBar) {
              simAssert(
                effectiveExitKind === "STOP",
                "Ambiguous bar must always choose STOP",
                invariantViolations,
                "AMBIGUOUS_BAR_STOP",
                i,
                ticker,
                {
                  effectiveExitKind,
                  barLow: bar.low,
                  stopPrice: trade.stopPrice,
                  barHigh: bar.high,
                  targetLevel,
                },
              );
            }

            const exitLevel =
              effectiveExitKind === "STOP" ? trade.stopPrice : targetLevel;
            const rawFill = rawExitFillLong({
              kind: effectiveExitKind,
              level: exitLevel,
              barOpen: bar.open,
              barHigh: bar.high,
              barLow: bar.low,
              barClose: bar.close,
            });

            const gapThroughStop =
              effectiveExitKind === "STOP" &&
              exitLevel != null &&
              bar.open <= exitLevel;
            const gapThroughTarget =
              effectiveExitKind === "TARGET" &&
              exitLevel != null &&
              bar.open >= exitLevel;
            const gapThrough = gapThroughStop || gapThroughTarget;

            if (SIM_DEBUG && gapThroughStop) {
              simAssert(
                rawFill === bar.open,
                "Gap-through stop must fill at bar open",
                invariantViolations,
                "GAP_THROUGH_STOP_FILL",
                i,
                ticker,
                { rawFill, barOpen: bar.open, stopLevel: exitLevel },
              );
            }

            if (exitType === "partial" && effectiveExitKind !== "STOP") {
              const partialTrace = applyFrictionAndRoundWithTrace({
                rawPrice: rawFill,
                side: "long",
                direction: "exit",
                atr14: state.atr14,
                costOverrides,
              });
              const partialExitPrice = partialTrace.finalPrice;
              const partialShares =
                exitResult.partialShares ??
                Math.floor(shares * (tieredConfig.exits.partialPct / 100));
              trade.isPartiallyExited = true;
              trade.partialExitPrice = partialExitPrice;
              trade.partialExitShares = partialShares;
              trade.runnerShares = shares - partialShares;
              trade.stopMovedToBE = true;
              if (exitResult.newStopPrice) {
                trade.stopPrice = exitResult.newStopPrice;
              } else {
                trade.stopPrice = trade.entryPrice;
              }
              trade.realizedR +=
                ((partialExitPrice - trade.entryPrice) / riskPerShare) *
                (partialShares / shares);

              if (SIM_DEBUG) {
                simAssert(
                  isTickAligned(exitPrice, 0.01),
                    "Pending exit price must align to $0.01 tick grid",
                    invariantViolations,
                    "TICK_ALIGNMENT",
                    i,
                    ticker,
                    { exitPrice }
                  );
                    }
              }
              if (tradeTraces.length < 200) {
                tradeTraces.push({
                  step: "PARTIAL_EXIT",
                  barIndex: i,
                  barTime: bar.timestamp,
                  ticker,
                  decisionPrice: exitLevel,
                  rawFillPrice: rawFill,
                  frictionAdjustedPrice: partialTrace.frictionAdjustedPrice,
                  finalFillPrice: partialExitPrice,
                  slippageBps: partialTrace.slippageBps,
                  commissionTotal: 0,
                  rMultiple: null,
                  pnl: null,
                  side: "long",
                  direction: "exit",
                  exitKind: "TARGET",
                  exitReason: exitResult.reason || "partial",
                  isAmbiguousBar,
                  gapThrough,
                });
              }
              processedBars++;
              continue;
            }

            const intraTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side: "long",
              direction: "exit",
              atr14: state.atr14,
              costOverrides,
            });
            const exitPrice = intraTrace.finalPrice;
            const exitReason =
              effectiveExitType === "stop_loss" && exitType !== "stop_loss"
                ? `${exitResult.reason || "exit"} [ambiguous bar → stop]`
                : exitResult.reason || "exit";

            const grossPnl = (exitPrice - trade.entryPrice) * shares;
            const commission = calculateCommission(shares, costOverrides) * 2;
            const pnl = grossPnl - commission;
            const slipBps = intraTrace.slippageBps;
            log(
              `[HistSim] ${ticker} EXIT ${effectiveExitKind} at $${exitPrice.toFixed(2)} (raw $${rawFill.toFixed(2)}, slip ${slipBps.toFixed(1)}bps, commission $${commission.toFixed(2)})`,
              "historical",
            );

            if (SIM_DEBUG) {
            
              simAssert(
                intraTrace.frictionAdjustedPrice <= rawFill,
                "Long exit friction-adjusted price must be <= raw price",
                invariantViolations,
                "EXIT_ADVERSE_DIRECTION",
                i,
                ticker,
                {
                  frictionAdjusted: intraTrace.frictionAdjustedPrice,
                  raw: rawFill,
                },
              );
            }
            const rMultiple =
              riskPerShare > 0
                ? (exitPrice - trade.entryPrice) / riskPerShare
                : 0;

            if (tradeTraces.length < 200) {
              tradeTraces.push({
                step: "INTRABAR_EXIT",
                barIndex: i,
                barTime: bar.timestamp,
                ticker,
                decisionPrice: exitLevel,
                rawFillPrice: rawFill,
                frictionAdjustedPrice: intraTrace.frictionAdjustedPrice,
                finalFillPrice: exitPrice,
                slippageBps: slipBps,
                commissionTotal: commission,
                rMultiple,
                pnl,
                side: "long",
                direction: "exit",
                exitKind: effectiveExitKind,
                exitReason,
                isAmbiguousBar,
                gapThrough,
              });
            }
            const pnlPct =
              trade.entryPrice > 0
                ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++;
            else lossCount++;
            grossPnlTotal += grossPnl;
            totalCommissions += commission;
            const slippageCost =
              ((trade.entryPrice *
                shares *
                (dynamicSlippageBps(
                  trade.entryPrice,
                  state.atr14,
                  costOverrides,
                ) +
                  effectiveConfig(costOverrides).halfSpreadBps)) /
                10000) *
              2;
            totalSlippageCosts += slippageCost;
            tradeRs.push(totalR);
            tradeGrossPnls.push(grossPnl);
            tradeNetPnls.push(pnl);
            const trSession =
              state.minutesSinceOpen <= 90
                ? "open"
                : state.minutesSinceOpen <= 240
                  ? "mid"
                  : "power";
            const trRegime = regimeResult.aligned
              ? "trending"
              : regimeResult.chopping
                ? "choppy"
                : "neutral";
            const trTier = trade.tier;
            if (!tradesByRegime[trRegime])
              tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesBySession[trSession])
              tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesByTier[trTier])
              tradesByTier[trTier] = { wins: 0, losses: 0, pnl: 0 };
            tradesByRegime[trRegime].pnl += pnl;
            tradesBySession[trSession].pnl += pnl;
            tradesByTier[trTier].pnl += pnl;
            if (pnl > 0) {
              tradesByRegime[trRegime].wins++;
              tradesBySession[trSession].wins++;
              tradesByTier[trTier].wins++;
            } else {
              tradesByRegime[trRegime].losses++;
              tradesBySession[trSession].losses++;
              tradesByTier[trTier].losses++;
            }

            addTrade(buildAnalyticsRecord(
              trade, ticker, exitPrice, exitReason,
              bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp,
              totalR, pnl,
            ));

            if (!isDryRun) {
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
                partialExitPrice: trade.partialExitPrice
                  ? Number(trade.partialExitPrice.toFixed(2))
                  : null,
                partialExitShares: trade.partialExitShares,
                stopMovedToBE: trade.stopMovedToBE,
                runnerShares: trade.runnerShares,
                trailingStopPrice: trade.trailingStopPrice
                  ? Number(trade.trailingStopPrice.toFixed(2))
                  : null,
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

              const signal = trade.signalId
                ? ((await storage.getSignalById(trade.signalId)) ?? null)
                : null;
              const lessonResult = analyzeClosedTrade({
                trade: {
                  ...tradeRecord,
                  enteredAt: new Date(
                    bar.timestamp - minutesSinceEntry * 60000,
                  ),
                  exitedAt: new Date(bar.timestamp),
                },
                signal,
                spyAligned: regimeResult.aligned,
                isLunchChop:
                  state.minutesSinceOpen >= 120 &&
                  state.minutesSinceOpen <= 240,
                session:
                  state.minutesSinceOpen <= 90
                    ? "open"
                    : state.minutesSinceOpen <= 240
                      ? "mid"
                      : "power",
              });
              await storage.createLesson({
                ...lessonResult,
                exitReason: `[SIM] ${exitReason}`,
                lessonDetail: `[Historical Sim ${simulationDate}] ${lessonResult.lessonDetail}`,
                marketContext: {
                  ...(lessonResult.marketContext as Record<string, any>),
                  simulationDate,
                },
                durationMinutes: minutesSinceEntry,
              });
              lessonsGenerated++;
            } else {
              tradesGenerated++;
            }

            state.activeTrade = null;
            state.signalState = "IDLE";
          } else if (
            exitResult.newStopPrice &&
            exitResult.newStopPrice > trade.stopPrice
          ) {
            trade.trailingStopPrice = exitResult.newStopPrice;
            trade.stopPrice = exitResult.newStopPrice;
          }

          processedBars++;
          continue;
        }

        if (
          state.signalState === "IDLE" &&
          i - state.lastBreakoutBarIndex > 10
        ) {
          const resistance = findResistance(state.bars5m, 30);
          if (resistance) {
            diag.resistFound++;
            const resistDistPct =
              state.price > 0
                ? Math.abs(resistance.level - state.price) / state.price
                : 1;
            if (resistDistPct <= 0.03) {
              state.resistanceLevel = resistance.level;
            }
          }

          if (state.resistanceLevel && bar.close > state.resistanceLevel) {
            diag.breakoutsAboveResist++;
            const avgVol =
              state.bars5m.length > 20
                ? state.bars5m
                    .slice(-21, -1)
                    .reduce((s, b) => s + b.volume, 0) / 20
                : state.bars5m.slice(0, -1).reduce((s, b) => s + b.volume, 0) /
                  Math.max(state.bars5m.length - 1, 1);
            const volRatio = bar.volume / Math.max(avgVol, 1);

            const rawAtr = calculateATR(state.bars5m, 14);
            const atrRatio =
              state.dailyATRbaseline > 0
                ? rawAtr / state.dailyATRbaseline
                : 1.0;

            const tier = selectTier(volRatio, atrRatio, tieredConfig);

            if (tier) {
              diag.tierSelected++;
              const breakoutResult = checkTieredBreakout(
                bar,
                state.bars5m.slice(0, -1),
                state.resistanceLevel,
                "RESISTANCE",
                tieredConfig.tiers[tier],
                tieredConfig.strategy,
              );

              if (breakoutResult.qualified) {
                diag.boQualified++;
                state.signalState = "BREAKOUT";
                state.breakoutCandle = bar;
                state.selectedTier = tier;
                state.retestBarsSinceBreakout = 0;
                state.lastBreakoutBarIndex = i;

                if (!isDryRun) {
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
                    marketRegime: regimeResult.chopping
                      ? "choppy"
                      : regimeResult.aligned
                        ? "aligned"
                        : "misaligned",
                    spyAligned: regimeResult.aligned,
                    volatilityGatePassed: volGateResult.passes,
                    scoreBreakdown: {
                      volRatio,
                      atrRatio,
                      tier,
                      simDate: simulationDate,
                    },
                    relStrengthVsSpy: 0,
                    isPowerSetup: false,
                    tier,
                    direction: "LONG",
                    notes: `[SIM ${simulationDate}] Tier ${tier} breakout above $${state.resistanceLevel.toFixed(2)}`,
                  });
                }

                log(
                  `[HistSim] ${ticker} BREAKOUT at $${state.price.toFixed(2)} (Tier ${tier}) on ${simulationDate}`,
                  "historical",
                );
              }
            }
          }
        }

        if (
          state.signalState === "BREAKOUT" &&
          state.resistanceLevel &&
          state.breakoutCandle &&
          state.selectedTier
        ) {
          state.retestBarsSinceBreakout++;
          const tierConfig = tieredConfig.tiers[state.selectedTier];

          if (state.retestBarsSinceBreakout > tierConfig.retestTimeoutCandles) {
            state.signalState = "IDLE";
            state.selectedTier = null;
            state.breakoutCandle = null;
            state.retestBars = [];
          } else {
            const retestResult = checkTieredRetest(
              bar,
              state.breakoutCandle,
              state.retestBars,
              state.resistanceLevel,
              "RESISTANCE",
              state.bars5m,
              tierConfig,
              "LONG",
            );

            if (
              retestResult.valid &&
              retestResult.entryPrice &&
              retestResult.stopPrice
            ) {
              diag.retestValid++;
              const entryTraceResult = applyFrictionAndRoundWithTrace({
                rawPrice: retestResult.entryPrice,
                side: "long",
                direction: "entry",
                atr14: state.atr14,
                costOverrides,
              });
              const entryPrice = entryTraceResult.finalPrice;
              const stopPrice = retestResult.stopPrice;
              const riskPerShare = Math.abs(entryPrice - stopPrice);

              if (SIM_DEBUG) {
               function isTickAligned(price: number, tick = 0.01, eps = 1e-6){
                 const q = price / tick;
                 return Math.abs(q - Math.round(q)) < eps;
               }
                simAssert(
                  isTickAligned(entryPrice, 0.01),
                  "Entry price must align to $0.01 tick grid",
                  invariantViolations,
                  "TICK_ALIGNMENT",
                  {
                    frictionAdjusted: entryTraceResult.frictionAdjustedPrice,
                    raw: retestResult.entryPrice,
                  },
                );
              }

              if (riskPerShare > 0) {
                const dollarRisk =
                  accountSize * tieredConfig.tiers[state.selectedTier].riskPct;
                const shares = Math.max(
                  1,
                  Math.floor(dollarRisk / riskPerShare),
                );
                const target1 =
                  entryPrice +
                  riskPerShare * (tieredConfig.exits.partialAtR ?? 1.5);
                const target2 =
                  entryPrice +
                  riskPerShare * (tieredConfig.exits.finalTargetR ?? 2.5);
                const rvolScore =
                  state.rvol >= 2.0
                    ? 20
                    : state.rvol >= 1.5
                      ? 18
                      : state.rvol >= 1.0
                        ? 14
                        : state.rvol >= 0.7
                          ? 10
                          : 5;
                const trendScore = biasResult.aligned ? 15 : 8;
                const boVolScore = 20;
                const retestScore = 15;
                const regimeScore = regimeResult.aligned
                  ? 15
                  : regimeResult.chopping
                    ? 0
                    : 8;
                const atrScore =
                  state.atr14 > state.dailyATRbaseline * 1.3 ? 10 : 5;
                let score = Math.min(
                  100,
                  rvolScore +
                    trendScore +
                    boVolScore +
                    retestScore +
                    regimeScore +
                    atrScore,
                );

                const session =
                  state.minutesSinceOpen <= 90
                    ? "open"
                    : state.minutesSinceOpen <= 240
                      ? "mid"
                      : "power";
                let appliedPenalty = 0;
                try {
                  const recentLessons = (
                    await storage.getRecentLessons(100)
                  ).filter((l) => {
                    const ctx = l.marketContext as Record<string, any> | null;
                    if (ctx?.simulationDate) {
                      return ctx.simulationDate < simulationDate;
                    }
                    return true;
                  });
                  const penaltyResult = computeLearningPenalty(
                    recentLessons.map((l) => ({
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
                    session,
                  );

                  if (penaltyResult.penalty > 0) {
                    const cappedPenalty = Math.min(penaltyResult.penalty, 20);
                    appliedPenalty = cappedPenalty;
                    score = Math.max(0, score - cappedPenalty);
                    log(
                      `[HistSim] ${ticker} LEARNING PENALTY: -${cappedPenalty} pts (raw: -${penaltyResult.penalty}), score ${score + cappedPenalty} -> ${score}. ${penaltyResult.reasons.join("; ")}`,
                      "historical",
                    );
                  }
                } catch (lpErr) {
                  log(
                    `[HistSim] Learning penalty error: ${lpErr}`,
                    "historical",
                  );
                }

                const minScore = DEFAULT_STRATEGY_CONFIG.scoring.halfSizeMin;
                if (score < minScore) {
                  log(
                    `[HistSim] ${ticker} SKIPPED entry - score ${score} below threshold ${minScore} after learning penalty`,
                    "historical",
                  );
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
                log(
                  `[ENTRY GATE] ${ticker} score=${score} tier=${state.selectedTier} penalty=${appliedPenalty} regime=${regimeResult.aligned ? "trending" : "neutral"}`,
                  "scanner",
                );

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
                  pendingExit: null,
                };

                log(
                  `[HistSim] ${ticker} ENTRY at $${entryPrice.toFixed(2)} stop=$${stopPrice.toFixed(2)} (Tier ${state.selectedTier}) on ${simulationDate}`,
                  "historical",
                );

                if (tradeTraces.length < 200) {
                  const entryCommission = calculateCommission(
                    shares,
                    costOverrides,
                  );
                  tradeTraces.push({
                    step: "ENTRY",
                    barIndex: i,
                    barTime: bar.timestamp,
                    ticker,
                    decisionPrice: retestResult.entryPrice,
                    rawFillPrice: retestResult.entryPrice,
                    frictionAdjustedPrice:
                      entryTraceResult.frictionAdjustedPrice,
                    finalFillPrice: entryPrice,
                    slippageBps: entryTraceResult.slippageBps,
                    commissionTotal: entryCommission,
                    rMultiple: null,
                    pnl: null,
                    side: "long",
                    direction: "entry",
                  });
                }
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

        if (!isDryRun && processedBars % 20 === 0) {
          await storage.updateSimulationRun(runId, {
            processedBars,
            tradesGenerated,
            lessonsGenerated,
            totalPnl: Number(totalPnl.toFixed(2)),
          });
        }
      }

      log(
        `[HistSim] ${ticker} pipeline: bars=${tickerBars5m.length}, resistFound=${diag.resistFound}, closedAbove=${diag.breakoutsAboveResist}, tierOk=${diag.tierSelected}, boQualified=${diag.boQualified}, retestValid=${diag.retestValid}, rvol=${state.rvol.toFixed(2)}, atrBase=${state.dailyATRbaseline.toFixed(4)}`,
        "historical",
      );

      if (state.activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = state.activeTrade;
        const eodExitReason = trade.pendingExit
          ? `${trade.pendingExit.reason} [EOD close - no next bar]`
          : "End of day close";
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side: "long",
          direction: "exit",
          atr14: state.atr14,
          costOverrides,
        });
        const exitPrice = eodTrace.finalPrice;
        const grossPnl = (exitPrice - trade.entryPrice) * trade.shares;
        const commission = calculateCommission(trade.shares, costOverrides) * 2;
        const pnl = grossPnl - commission;
        const slipBps2 = eodTrace.slippageBps;
        log(
          `[HistSim] ${ticker} EOD EXIT at $${exitPrice.toFixed(2)} (raw $${lastBar.close.toFixed(2)}, slip ${slipBps2.toFixed(1)}bps, commission $${commission.toFixed(2)})`,
          "historical",
        );

        if (SIM_DEBUG) {
          
          
      

        const rMultiple =
          trade.riskPerShare > 0
            ? (exitPrice - trade.entryPrice) / trade.riskPerShare
            : 0;

        if (tradeTraces.length < 200) {
          tradeTraces.push({
            step: "EOD_EXIT",
            barIndex: tickerBars5m.length - 1,
            barTime: lastBar.timestamp,
            ticker,
            decisionPrice: lastBar.close,
            rawFillPrice: lastBar.close,
            frictionAdjustedPrice: eodTrace.frictionAdjustedPrice,
            finalFillPrice: exitPrice,
            slippageBps: slipBps2,
            commissionTotal: commission,
            rMultiple,
            pnl,
            side: "long",
            direction: "exit",
            exitKind: "EOD",
            exitReason: eodExitReason,
          });
        }
        const totalR = trade.realizedR + rMultiple;
        totalPnl += pnl;
        if (pnl > 0) winCount++;
        else lossCount++;
        grossPnlTotal += grossPnl;
        totalCommissions += commission;
        const slippageCost2 =
          ((trade.entryPrice *
            trade.shares *
            (dynamicSlippageBps(trade.entryPrice, state.atr14, costOverrides) +
              effectiveConfig(costOverrides).halfSpreadBps)) /
            10000) *
          2;
        totalSlippageCosts += slippageCost2;
        tradeRs.push(totalR);
        tradeGrossPnls.push(grossPnl);
        tradeNetPnls.push(pnl);
        const trRegime2 = lastRegimeResult.aligned
          ? "trending"
          : lastRegimeResult.chopping
            ? "choppy"
            : "neutral";
        const trTier2 = trade.tier;
        if (!tradesByRegime[trRegime2])
          tradesByRegime[trRegime2] = { wins: 0, losses: 0, pnl: 0 };
        if (!tradesBySession["power"])
          tradesBySession["power"] = { wins: 0, losses: 0, pnl: 0 };
        if (!tradesByTier[trTier2])
          tradesByTier[trTier2] = { wins: 0, losses: 0, pnl: 0 };
        tradesByRegime[trRegime2].pnl += pnl;
        tradesBySession["power"].pnl += pnl;
        tradesByTier[trTier2].pnl += pnl;
        if (pnl > 0) {
          tradesByRegime[trRegime2].wins++;
          tradesBySession["power"].wins++;
          tradesByTier[trTier2].wins++;
        } else {
          tradesByRegime[trRegime2].losses++;
          tradesBySession["power"].losses++;
          tradesByTier[trTier2].losses++;
        }

        addTrade(buildAnalyticsRecord(
          trade, ticker, exitPrice, eodExitReason,
          lastBar.timestamp,
          tickerBars5m[trade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          totalR, pnl,
        ));

        if (!isDryRun) {
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
            pnlPercent: Number(
              (
                ((exitPrice - trade.entryPrice) / trade.entryPrice) *
                100
              ).toFixed(2),
            ),
            rMultiple: Number(totalR.toFixed(2)),
            status: "closed",
            exitReason: `[SIM] ${eodExitReason}`,
            isPartiallyExited: trade.isPartiallyExited,
            partialExitPrice: trade.partialExitPrice
              ? Number(trade.partialExitPrice.toFixed(2))
              : null,
            partialExitShares: trade.partialExitShares,
            stopMovedToBE: trade.stopMovedToBE,
            runnerShares: trade.runnerShares,
            trailingStopPrice: trade.trailingStopPrice
              ? Number(trade.trailingStopPrice.toFixed(2))
              : null,
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
              enteredAt: new Date(
                lastBar.timestamp -
                  (tickerBars5m.length - trade.entryBarIndex) * 5 * 60000,
              ),
              exitedAt: new Date(lastBar.timestamp),
            },
            signal: null,
            spyAligned: lastRegimeResult.aligned,
            isLunchChop: false,
            session: "power",
          });

          await storage.createLesson({
            ...lessonResult,
            exitReason: `[SIM] ${eodExitReason}`,
            lessonDetail: `[Historical Sim ${simulationDate}] ${lessonResult.lessonDetail}`,
            marketContext: {
              ...(lessonResult.marketContext as Record<string, any>),
              simulationDate,
            },
            durationMinutes: (tickerBars5m.length - trade.entryBarIndex) * 5,
          });
          lessonsGenerated++;
        } else {
          tradesGenerated++;
        }

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
      const k5 = 2 / 6,
        k20 = 2 / 21;
      for (let bi = 1; bi < bars.length; bi++) {
        const prevEma5 = ema5,
          prevEma20 = ema20;
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
    const avgR =
      tradeRs.length > 0
        ? tradeRs.reduce((a, b) => a + b, 0) / tradeRs.length
        : 0;
    const grossWins = tradeNetPnls
      .filter((p) => p > 0)
      .reduce((a, b) => a + b, 0);
    const grossLosses = Math.abs(
      tradeNetPnls.filter((p) => p <= 0).reduce((a, b) => a + b, 0),
    );
    const profitFactor =
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

    let peak = 0,
      maxDD = 0,
      equity = 0;
    for (const pnl of tradeNetPnls) {
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    if (isDryRun) {
      return {
        trades: totalTrades,
        wins: winCount,
        losses: lossCount,
        grossPnl: grossPnlTotal,
        netPnl: totalPnl,
        totalCommissions,
        totalSlippageCosts,
        tradeRs,
        maxDrawdown: maxDD,
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      } as DryRunResult;
    }

    const avgPnl =
      tradeNetPnls.length > 0
        ? tradeNetPnls.reduce((a, b) => a + b, 0) / tradeNetPnls.length
        : 0;
    const stdPnl =
      tradeNetPnls.length > 1
        ? Math.sqrt(
            tradeNetPnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) /
              (tradeNetPnls.length - 1),
          )
        : 0;
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
        avgCommissionPerTrade:
          totalTrades > 0
            ? Number((totalCommissions / totalTrades).toFixed(2))
            : 0,
        totalR: Number(tradeRs.reduce((a, b) => a + b, 0).toFixed(2)),
        tradeTraces: tradeTraces.slice(0, 200),
        invariantViolations: invariantViolations.slice(0, 100),
      },
      breakdown: {
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      },
      skippedSetups: skippedSetups.slice(0, 50),
      completedAt: new Date(),
    });

    log(
      `[HistSim] Completed simulation for ${simulationDate}: ${tradesGenerated} trades, ${lessonsGenerated} lessons, P&L: $${totalPnl.toFixed(2)}`,
      "historical",
    );

    if (tradesGenerated > 0) {
      const { getTodayTrades } = await import("./analytics/tradeStore");
      const { buildDailySummary, formatDailySummary } = await import("./analytics/tradeAnalytics");
      const todayTrades = getTodayTrades();
      if (todayTrades.length > 0) {
        const summary = buildDailySummary(todayTrades);
        log(`\n${formatDailySummary(summary)}`, "historical");
      }
    }
  } catch (error: any) {
    log(`[HistSim] Error: ${error.message}`, "historical");
    if (!isDryRun) {
      await storage.updateSimulationRun(runId, {
        status: "failed",
        errorMessage: error.message,
        completedAt: new Date(),
      });
    }
  } finally {
    if (!isDryRun) {
      activeSimulations.delete(runId);
    }
  }
}

export interface WalkForwardWindow {
  windowIndex: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainDates: string[];
  testDates: string[];
  testMetrics: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdown: number;
    netPnl: number;
    grossPnl: number;
    totalCosts: number;
    byRegime: Record<string, BreakdownBucket>;
    bySession: Record<string, BreakdownBucket>;
    byTier: Record<string, BreakdownBucket>;
  };
  trainSummary: {
    totalTrades: number;
    totalPnl: number;
  };
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregate: {
    totalTestTrades: number;
    totalTestWins: number;
    totalTestLosses: number;
    overallWinRate: number;
    overallExpectancyR: number;
    overallProfitFactor: number;
    maxDrawdown: number;
    totalNetPnl: number;
    equityCurve: Array<{ windowIndex: number; cumulativePnl: number }>;
    regimeBreakdown: Record<string, BreakdownBucket & { winRate: number }>;
    sessionBreakdown: Record<string, BreakdownBucket & { winRate: number }>;
    tierBreakdown: Record<string, BreakdownBucket & { winRate: number }>;
  };
  config: {
    trainDays: number;
    testDays: number;
    totalWindows: number;
    startDate: string;
    endDate: string;
  };
}

let activeWalkForward: {
  active: boolean;
  cancel: boolean;
  progress: {
    currentWindow: number;
    totalWindows: number;
    currentDate: string;
    phase: "train" | "test";
  };
} | null = null;

export function getWalkForwardStatus() {
  return activeWalkForward;
}

export function cancelWalkForward(): boolean {
  if (activeWalkForward?.active) {
    activeWalkForward.cancel = true;
    return true;
  }
  return false;
}

export async function runWalkForwardEvaluation(
  userId: string,
  trainDays: number,
  testDays: number,
  totalWindows: number,
  storage: IStorage,
): Promise<WalkForwardResult | { error: string }> {
  if (!isAlpacaConfigured()) {
    return {
      error:
        "Alpaca API keys not configured. Walk-forward evaluation requires market data.",
    };
  }

  if (activeWalkForward?.active) {
    return { error: "Walk-forward evaluation is already running." };
  }

  activeWalkForward = {
    active: true,
    cancel: false,
    progress: {
      currentWindow: 0,
      totalWindows,
      currentDate: "",
      phase: "train",
    },
  };

  try {
    const daysPerWindow = trainDays + testDays;
    const totalDaysNeeded = totalWindows * daysPerWindow;

    const allDates = getWeekdaysGoingBack(new Date(), totalDaysNeeded);
    allDates.reverse();

    if (allDates.length < totalDaysNeeded) {
      return {
        error: `Not enough trading days available. Need ${totalDaysNeeded}, got ${allDates.length}.`,
      };
    }

    const windows: WalkForwardWindow[] = [];
    const allTestRs: number[] = [];
    let cumulativePnl = 0;
    const equityCurve: Array<{ windowIndex: number; cumulativePnl: number }> =
      [];

    for (let w = 0; w < totalWindows; w++) {
      if (activeWalkForward.cancel) {
        return { error: "Walk-forward evaluation cancelled." };
      }

      const windowStart = w * daysPerWindow;
      const trainDatesList = allDates.slice(
        windowStart,
        windowStart + trainDays,
      );
      const testDatesList = allDates.slice(
        windowStart + trainDays,
        windowStart + daysPerWindow,
      );

      activeWalkForward.progress = {
        currentWindow: w + 1,
        totalWindows,
        currentDate: trainDatesList[0] || "",
        phase: "train",
      };

      let trainTrades = 0;
      let trainPnl = 0;
      for (const date of trainDatesList) {
        if (activeWalkForward.cancel) break;
        activeWalkForward.progress.currentDate = date;
        try {
          const result = (await runHistoricalSimulation(
            `wf-${w}-train-${date}`,
            date,
            userId,
            storage,
            undefined,
            { dryRun: true },
          )) as DryRunResult | void;
          if (result) {
            trainTrades += result.trades;
            trainPnl += result.netPnl;
          }
        } catch (err) {
          log(`[WalkForward] Train date ${date} error: ${err}`, "historical");
        }
      }

      activeWalkForward.progress.phase = "test";
      let testWins = 0,
        testLosses = 0;
      let testGrossPnl = 0,
        testNetPnl = 0,
        testTotalCosts = 0;
      const testRs: number[] = [];
      const windowByRegime: Record<string, BreakdownBucket> = {};
      const windowBySession: Record<string, BreakdownBucket> = {};
      const windowByTier: Record<string, BreakdownBucket> = {};

      for (const date of testDatesList) {
        if (activeWalkForward.cancel) break;
        activeWalkForward.progress.currentDate = date;
        try {
          const result = (await runHistoricalSimulation(
            `wf-${w}-test-${date}`,
            date,
            userId,
            storage,
            undefined,
            { dryRun: true },
          )) as DryRunResult | void;
          if (result) {
            testWins += result.wins;
            testLosses += result.losses;
            testGrossPnl += result.grossPnl;
            testNetPnl += result.netPnl;
            testTotalCosts +=
              result.totalCommissions + result.totalSlippageCosts;
            testRs.push(...result.tradeRs);
            for (const [k, v] of Object.entries(result.byRegime)) {
              if (!windowByRegime[k])
                windowByRegime[k] = { wins: 0, losses: 0, pnl: 0 };
              windowByRegime[k].wins += v.wins;
              windowByRegime[k].losses += v.losses;
              windowByRegime[k].pnl += v.pnl;
            }
            for (const [k, v] of Object.entries(result.bySession)) {
              if (!windowBySession[k])
                windowBySession[k] = { wins: 0, losses: 0, pnl: 0 };
              windowBySession[k].wins += v.wins;
              windowBySession[k].losses += v.losses;
              windowBySession[k].pnl += v.pnl;
            }
            for (const [k, v] of Object.entries(result.byTier)) {
              if (!windowByTier[k])
                windowByTier[k] = { wins: 0, losses: 0, pnl: 0 };
              windowByTier[k].wins += v.wins;
              windowByTier[k].losses += v.losses;
              windowByTier[k].pnl += v.pnl;
            }
          }
        } catch (err) {
          log(`[WalkForward] Test date ${date} error: ${err}`, "historical");
        }
      }

      const testTrades = testWins + testLosses;
      const avgR =
        testRs.length > 0
          ? testRs.reduce((a, b) => a + b, 0) / testRs.length
          : 0;
      const winPnls = testRs.filter((r) => r > 0);
      const lossPnls = testRs.filter((r) => r <= 0);
      const pf =
        lossPnls.length > 0
          ? Math.abs(winPnls.reduce((a, b) => a + b, 0)) /
            Math.abs(lossPnls.reduce((a, b) => a + b, 0))
          : winPnls.length > 0
            ? 999
            : 0;

      let wPeak = 0,
        wMaxDD = 0,
        wEquity = 0;
      for (const r of testRs) {
        wEquity += r;
        if (wEquity > wPeak) wPeak = wEquity;
        const dd = wPeak - wEquity;
        if (dd > wMaxDD) wMaxDD = dd;
      }

      cumulativePnl += testNetPnl;
      allTestRs.push(...testRs);
      equityCurve.push({ windowIndex: w, cumulativePnl });

      windows.push({
        windowIndex: w,
        trainStart: trainDatesList[0] || "",
        trainEnd: trainDatesList[trainDatesList.length - 1] || "",
        testStart: testDatesList[0] || "",
        testEnd: testDatesList[testDatesList.length - 1] || "",
        trainDates: trainDatesList,
        testDates: testDatesList,
        testMetrics: {
          trades: testTrades,
          wins: testWins,
          losses: testLosses,
          winRate:
            testTrades > 0
              ? Number(((testWins / testTrades) * 100).toFixed(1))
              : 0,
          expectancyR: Number(avgR.toFixed(3)),
          profitFactor: Number(pf.toFixed(2)),
          maxDrawdown: Number(wMaxDD.toFixed(2)),
          netPnl: Number(testNetPnl.toFixed(2)),
          grossPnl: Number(testGrossPnl.toFixed(2)),
          totalCosts: Number(testTotalCosts.toFixed(2)),
          byRegime: windowByRegime,
          bySession: windowBySession,
          byTier: windowByTier,
        },
        trainSummary: {
          totalTrades: trainTrades,
          totalPnl: Number(trainPnl.toFixed(2)),
        },
      });

      log(
        `[WalkForward] Window ${w + 1}/${totalWindows} complete: test trades=${testTrades}, expectancy=${avgR.toFixed(3)}R, PnL=$${testNetPnl.toFixed(2)}`,
        "historical",
      );
    }

    const totalTestTrades = windows.reduce(
      (s, w) => s + w.testMetrics.trades,
      0,
    );
    const totalTestWins = windows.reduce((s, w) => s + w.testMetrics.wins, 0);
    const totalTestLosses = windows.reduce(
      (s, w) => s + w.testMetrics.losses,
      0,
    );
    const overallAvgR =
      allTestRs.length > 0
        ? allTestRs.reduce((a, b) => a + b, 0) / allTestRs.length
        : 0;
    const allWinRs = allTestRs.filter((r) => r > 0);
    const allLossRs = allTestRs.filter((r) => r <= 0);
    const overallPF =
      allLossRs.length > 0
        ? Math.abs(allWinRs.reduce((a, b) => a + b, 0)) /
          Math.abs(allLossRs.reduce((a, b) => a + b, 0))
        : allWinRs.length > 0
          ? 999
          : 0;

    let agPeak = 0,
      agMaxDD = 0,
      agEquity = 0;
    for (const r of allTestRs) {
      agEquity += r;
      if (agEquity > agPeak) agPeak = agEquity;
      const dd = agPeak - agEquity;
      if (dd > agMaxDD) agMaxDD = dd;
    }

    const aggRegime: Record<string, BreakdownBucket> = {};
    const aggSession: Record<string, BreakdownBucket> = {};
    const aggTier: Record<string, BreakdownBucket> = {};
    for (const win of windows) {
      for (const [k, v] of Object.entries(win.testMetrics.byRegime)) {
        if (!aggRegime[k]) aggRegime[k] = { wins: 0, losses: 0, pnl: 0 };
        aggRegime[k].wins += v.wins;
        aggRegime[k].losses += v.losses;
        aggRegime[k].pnl += v.pnl;
      }
      for (const [k, v] of Object.entries(win.testMetrics.bySession)) {
        if (!aggSession[k]) aggSession[k] = { wins: 0, losses: 0, pnl: 0 };
        aggSession[k].wins += v.wins;
        aggSession[k].losses += v.losses;
        aggSession[k].pnl += v.pnl;
      }
      for (const [k, v] of Object.entries(win.testMetrics.byTier)) {
        if (!aggTier[k]) aggTier[k] = { wins: 0, losses: 0, pnl: 0 };
        aggTier[k].wins += v.wins;
        aggTier[k].losses += v.losses;
        aggTier[k].pnl += v.pnl;
      }
    }
    const addWinRate = (rec: Record<string, BreakdownBucket>) => {
      const out: Record<string, BreakdownBucket & { winRate: number }> = {};
      for (const [k, v] of Object.entries(rec)) {
        const total = v.wins + v.losses;
        out[k] = {
          ...v,
          pnl: Number(v.pnl.toFixed(2)),
          winRate: total > 0 ? Number(((v.wins / total) * 100).toFixed(1)) : 0,
        };
      }
      return out;
    };

    return {
      windows,
      aggregate: {
        totalTestTrades,
        totalTestWins,
        totalTestLosses,
        overallWinRate:
          totalTestTrades > 0
            ? Number(((totalTestWins / totalTestTrades) * 100).toFixed(1))
            : 0,
        overallExpectancyR: Number(overallAvgR.toFixed(3)),
        overallProfitFactor: Number(overallPF.toFixed(2)),
        maxDrawdown: Number(agMaxDD.toFixed(2)),
        totalNetPnl: Number(cumulativePnl.toFixed(2)),
        equityCurve,
        regimeBreakdown: addWinRate(aggRegime),
        sessionBreakdown: addWinRate(aggSession),
        tierBreakdown: addWinRate(aggTier),
      },
      config: {
        trainDays,
        testDays,
        totalWindows,
        startDate: allDates[0] || "",
        endDate: allDates[allDates.length - 1] || "",
      },
    };
  } finally {
    if (activeWalkForward) {
      activeWalkForward.active = false;
    }
  }
}

export async function runCostSensitivity(
  runId: string,
  userId: string,
  storage: IStorage,
): Promise<{ grid: CostSensitivityResult[] } | { error: string }> {
  const run = await storage.getSimulationRun(runId);
  if (!run) return { error: "Simulation run not found" };
  if (run.status !== "completed")
    return {
      error: "Simulation must be completed before running cost sensitivity",
    };

  const simulationDate = run.simulationDate;
  const tickers = (run.tickers as string[]) || BACKTEST_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));

  const bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");
  const bars15mMap = await fetchBarsForDate(
    allSymbols,
    simulationDate,
    "15Min",
  );
  const prevDayBars = await fetchDailyBarsForDate(allSymbols, simulationDate);
  const multiDayBars = await fetchMultiDayDailyBars(
    allSymbols,
    simulationDate,
    20,
  );
  const preloadedBars: SimulationBarData = {
    bars5mMap,
    bars15mMap,
    prevDayBars,
    multiDayBars,
  };

  const slippageOptions = [0, 5, 10];
  const spreadOptions = [1, 3, 5];
  const grid: CostSensitivityResult[] = [];

  for (const slip of slippageOptions) {
    for (const spread of spreadOptions) {
      const costOverrides: CostOverrides = {
        baseSlippageBps: slip,
        halfSpreadBps: spread,
      };
      const isBaseline =
        slip === SIM_CONFIG.baseSlippageBps &&
        spread === SIM_CONFIG.halfSpreadBps;

      const result = (await runHistoricalSimulation(
        `${runId}-cost-${slip}-${spread}`,
        simulationDate,
        userId,
        storage,
        tickers,
        { costOverrides, dryRun: true, preloadedBars },
      )) as DryRunResult;

      if (result) {
        const totalTrades = result.wins + result.losses;
        const winRate = totalTrades > 0 ? result.wins / totalTrades : 0;
        const avgR =
          result.tradeRs.length > 0
            ? result.tradeRs.reduce((a, b) => a + b, 0) / result.tradeRs.length
            : 0;
        const winPnls = result.tradeRs.filter((r) => r > 0);
        const lossPnls = result.tradeRs.filter((r) => r <= 0);
        const avgWin =
          winPnls.length > 0
            ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length
            : 0;
        const avgLoss =
          lossPnls.length > 0
            ? Math.abs(lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length)
            : 0;
        const profitFactor =
          avgLoss > 0
            ? (avgWin * winPnls.length) / (avgLoss * lossPnls.length)
            : avgWin > 0
              ? Infinity
              : 0;

        grid.push({
          baseSlippageBps: slip,
          halfSpreadBps: spread,
          trades: totalTrades,
          winRate: Number((winRate * 100).toFixed(1)),
          expectancyR: Number(avgR.toFixed(3)),
          profitFactor: Number(profitFactor.toFixed(2)),
          maxDrawdown: Number(result.maxDrawdown.toFixed(2)),
          netPnl: Number(result.netPnl.toFixed(2)),
          grossPnl: Number(result.grossPnl.toFixed(2)),
          totalCosts: Number(
            (result.totalCommissions + result.totalSlippageCosts).toFixed(2),
          ),
          isBaseline,
        });
      }
    }
  }

  return { grid };
}
