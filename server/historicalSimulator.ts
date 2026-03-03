import { batchComputeClusterActivation } from "./strategy/volatilityClusterFilter";
import { type IStorage } from "./storage";
import { type SignalState } from "./strategy/types";
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
import { logTradeEntry, logTradeExit, resetTradeLog, flushOpenEntries } from "./analytics/tradeLogger";
import {
  type SmallCapConfig,
  type SmallCapQualification,
  DEFAULT_SMALLCAP_CONFIG,
  qualifySmallCapGapper,
  computeATRFromDailyBars,
  computeAvgDailyVolume,
} from "./strategy/smallCapScanner";
import {
  type PullbackConfig,
  type PullbackSignal,
  type HODState,
  DEFAULT_PULLBACK_CONFIG,
  initHODState,
  updateHODState,
  checkPullbackRebreak,
} from "./strategy/pullbackDetector";

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
    score?: number;
    scoreTier?: string;
  },
  ticker: string,
  exitPrice: number,
  exitReason: string,
  exitBarTimestamp: number,
  entryBarTimestamp: number,
  totalR: number,
  pnl: number,
  context?: {
    marketRegime?: string;
    session?: string;
    spyAligned?: boolean;
    volatilityGatePassed?: boolean;
    entryMode?: string | null;
    isPowerSetup?: boolean;
  },
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
    score: trade.score ?? 0,
    marketRegime: (context?.marketRegime as any) ?? "unknown",
    session: (context?.session as any) ?? "unknown",
    spyAligned: context?.spyAligned ?? false,
    volatilityGatePassed: context?.volatilityGatePassed ?? false,
    entryMode: context?.entryMode ?? null,
    isPowerSetup: context?.isPowerSetup ?? false,
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
  tradeMFEs?: number[];
  tradeMAEs?: number[];
  tradeHit1R?: number[];
  tradeHitTarget?: number[];
  tradeSlippageCostsR?: number[];
  tradeScratchAfterPartial?: number[];
  tradeLossBuckets?: string[];
  tradeTickers?: string[];
  tradeGapPcts?: number[];
  tradeRegimes?: string[];
  maxDrawdown: number;
  byRegime: Record<string, BreakdownBucket>;
  bySession: Record<string, BreakdownBucket>;
  byTier: Record<string, BreakdownBucket>;
  qualifications?: SmallCapQualification[];
  spreadRejects?: number;
  dynamicScannerStats?: {
    scannedCount: number;
    dataReturnedCount: number;
    qualifiedCount: number;
    longCount: number;
    scanTimeMs: number;
  };
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
  signalState: SignalState | null | undefined;
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
    partialExitBarIndex: number | null;
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
    mfePrice: number;
    mfeR: number;
    mfeBarIndex: number;
    maePrice: number;
    maeR: number;
    maeBarIndex: number;
    mfe30minR: number;
    mfe30minPrice: number;
    breakevenLocked: boolean;
    validated: boolean;
    softStopTightened: boolean;
  } | null;
}

interface SizingResult {
  shares: number;
  dollarRisk: number;
  isCapLimited: boolean;
}

function calculatePositionSize(
  accountSize: number,
  riskPct: number,
  maxPositionPct: number,
  entryPrice: number,
  riskPerShare: number,
): SizingResult {
  const dollarRisk = accountSize * riskPct;
  const sharesByRisk = Math.floor(dollarRisk / riskPerShare);
  const maxPositionValue = accountSize * (maxPositionPct / 100);
  const sharesByCap = Math.floor(maxPositionValue / entryPrice);

  const finalShares = Math.max(0, Math.min(sharesByRisk, sharesByCap));
  const isCapLimited = finalShares > 0 && sharesByCap < sharesByRisk;
  const actualDollarRisk = finalShares * riskPerShare;

  return {
    shares: finalShares,
    dollarRisk: actualDollarRisk,
    isCapLimited,
  };
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

  let totalProcessedTrades = 0;
  const targetTrades = 120;

  // Load already-completed dates for this version to skip on restart
  const user0 = await storage.getUser(userId);
  const currentVersion = user0?.currentStrategyVersion ?? "v1";
  const alreadyDone = await storage.getCompletedDatesByVersion(userId, currentVersion);
  if (alreadyDone.size > 0) {
    log(`[AutoRun] Skipping ${alreadyDone.size} already-completed dates for ${currentVersion}`, "historical");
    autoRunState.datesRemaining = autoRunState.datesRemaining.filter(d => !alreadyDone.has(d));
  }

  while (
    (autoRunState.datesRemaining.length > 0 || totalProcessedTrades < targetTrades) &&
    Date.now() < deadline &&
    !autoRunState.cancel
  ) {
    if (autoRunState.datesRemaining.length === 0) {
      // If we ran out of dates but haven't hit trade target, look back further
      const lastDate = new Date(autoRunState.datesCompleted[autoRunState.datesCompleted.length - 1]);
      const extraDates = getWeekdaysGoingBack(lastDate, 20).filter(d => !alreadyDone.has(d));
      if (extraDates.length === 0) break;
      autoRunState.datesRemaining.push(...extraDates);
    }

    const date = autoRunState.datesRemaining.shift()!;
    if (!date) break;
    autoRunState.currentDate = date;

    log(
      `[AutoRun] Simulating ${date} (${autoRunState.datesCompleted.length + 1} dates, ${totalProcessedTrades} trades)`,
      "historical",
    );

    const user = await storage.getUser(userId);
    const run = await storage.createSimulationRun({
      userId,
      simulationDate: date,
      status: "pending",
      tickers: null,
      strategyVersion: user?.currentStrategyVersion ?? "v1",
    });

    await runHistoricalSimulation(run.id, date, userId, storage);
    
    // Yield to event loop after each simulation to keep Express responsive
    await new Promise(resolve => setImmediate(resolve));

    const completedRun = await storage.getSimulationRun(run.id);
    if (completedRun) {
      const generated = completedRun.tradesGenerated ?? 0;
      autoRunState.totalTrades += generated;
      totalProcessedTrades += generated;
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
    resetTradeLog();

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
    const _v6 = (user?.currentStrategyVersion ?? "v1") >= "v6";
    const _v6_3 = (user?.currentStrategyVersion ?? "v1") >= "v6.3";
    const _v6_5 = (user?.currentStrategyVersion ?? "v1") >= "v6.5";
    const _v6_8 = (user?.currentStrategyVersion ?? "v1") >= "v6.8";
    const _v7_0 = (user?.currentStrategyVersion ?? "v1") >= "v7.0";
    if (_v6) {
      tieredConfig.exits.partialAtR = _v6_5 ? 0.4 : 0.5;
      tieredConfig.exits.partialPct = 70;
      tieredConfig.exits.earlyFailureExit = true;
      tieredConfig.exits.impulseFilterEnabled = _v6_8 && !_v7_0;
    }
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
    const tradeMFEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
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
    
    // FETCH BARS FOR BREADTH UNIVERSE SAMPLING (for cluster result trades)
    // SmallCap gapper universe normally uses backtest-specific logic, 
    // but the cluster filter needs a pool of candidates to simulate trades on.
    // For internal validation, we will scan the small-cap pool.
    
    const { dailyResults } = await batchComputeClusterActivation(simulationDate, simulationDate, { useFullMarket: false });
    const clusterRes = dailyResults.get(simulationDate);
    // Filter tickers to only those that pass the basic gap criteria in ClusterFilter
    // but if none found, we use the provided list to avoid 0-trade days
    const candidateTickers = clusterRes?.gapQualifiers && clusterRes.gapQualifiers.length > 0 
      ? clusterRes.gapQualifiers 
      : tickers;

    for (const ticker of candidateTickers) {
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

          if (riskPerShare > 0) {
            const barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
            const barMaeR = (bar.low - trade.entryPrice) / riskPerShare;
            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = bar.high;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = bar.low;
              trade.maeBarIndex = i;
            }
            if (minutesSinceEntry <= 30 && barMfeR > trade.mfe30minR) {
              trade.mfe30minR = barMfeR;
              trade.mfe30minPrice = bar.high;
            }

            if (!trade.validated && trade.mfeR >= 0.3) {
              trade.validated = true;
              log(
                `[HistSim] ${ticker} VALIDATED: MFE hit +${trade.mfeR.toFixed(2)}R within ${(i - trade.entryBarIndex)} bars`,
                "historical",
              );
            }

            if (!trade.breakevenLocked && trade.mfeR >= 0.5) {
              const newStop = Math.max(trade.stopPrice, trade.entryPrice);
              log(
                `[HistSim] ${ticker} BE LOCK: MFE hit +${trade.mfeR.toFixed(2)}R, stop moved from $${trade.stopPrice.toFixed(2)} to $${newStop.toFixed(2)} (entry)`,
                "historical",
              );
              trade.stopPrice = newStop;
              trade.breakevenLocked = true;
            }

            // v5+ only: conditional soft stop at 45min for the 0.30–0.50R MFE zone.
            // v4 time-stops these trades instead — do NOT apply soft stop for v4.
            // STRONG structure (currentPnlR ≥ 0.25R): let it run free
            // WEAKENING (currentPnlR 0.00–0.25R): tighten stop to entry+0.10R to cap downside
            // Already-negative (<0R): skip — soft stop would fire instantly
            const _softStopVersion = user?.currentStrategyVersion ?? "v1";
            if (_softStopVersion >= "v5" && !trade.softStopTightened && trade.validated && !trade.breakevenLocked && minutesSinceEntry >= 45) {
              trade.softStopTightened = true;
              const currentPnlR = (bar.close - trade.entryPrice) / riskPerShare;
              if (currentPnlR >= 0.25) {
                // Strong — skip soft stop, let trend develop
                log(
                  `[HistSim] ${ticker} SOFT STOP skipped: 45min, current ${currentPnlR.toFixed(2)}R≥0.25R — structure strong, letting trade run`,
                  "historical",
                );
              } else if (currentPnlR >= 0.0) {
                // Weakening — trade gave back gains from MFE, apply soft stop floor
                const softStop = trade.entryPrice + riskPerShare * 0.10;
                if (softStop > trade.stopPrice) {
                  log(
                    `[HistSim] ${ticker} SOFT STOP: 45min, MFE ${trade.mfeR.toFixed(2)}R but faded to ${currentPnlR.toFixed(2)}R, stop tightened $${trade.stopPrice.toFixed(2)} → $${softStop.toFixed(2)} (entry+0.10R)`,
                    "historical",
                  );
                  trade.stopPrice = softStop;
                }
              } else {
                // Already underwater — stop at entry+0.10R would fire instantly, skip it
                log(
                  `[HistSim] ${ticker} SOFT STOP skipped: 45min, current ${currentPnlR.toFixed(2)}R<0 — already negative, natural exits take over`,
                  "historical",
                );
              }
            }

          }

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
              {
                marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                session: state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power",
                spyAligned: regimeResult.aligned,
                volatilityGatePassed: volGateResult.passes,
                entryMode: "conservative",
                isPowerSetup: false,
              },
            ));

            logTradeExit({
              id: `${ticker}-${simulationDate}-${trade.entryBarIndex}`,
              symbol: ticker,
              exitTimestamp: bar.timestamp,
              exitPrice,
              exitReason,
              rMultiple: totalR,
              pnlDollars: pnl,
              mfeR: trade.mfeR,
              maeR: trade.maeR,
              isPartiallyExited: trade.isPartiallyExited,
              partialExitPrice: trade.partialExitPrice ?? undefined,
              partialShares: trade.partialExitShares ?? undefined,
            });

            if (!isDryRun) {
              const tradeRecord = await storage.createTrade({
                userId,
                simulationRunId: runId,
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
                scoreBreakdown: {
                  mfeR: Number(trade.mfeR.toFixed(3)),
                  maeR: Number(trade.maeR.toFixed(3)),
                  mfe30minR: Number(trade.mfe30minR.toFixed(3)),
                  timeToMfeBars: trade.mfeBarIndex - trade.entryBarIndex,
                  timeToMaeBars: trade.maeBarIndex - trade.entryBarIndex,
                },
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
                strategyVersion: user?.currentStrategyVersion ?? "v1",
                mfeR: Number(trade.mfeR.toFixed(3)),
                maeR: Number(trade.maeR.toFixed(3)),
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

          // v4+: time-stop exempt only if MFE ever reached 0.50R (breakevenLocked).
          // Trades in the 0.30–0.50R zone get time-stopped at 45m (v4) or soft-stop tightened (v5+).
          const strategyVersion = user?.currentStrategyVersion ?? "v1";
          const timeStopExempt =
            strategyVersion >= "v4"
              ? trade.breakevenLocked   // v4+: 0.50R threshold
              : trade.validated;        // v1-v3: 0.30R threshold
          const effectiveRisk = timeStopExempt
            ? { ...tieredConfig.risk, timeStopMinutes: 0 }
            : tieredConfig.risk;
          const minutesSincePartial = trade.isPartiallyExited && trade.partialExitBarIndex != null
            ? (i - trade.partialExitBarIndex) * 5
            : 0;
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
            effectiveRisk,
            state.atr14,
            state.resistanceLevel ?? undefined,
            trade.mfeR,
            minutesSincePartial,
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
              trade.partialExitBarIndex = i;
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
                const isPartialTickAligned = (price: number, tick = 0.01, eps = 1e-6) => {
                  const q = price / tick;
                  return Math.abs(q - Math.round(q)) < eps;
                };
                simAssert(
                  isPartialTickAligned(partialExitPrice, 0.01),
                  "Partial exit price must align to $0.01 tick grid",
                  invariantViolations,
                  "TICK_ALIGNMENT",
                  i,
                  ticker,
                  { exitPrice: partialExitPrice },
                );
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
              {
                marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                session: state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power",
                spyAligned: regimeResult.aligned,
                volatilityGatePassed: volGateResult.passes,
                entryMode: "conservative",
                isPowerSetup: false,
              },
            ));

            logTradeExit({
              id: `${ticker}-${simulationDate}-${trade.entryBarIndex}`,
              symbol: ticker,
              exitTimestamp: bar.timestamp,
              exitPrice,
              exitReason,
              rMultiple: totalR,
              pnlDollars: pnl,
              mfeR: trade.mfeR,
              maeR: trade.maeR,
              isPartiallyExited: trade.isPartiallyExited,
              partialExitPrice: trade.partialExitPrice ?? undefined,
              partialShares: trade.partialExitShares ?? undefined,
            });

            if (!isDryRun) {
              const tradeRecord = await storage.createTrade({
                userId,
                simulationRunId: runId,
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
                scoreBreakdown: {
                  mfeR: Number(trade.mfeR.toFixed(3)),
                  maeR: Number(trade.maeR.toFixed(3)),
                  mfe30minR: Number(trade.mfe30minR.toFixed(3)),
                  timeToMfeBars: trade.mfeBarIndex - trade.entryBarIndex,
                  timeToMaeBars: trade.maeBarIndex - trade.entryBarIndex,
                },
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
                strategyVersion: user?.currentStrategyVersion ?? "v1",
                mfeR: Number(trade.mfeR.toFixed(3)),
                maeR: Number(trade.maeR.toFixed(3)),
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
          const resistance15mLookback = Math.min(state.bars15m.length, 20);
          const resistance = resistance15mLookback >= 4
            ? findResistance(state.bars15m, resistance15mLookback)
            : null;
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

              let candidateBoQualified = breakoutResult.qualified;
              if (candidateBoQualified && _v6) {
                const barRange = bar.high - bar.low;
                const closePos = barRange > 0 ? (bar.close - bar.low) / barRange : 0;
                const bodyPct = barRange > 0 ? Math.abs(bar.close - bar.open) / barRange : 0;
                const closeNearHighs = closePos >= 0.82;
                const bodyStrong = bodyPct >= 0.55;
                const prevBar5m = state.bars5m.length >= 2 ? state.bars5m[state.bars5m.length - 2] : null;
                const volExpanding = prevBar5m ? bar.volume >= 1.25 * prevBar5m.volume : true;
                if (!closeNearHighs || !bodyStrong || !volExpanding) {
                  log(
                    `[HistSim] ${ticker} breakout rejected (v6 quality gate): closePos=${closePos.toFixed(2)} bodyPct=${bodyPct.toFixed(2)} volExpanding=${volExpanding}`,
                    "historical",
                  );
                  candidateBoQualified = false;
                }

                if (candidateBoQualified && _v6_3) {
                  const last5 = state.bars5m.slice(-6, -1);
                  if (last5.length >= 3) {
                    const avgRange5 = last5.reduce((s, b) => s + (b.high - b.low), 0) / last5.length;
                    const avgVol5 = last5.reduce((s, b) => s + b.volume, 0) / last5.length;
                    const rangeAccel = avgRange5 > 0 && barRange >= 1.2 * avgRange5;
                    const volAccel = avgVol5 > 0 && bar.volume >= 1.5 * avgVol5;
                    if (!rangeAccel || !volAccel) {
                      log(
                        `[HistSim] ${ticker} breakout rejected (v6.3 accel gate): range=${barRange.toFixed(2)} vs avg=${avgRange5.toFixed(2)} (${rangeAccel ? "OK" : "FAIL"}) vol=${bar.volume} vs avg=${avgVol5.toFixed(0)} (${volAccel ? "OK" : "FAIL"})`,
                        "historical",
                      );
                      candidateBoQualified = false;
                    }
                  }
                }
              }

              if (candidateBoQualified) {
                diag.boQualified++;
                state.signalState = "BREAKOUT";
                state.breakoutCandle = bar;
                state.selectedTier = tier;
                if (_v7_0 && state.selectedTier !== "A") {
                  console.log(`[ENTRY_REJECT] ticker=${ticker} tier=${state.selectedTier} reason="TIER_A_ONLY"`);
                  state.selectedTier = null;
                  state.signalState = "IDLE";
                }
                state.retestBarsSinceBreakout = 0;
                state.lastBreakoutBarIndex = i;

                if (!isDryRun && state.selectedTier !== null) {
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

                if (state.selectedTier !== null) {
                  log(
                    `[HistSim] ${ticker} BREAKOUT at $${state.price.toFixed(2)} (Tier ${tier}) on ${simulationDate}`,
                    "historical",
                  );
                }
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

              if (!regimeResult.expanding) {
                log(
                  `[HistSim] ${ticker} BLOCKED by index expansion gate: ${regimeResult.reasons.join("; ")} | metrics: ${regimeResult.metrics.expandingDetails}`,
                  "historical",
                );
                incrementAutoRunSkipped();
                skippedSetups.push({
                  ticker,
                  score: 0,
                  penalty: 0,
                  reason: `Index expansion gate: ${regimeResult.reasons.filter(r => !r.includes("expanding:")).join(", ")}`,
                  barIndex: i,
                  price: bar.close,
                });
                state.signalState = "IDLE";
                state.selectedTier = null;
                state.breakoutCandle = null;
                state.retestBars = [];
                processedBars++;
                continue;
              }

              if (_v6 && !regimeResult.aligned) {
                log(
                  `[HistSim] ${ticker} BLOCKED by SPY alignment gate (v6): regime misaligned`,
                  "historical",
                );
                incrementAutoRunSkipped();
                skippedSetups.push({
                  ticker,
                  score: 0,
                  penalty: 0,
                  reason: "SPY not aligned (v6 gate)",
                  barIndex: i,
                  price: bar.close,
                });
                state.signalState = "IDLE";
                state.selectedTier = null;
                state.breakoutCandle = null;
                state.retestBars = [];
                processedBars++;
                continue;
              }

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
                simAssert(
                  isTickAligned(entryPrice, 0.01),
                  "Entry price must align to $0.01 tick grid",
                  invariantViolations,
                  "TICK_ALIGNMENT",
                  i,
                  ticker,
                  {
                    frictionAdjusted: entryTraceResult.frictionAdjustedPrice,
                    raw: retestResult.entryPrice,
                  },
                );
              }

              if (riskPerShare > 0) {
                const sizing = calculatePositionSize(
                  accountSize,
                  tieredConfig.tiers[state.selectedTier].riskPct,
                  tieredConfig.risk.maxPositionPct,
                  entryPrice,
                  riskPerShare
                );
                const shares = sizing.shares;
                const dollarRisk = sizing.dollarRisk;

                if (shares <= 0) {
                  log(`[HistSim] ${ticker} ENTRY CANCELLED: sizing resulted in 0 shares (cap limited or invalid risk)`, "historical");
                  state.signalState = "IDLE";
                  state.selectedTier = null;
                  state.breakoutCandle = null;
                  state.retestBars = [];
                  processedBars++;
                  continue;
                }

                if (sizing.isCapLimited) {
                  log(`[HistSim] ${ticker} ENTRY CAP-LIMITED: reduced to ${shares}sh to respect ${tieredConfig.risk.maxPositionPct}% max position size`, "historical");
                }

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
                    await storage.getRecentLessonsByVersion(100, user.currentStrategyVersion ?? "v1")
                  ).filter((l) => {
                    const ctx = l.marketContext as Record<string, any> | null;
                    if (ctx?.simulationDate) {
                      return ctx.simulationDate < simulationDate;
                    }
                    return true;
                  });

                  // Ramp penalty weight: 0 at 0 lessons → 1.0 at 25+ lessons
                  // Hard-isolates each version's learning from prior versions
                  const penaltyWeight = Math.min(1, recentLessons.length / 25);
                  log(
                    `[HistSim] ${ticker} lessonCount=${recentLessons.length} penaltyWeight=${penaltyWeight.toFixed(2)}`,
                    "historical",
                  );

                  if (penaltyWeight > 0) {
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
                      const cappedPenalty = Math.round(Math.min(penaltyResult.penalty, 20) * penaltyWeight);
                      if (cappedPenalty > 0) {
                        appliedPenalty = cappedPenalty;
                        score = Math.max(0, score - cappedPenalty);
                        log(
                          `[HistSim] ${ticker} LEARNING PENALTY: -${cappedPenalty} pts (raw: -${penaltyResult.penalty}, weight: ${penaltyWeight.toFixed(2)}), score ${score + cappedPenalty} -> ${score}. ${penaltyResult.reasons.join("; ")}`,
                          "historical",
                        );
                      }
                    }
                  }
                } catch (lpErr) {
                  log(
                    `[HistSim] Learning penalty error: ${lpErr}`,
                    "historical",
                  );
                }

                const minScore = _v6 ? 85 : 70;
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
                  partialExitBarIndex: null,
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
                  mfePrice: entryPrice,
                  mfeR: 0,
                  mfeBarIndex: i,
                  maePrice: entryPrice,
                  maeR: 0,
                  maeBarIndex: i,
                  mfe30minR: 0,
                  mfe30minPrice: entryPrice,
                  breakevenLocked: false,
                  validated: false,
                  softStopTightened: false,
                };

                log(
                  `[HistSim] ${ticker} ENTRY at $${entryPrice.toFixed(2)} stop=$${stopPrice.toFixed(2)} (Tier ${state.selectedTier}) on ${simulationDate}`,
                  "historical",
                );

                logTradeEntry({
                  id: `${ticker}-${simulationDate}-${i}`,
                  strategy: "breakout_retest",
                  symbol: ticker,
                  direction: "LONG",
                  entryTimestamp: bar.timestamp,
                  entryPrice,
                  stopLoss: stopPrice,
                  target1,
                  target2,
                  shares,
                  dollarRisk,
                  riskPerShare,
                  isCapLimited: sizing.isCapLimited,
                  entryReason: `Tier ${state.selectedTier} breakout retest | score=${score}`,
                  tier: state.selectedTier,
                  score,
                  marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                  session: state.minutesSinceOpen <= 90 ? "open" : state.minutesSinceOpen <= 240 ? "mid" : "power",
                });

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
          {
            marketRegime: lastRegimeResult?.chopping ? "choppy" : lastRegimeResult?.aligned ? "aligned" : "misaligned",
            session: "power",
            spyAligned: lastRegimeResult?.aligned ?? false,
            volatilityGatePassed: true,
            entryMode: "conservative",
            isPowerSetup: false,
          },
        ));

        logTradeExit({
          id: `${ticker}-${simulationDate}-${trade.entryBarIndex}`,
          symbol: ticker,
          exitTimestamp: lastBar.timestamp,
          exitPrice,
          exitReason: eodExitReason,
          rMultiple: totalR,
          pnlDollars: pnl,
          mfeR: trade.mfeR,
          maeR: trade.maeR,
          isPartiallyExited: trade.isPartiallyExited,
          partialExitPrice: trade.partialExitPrice ?? undefined,
          partialShares: trade.partialExitShares ?? undefined,
        });

        if (!isDryRun) {
          const tradeRecord = await storage.createTrade({
            userId,
            simulationRunId: runId,
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
            scoreBreakdown: {
              mfeR: Number(trade.mfeR.toFixed(3)),
              maeR: Number(trade.maeR.toFixed(3)),
              mfe30minR: Number(trade.mfe30minR.toFixed(3)),
              timeToMfeBars: trade.mfeBarIndex - trade.entryBarIndex,
              timeToMaeBars: trade.maeBarIndex - trade.entryBarIndex,
            },
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
            strategyVersion: user?.currentStrategyVersion ?? "v1",
            mfeR: Number(trade.mfeR.toFixed(3)),
            maeR: Number(trade.maeR.toFixed(3)),
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

    flushOpenEntries();

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


import {
  checkOverextension,
  checkExhaustion,
  calculateReversionEntry,
  DEFAULT_REVERSION_CONFIG,
  type VwapReversionConfig,
} from "./strategy/vwapReversion";

import {
  calculateOpeningRange,
  detectBreak,
  detectFailure,
  calculateORFEntry,
  checkORQualityGate,
  DEFAULT_ORF_CONFIG,
  type ORFConfig,
  type OpeningRange,
  type BreakDetection,
} from "./strategy/orfDetector";

import {
  computeRS,
  detectRSContinuation,
  DEFAULT_RS_CONFIG,
  type RSConfig,
} from "./strategy/rsDetector";

import {
  detectGap,
  checkRVOL,
  buildOpeningRange as buildGapOpeningRange,
  detectORBreakout,
  DEFAULT_GAP_CONFIG,
  type GapConfig,
  type OpeningRange as GapOpeningRange,
} from "./strategy/gapDetector";

// RS detector already uses calculateVWAP from indicators internally

type ReversionDirection = "LONG_FADE" | "SHORT_FADE";

interface ReversionTradeState {
  direction: ReversionDirection;
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  target1: number;
  target2: number;
  vwapAtEntry: number;
  shares: number;
  entryBarIndex: number;
  dollarRisk: number;
  riskPerShare: number;
  deviationATR: number;
  isPartiallyExited: boolean;
  partialExitPrice: number | null;
  partialExitShares: number | null;
  runnerShares: number | null;
  realizedR: number;
  pendingExit: { reason: string; exitType: string; decisionBarIndex: number } | null;
  mfeR: number;
  mfePrice: number;
  mfeBarIndex: number;
  maeR: number;
  maePrice: number;
  maeBarIndex: number;
  breakevenLocked: boolean;
}

export async function runReversionSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList?: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    preloadedBars?: SimulationBarData;
    reversionConfig?: Partial<VwapReversionConfig>;
  },
): Promise<DryRunResult | void> {
  const tickers = tickerList ?? BACKTEST_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;
  const revConfig: VwapReversionConfig = { ...DEFAULT_REVERSION_CONFIG, ...(options?.reversionConfig ?? {}) };

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
            errorMessage: "Alpaca API keys not configured.",
            completedAt: new Date(),
          });
        }
        return;
      }
      bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");
      bars15mMap = await fetchBarsForDate(allSymbols, simulationDate, "15Min");
      prevDayBars = await fetchDailyBarsForDate(allSymbols, simulationDate);
      multiDayBars = await fetchMultiDayDailyBars(allSymbols, simulationDate, 20);
    }

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data for ${simulationDate}.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    let totalBars = 0;
    for (const t of tickers) totalBars += (bars5mMap.get(t) ?? []).length;
    if (!isDryRun) await storage.updateSimulationRun(runId, { totalBars });

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

    const accountSize = user.accountSize ?? 100000;
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
    const tradeMFEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};

    for (const ticker of tickers) {
      if (control.cancel) break;

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const prevDay = prevDayBars.get(ticker);
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 14) {
        processedBars += tickerBars5m.length;
        continue;
      }

      let dailyATRbaseline = 0;
      if (dailyHistory.length >= 5) {
        const ranges = dailyHistory.slice(-5).map((b: any) => b.high - b.low);
        dailyATRbaseline = ranges.reduce((s: number, r: number) => s + r, 0) / ranges.length;
        dailyATRbaseline = (dailyATRbaseline / 78) * 1.2;
      } else if (prevDay) {
        dailyATRbaseline = ((prevDay.high - prevDay.low) / 78) * 1.2;
      } else {
        dailyATRbaseline = tickerBars5m[0].open * 0.002;
      }

      const bars5mAccum: Candle[] = [];
      let activeTrade: ReversionTradeState | null = null;
      let cooldownUntilBar = 0;
      let tickerTradeCount = 0;
      let lastRegimeResult = checkMarketRegime([], DEFAULT_STRATEGY_CONFIG.marketRegime);

      let diag = { overextensions: 0, exhaustions: 0, entries: 0 };

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        bars5mAccum.push(bar);
        if (bars5mAccum.length > 200) bars5mAccum.shift();

        const minutesSinceOpen = (i + 1) * 5;
        const atr14 = calculateATR(bars5mAccum, 14);
        const vwap = calculateVWAP(bars5mAccum);

        const spyBarsToNow = spyBars5m.filter((b: Candle) => b.timestamp <= bar.timestamp);
        const regimeResult = checkMarketRegime(spyBarsToNow.slice(-40), DEFAULT_STRATEGY_CONFIG.marketRegime);
        lastRegimeResult = regimeResult;

        if (i < revConfig.minBarsFromOpen || i > revConfig.maxBarsFromOpen) {
          processedBars++;
          if (activeTrade && i >= tickerBars5m.length - 1) {
            // will handle EOD below
          } else {
            continue;
          }
        }

        if (activeTrade) {
          const trade = activeTrade;
          const riskPerShare = trade.riskPerShare;

          if (riskPerShare > 0) {
            let barMfeR: number, barMaeR: number;
            if (trade.direction === "SHORT_FADE") {
              barMfeR = (trade.entryPrice - bar.low) / riskPerShare;
              barMaeR = (trade.entryPrice - bar.high) / riskPerShare;
            } else {
              barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
              barMaeR = (bar.low - trade.entryPrice) / riskPerShare;
            }

            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = trade.direction === "SHORT_FADE" ? bar.low : bar.high;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = trade.direction === "SHORT_FADE" ? bar.high : bar.low;
              trade.maeBarIndex = i;
            }

            if (!trade.breakevenLocked && trade.mfeR >= 0.5) {
              if (trade.direction === "SHORT_FADE") {
                trade.stopPrice = Math.min(trade.stopPrice, trade.entryPrice);
              } else {
                trade.stopPrice = Math.max(trade.stopPrice, trade.entryPrice);
              }
              trade.breakevenLocked = true;
            }
          }

          if (trade.pendingExit) {
            const side: Side = trade.direction === "SHORT_FADE" ? "short" : "long";
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: bar.open,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            const exitPrice = exitTrace.finalPrice;
            const shares = trade.shares;
            const grossPnl = trade.direction === "SHORT_FADE"
              ? (trade.entryPrice - exitPrice) * shares
              : (exitPrice - trade.entryPrice) * shares;
            const commission = calculateCommission(shares, costOverrides) * 2;
            const pnl = grossPnl - commission;
            const rMultiple = riskPerShare > 0
              ? (trade.direction === "SHORT_FADE"
                ? (trade.entryPrice - exitPrice) / riskPerShare
                : (exitPrice - trade.entryPrice) / riskPerShare)
              : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++; else lossCount++;
            grossPnlTotal += grossPnl;
            totalCommissions += commission;
            totalSlippageCosts += exitTrace.slippageBps;
            tradeRs.push(totalR);
            tradeGrossPnls.push(grossPnl);
            tradeNetPnls.push(pnl);

            const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
            const trRegime = regimeResult.aligned ? "trending" : regimeResult.chopping ? "choppy" : "neutral";
            const trDir = trade.direction === "SHORT_FADE" ? "short_fade" : "long_fade";
            if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesByTier[trDir]) tradesByTier[trDir] = { wins: 0, losses: 0, pnl: 0 };
            tradesByRegime[trRegime].pnl += pnl;
            tradesBySession[trSession].pnl += pnl;
            tradesByTier[trDir].pnl += pnl;
            if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier[trDir].wins++; }
            else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier[trDir].losses++; }

            addTrade(buildAnalyticsRecord(
              { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares, tier: trDir, direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG", entryBarIndex: trade.entryBarIndex },
              ticker, exitPrice, trade.pendingExit.reason,
              bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp,
              totalR, pnl,
              { marketRegime: trRegime, session: trSession, spyAligned: regimeResult.aligned },
            ));

            if (!isDryRun) {
              await storage.createTrade({
                userId,
                simulationRunId: runId,
                signalId: null,
                ticker,
                side: trade.direction === "SHORT_FADE" ? "short" : "long",
                entryPrice: Number(trade.entryPrice.toFixed(2)),
                exitPrice: Number(exitPrice.toFixed(2)),
                stopPrice: Number(trade.originalStopPrice.toFixed(2)),
                originalStopPrice: Number(trade.originalStopPrice.toFixed(2)),
                target1: Number(trade.target1.toFixed(2)),
                target2: Number(trade.target2.toFixed(2)),
                shares,
                pnl: Number(pnl.toFixed(2)),
                pnlPercent: Number(((trade.direction === "SHORT_FADE" ? (trade.entryPrice - exitPrice) : (exitPrice - trade.entryPrice)) / trade.entryPrice * 100).toFixed(2)),
                rMultiple: Number(totalR.toFixed(2)),
                status: "closed",
                exitReason: `[SIM-REV] ${trade.pendingExit.reason}`,
                isPartiallyExited: trade.isPartiallyExited,
                partialExitPrice: trade.partialExitPrice ? Number(trade.partialExitPrice.toFixed(2)) : null,
                partialExitShares: trade.partialExitShares,
                stopMovedToBE: trade.breakevenLocked,
                runnerShares: trade.runnerShares,
                trailingStopPrice: null,
                dollarRisk: Number(trade.dollarRisk.toFixed(2)),
                score: Math.round(trade.deviationATR * 25),
                scoreTier: trDir,
                entryMode: "reversion",
                isPowerSetup: false,
                realizedR: Number(totalR.toFixed(2)),
                tier: "B" as TradeTier,
                direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG",
                scoreBreakdown: {
                  mfeR: Number(trade.mfeR.toFixed(3)),
                  maeR: Number(trade.maeR.toFixed(3)),
                  deviationATR: Number(trade.deviationATR.toFixed(2)),
                  strategy: "vwap_reversion",
                },
              });
              tradesGenerated++;
            } else {
              tradesGenerated++;
            }

            log(`[RevSim] ${ticker} CLOSED: ${trade.pendingExit.reason} | R=${totalR.toFixed(2)} PnL=$${pnl.toFixed(2)}`, "historical");
            activeTrade = null;
            cooldownUntilBar = i + (revConfig.cooldownBars ?? 3);
            processedBars++;
            continue;
          }

          let shouldExit = false;
          let exitReason = "";

          if (trade.direction === "SHORT_FADE") {
            if (bar.high >= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open >= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}`;
            }
            else if (!trade.isPartiallyExited && bar.low <= trade.target1) {
              const partialShares = Math.max(1, Math.floor(trade.shares * 0.5));
              const side: Side = "short";
              const partialTrace = applyFrictionAndRoundWithTrace({
                rawPrice: trade.target1,
                side,
                direction: "exit",
                atr14,
                costOverrides,
              });
              trade.isPartiallyExited = true;
              trade.partialExitPrice = partialTrace.finalPrice;
              trade.partialExitShares = partialShares;
              trade.runnerShares = trade.shares - partialShares;
              trade.realizedR += (riskPerShare > 0 ? (trade.entryPrice - partialTrace.finalPrice) / riskPerShare : 0) * (partialShares / trade.shares);
              trade.stopPrice = Math.min(trade.stopPrice, trade.entryPrice);
              log(`[RevSim] ${ticker} PARTIAL exit ${partialShares} shares at T1=$${trade.target1.toFixed(2)}`, "historical");
            }
            else if (trade.isPartiallyExited && bar.low <= trade.target2) {
              shouldExit = true;
              exitReason = `Target 2 (VWAP) hit at $${trade.target2.toFixed(2)}`;
            }
          } else {
            if (bar.low <= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open <= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}`;
            }
            else if (!trade.isPartiallyExited && bar.high >= trade.target1) {
              const partialShares = Math.max(1, Math.floor(trade.shares * 0.5));
              const side: Side = "long";
              const partialTrace = applyFrictionAndRoundWithTrace({
                rawPrice: trade.target1,
                side,
                direction: "exit",
                atr14,
                costOverrides,
              });
              trade.isPartiallyExited = true;
              trade.partialExitPrice = partialTrace.finalPrice;
              trade.partialExitShares = partialShares;
              trade.runnerShares = trade.shares - partialShares;
              trade.realizedR += (riskPerShare > 0 ? (partialTrace.finalPrice - trade.entryPrice) / riskPerShare : 0) * (partialShares / trade.shares);
              trade.stopPrice = Math.max(trade.stopPrice, trade.entryPrice);
              log(`[RevSim] ${ticker} PARTIAL exit ${partialShares} shares at T1=$${trade.target1.toFixed(2)}`, "historical");
            }
            else if (trade.isPartiallyExited && bar.high >= trade.target2) {
              shouldExit = true;
              exitReason = `Target 2 (VWAP) hit at $${trade.target2.toFixed(2)}`;
            }
          }

          const minutesSinceEntry = (i - trade.entryBarIndex) * 5;
          if (!shouldExit && minutesSinceEntry >= 45) {
            const currentR = trade.direction === "SHORT_FADE"
              ? (trade.entryPrice - bar.close) / riskPerShare
              : (bar.close - trade.entryPrice) / riskPerShare;
            if (currentR < 0.3) {
              trade.pendingExit = {
                reason: `Time stop ${minutesSinceEntry}min, current ${currentR.toFixed(2)}R`,
                exitType: "time_stop",
                decisionBarIndex: i,
              };
              processedBars++;
              continue;
            }
          }

          if (shouldExit) {
            const isIntrabar = exitReason.includes("Stop hit") || exitReason.includes("Target");
            if (!isIntrabar) {
              trade.pendingExit = { reason: exitReason, exitType: "exit", decisionBarIndex: i };
              processedBars++;
              continue;
            }

            const side: Side = trade.direction === "SHORT_FADE" ? "short" : "long";
            const isStop = exitReason.includes("Stop") || exitReason.includes("Gap-through");
            let rawFill: number;
            if (isStop) {
              if (trade.direction === "SHORT_FADE") {
                rawFill = bar.open >= trade.stopPrice ? bar.open : trade.stopPrice;
              } else {
                rawFill = bar.open <= trade.stopPrice ? bar.open : trade.stopPrice;
              }
            } else {
              if (trade.direction === "SHORT_FADE") {
                rawFill = bar.open <= trade.target2 ? bar.open : trade.target2;
              } else {
                rawFill = bar.open >= trade.target2 ? bar.open : trade.target2;
              }
            }

            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            const exitPrice = exitTrace.finalPrice;
            const shares = trade.shares;
            const grossPnl = trade.direction === "SHORT_FADE"
              ? (trade.entryPrice - exitPrice) * shares
              : (exitPrice - trade.entryPrice) * shares;
            const commission = calculateCommission(shares, costOverrides) * 2;
            const pnl = grossPnl - commission;
            const rMultiple = riskPerShare > 0
              ? (trade.direction === "SHORT_FADE"
                ? (trade.entryPrice - exitPrice) / riskPerShare
                : (exitPrice - trade.entryPrice) / riskPerShare)
              : 0;
            const totalR = trade.realizedR + rMultiple;

            totalPnl += pnl;
            if (pnl > 0) winCount++; else lossCount++;
            grossPnlTotal += grossPnl;
            totalCommissions += commission;
            totalSlippageCosts += exitTrace.slippageBps;
            tradeRs.push(totalR);
            tradeGrossPnls.push(grossPnl);
            tradeNetPnls.push(pnl);

            const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
            const trRegime = regimeResult.aligned ? "trending" : regimeResult.chopping ? "choppy" : "neutral";
            const trDir = trade.direction === "SHORT_FADE" ? "short_fade" : "long_fade";
            if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
            if (!tradesByTier[trDir]) tradesByTier[trDir] = { wins: 0, losses: 0, pnl: 0 };
            tradesByRegime[trRegime].pnl += pnl;
            tradesBySession[trSession].pnl += pnl;
            tradesByTier[trDir].pnl += pnl;
            if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier[trDir].wins++; }
            else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier[trDir].losses++; }

            addTrade(buildAnalyticsRecord(
              { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares, tier: trDir, direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG", entryBarIndex: trade.entryBarIndex },
              ticker, exitPrice, exitReason,
              bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp,
              totalR, pnl,
              { marketRegime: trRegime, session: trSession, spyAligned: regimeResult.aligned },
            ));

            if (!isDryRun) {
              await storage.createTrade({
                userId,
                simulationRunId: runId,
                signalId: null,
                ticker,
                side: trade.direction === "SHORT_FADE" ? "short" : "long",
                entryPrice: Number(trade.entryPrice.toFixed(2)),
                exitPrice: Number(exitPrice.toFixed(2)),
                stopPrice: Number(trade.originalStopPrice.toFixed(2)),
                originalStopPrice: Number(trade.originalStopPrice.toFixed(2)),
                target1: Number(trade.target1.toFixed(2)),
                target2: Number(trade.target2.toFixed(2)),
                shares,
                pnl: Number(pnl.toFixed(2)),
                pnlPercent: Number(((trade.direction === "SHORT_FADE" ? (trade.entryPrice - exitPrice) : (exitPrice - trade.entryPrice)) / trade.entryPrice * 100).toFixed(2)),
                rMultiple: Number(totalR.toFixed(2)),
                status: "closed",
                exitReason: `[SIM-REV] ${exitReason}`,
                isPartiallyExited: trade.isPartiallyExited,
                partialExitPrice: trade.partialExitPrice ? Number(trade.partialExitPrice.toFixed(2)) : null,
                partialExitShares: trade.partialExitShares,
                stopMovedToBE: trade.breakevenLocked,
                runnerShares: trade.runnerShares,
                trailingStopPrice: null,
                dollarRisk: Number(trade.dollarRisk.toFixed(2)),
                score: Math.round(trade.deviationATR * 25),
                scoreTier: trDir,
                entryMode: "reversion",
                isPowerSetup: false,
                realizedR: Number(totalR.toFixed(2)),
                tier: "B" as TradeTier,
                direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG",
                scoreBreakdown: {
                  mfeR: Number(trade.mfeR.toFixed(3)),
                  maeR: Number(trade.maeR.toFixed(3)),
                  deviationATR: Number(trade.deviationATR.toFixed(2)),
                  strategy: "vwap_reversion",
                },
              });
              tradesGenerated++;
            } else {
              tradesGenerated++;
            }

            log(`[RevSim] ${ticker} CLOSED: ${exitReason} | R=${totalR.toFixed(2)} PnL=$${pnl.toFixed(2)}`, "historical");
            activeTrade = null;
            cooldownUntilBar = i + (revConfig.cooldownBars ?? 3);
          }

          processedBars++;
          continue;
        }

        if (i < cooldownUntilBar) {
          processedBars++;
          continue;
        }

        if (tickerTradeCount >= (revConfig.maxTradesPerTicker ?? 10)) {
          processedBars++;
          continue;
        }

        const overextResult = checkOverextension(bars5mAccum, revConfig);

        if (overextResult.overextended && overextResult.direction) {
          diag.overextensions++;

          const exhaustResult = checkExhaustion(bars5mAccum, overextResult.direction, revConfig);

          if (exhaustResult.exhausted) {
            diag.exhaustions++;

            const entryCalc = calculateReversionEntry(bar, overextResult.vwap, overextResult.atr14, overextResult.direction, revConfig);

            const side: Side = overextResult.direction === "SHORT_FADE" ? "short" : "long";
            const entryTrace = applyFrictionAndRoundWithTrace({
              rawPrice: entryCalc.entryPrice,
              side,
              direction: "entry",
              atr14,
              costOverrides,
            });
            const entryPrice = entryTrace.finalPrice;
            const riskPerShare = Math.abs(entryPrice - entryCalc.stopPrice);

            if (riskPerShare > 0 && riskPerShare < entryPrice * 0.05) {
              diag.entries++;
              tickerTradeCount++;
              const dollarRisk = accountSize * revConfig.riskPct;
              const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));

              activeTrade = {
                direction: overextResult.direction,
                entryPrice,
                stopPrice: entryCalc.stopPrice,
                originalStopPrice: entryCalc.stopPrice,
                target1: entryCalc.target1Price,
                target2: entryCalc.target2Price,
                vwapAtEntry: overextResult.vwap,
                shares,
                entryBarIndex: i,
                dollarRisk,
                riskPerShare,
                deviationATR: overextResult.deviationATR,
                isPartiallyExited: false,
                partialExitPrice: null,
                partialExitShares: null,
                runnerShares: null,
                realizedR: 0,
                pendingExit: null,
                mfeR: 0,
                mfePrice: entryPrice,
                mfeBarIndex: i,
                maeR: 0,
                maePrice: entryPrice,
                maeBarIndex: i,
                breakevenLocked: false,
              };

              log(
                `[RevSim] ${ticker} ENTRY ${overextResult.direction} at $${entryPrice.toFixed(2)} | dev=${overextResult.deviationATR.toFixed(2)} ATR | stop=$${entryCalc.stopPrice.toFixed(2)} | T1=$${entryCalc.target1Price.toFixed(2)} T2=$${entryCalc.target2Price.toFixed(2)} | ${shares} shares`,
                "historical",
              );

              if (!isDryRun) {
                await storage.createSignal({
                  userId,
                  ticker,
                  state: "TRIGGERED",
                  resistanceLevel: Number(overextResult.vwap.toFixed(2)),
                  currentPrice: Number(entryPrice.toFixed(2)),
                  breakoutPrice: Number(entryPrice.toFixed(2)),
                  breakoutVolume: bar.volume,
                  trendConfirmed: false,
                  volumeConfirmed: exhaustResult.volumeDecline,
                  atrExpansion: false,
                  timeframe: "5m",
                  rvol: 1.0,
                  atrValue: Number(atr14.toFixed(4)),
                  rejectionCount: 0,
                  score: Math.round(overextResult.deviationATR * 25),
                  scoreTier: overextResult.direction === "SHORT_FADE" ? "short_fade" : "long_fade",
                  marketRegime: regimeResult.chopping ? "choppy" : regimeResult.aligned ? "aligned" : "misaligned",
                  spyAligned: regimeResult.aligned,
                  volatilityGatePassed: true,
                  scoreBreakdown: {
                    deviationATR: overextResult.deviationATR,
                    wickRatio: exhaustResult.wickRatio,
                    volumeRatio: exhaustResult.volumeRatio,
                    ema9Crossed: exhaustResult.ema9Crossed,
                    strategy: "vwap_reversion",
                    simDate: simulationDate,
                  },
                  relStrengthVsSpy: 0,
                  isPowerSetup: false,
                  tier: "B",
                  direction: overextResult.direction === "SHORT_FADE" ? "SHORT" : "LONG",
                  notes: `[SIM-REV ${simulationDate}] ${overextResult.direction} fade, ${overextResult.deviationATR.toFixed(2)} ATR from VWAP`,
                });
              }
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

      if (activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = activeTrade;
        const side: Side = trade.direction === "SHORT_FADE" ? "short" : "long";
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side,
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        const exitPrice = eodTrace.finalPrice;
        const grossPnl = trade.direction === "SHORT_FADE"
          ? (trade.entryPrice - exitPrice) * trade.shares
          : (exitPrice - trade.entryPrice) * trade.shares;
        const commission = calculateCommission(trade.shares, costOverrides) * 2;
        const pnl = grossPnl - commission;
        const rMultiple = trade.riskPerShare > 0
          ? (trade.direction === "SHORT_FADE"
            ? (trade.entryPrice - exitPrice) / trade.riskPerShare
            : (exitPrice - trade.entryPrice) / trade.riskPerShare)
          : 0;
        const totalR = trade.realizedR + rMultiple;

        totalPnl += pnl;
        if (pnl > 0) winCount++; else lossCount++;
        grossPnlTotal += grossPnl;
        totalCommissions += commission;
        tradeRs.push(totalR);
        tradeGrossPnls.push(grossPnl);
        tradeNetPnls.push(pnl);

        const trDir = trade.direction === "SHORT_FADE" ? "short_fade" : "long_fade";
        if (!tradesByTier[trDir]) tradesByTier[trDir] = { wins: 0, losses: 0, pnl: 0 };
        tradesByTier[trDir].pnl += pnl;
        if (pnl > 0) tradesByTier[trDir].wins++; else tradesByTier[trDir].losses++;

        addTrade(buildAnalyticsRecord(
          { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares: trade.shares, tier: trDir, direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG", entryBarIndex: trade.entryBarIndex },
          ticker, exitPrice, "End of day close",
          lastBar.timestamp,
          tickerBars5m[trade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          totalR, pnl,
        ));

        if (!isDryRun) {
          await storage.createTrade({
            userId,
            simulationRunId: runId,
            signalId: null,
            ticker,
            side: trade.direction === "SHORT_FADE" ? "short" : "long",
            entryPrice: Number(trade.entryPrice.toFixed(2)),
            exitPrice: Number(exitPrice.toFixed(2)),
            stopPrice: Number(trade.originalStopPrice.toFixed(2)),
            originalStopPrice: Number(trade.originalStopPrice.toFixed(2)),
            target1: Number(trade.target1.toFixed(2)),
            target2: Number(trade.target2.toFixed(2)),
            shares: trade.shares,
            pnl: Number(pnl.toFixed(2)),
            pnlPercent: Number(((trade.direction === "SHORT_FADE" ? (trade.entryPrice - exitPrice) : (exitPrice - trade.entryPrice)) / trade.entryPrice * 100).toFixed(2)),
            rMultiple: Number(totalR.toFixed(2)),
            status: "closed",
            exitReason: `[SIM-REV] End of day close`,
            isPartiallyExited: trade.isPartiallyExited,
            partialExitPrice: trade.partialExitPrice ? Number(trade.partialExitPrice.toFixed(2)) : null,
            partialExitShares: trade.partialExitShares,
            stopMovedToBE: trade.breakevenLocked,
            runnerShares: trade.runnerShares,
            trailingStopPrice: null,
            dollarRisk: Number(trade.dollarRisk.toFixed(2)),
            score: Math.round(trade.deviationATR * 25),
            scoreTier: trDir,
            entryMode: "reversion",
            isPowerSetup: false,
            realizedR: Number(totalR.toFixed(2)),
            tier: "B" as TradeTier,
            direction: trade.direction === "SHORT_FADE" ? "SHORT" : "LONG",
            scoreBreakdown: {
              mfeR: Number(trade.mfeR.toFixed(3)),
              maeR: Number(trade.maeR.toFixed(3)),
              deviationATR: Number(trade.deviationATR.toFixed(2)),
              strategy: "vwap_reversion",
            },
          });
          tradesGenerated++;
        } else {
          tradesGenerated++;
        }

        log(`[RevSim] ${ticker} EOD EXIT at $${exitPrice.toFixed(2)} | R=${totalR.toFixed(2)} PnL=$${pnl.toFixed(2)}`, "historical");
        activeTrade = null;
      }

      log(
        `[RevSim] ${ticker} pipeline: bars=${tickerBars5m.length}, overextensions=${diag.overextensions}, exhaustions=${diag.exhaustions}, entries=${diag.entries}`,
        "historical",
      );
    }

    let maxDD = 0;
    let peak = 0;
    let equity = 0;
    for (const r of tradeNetPnls) {
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    if (isDryRun) {
      return {
        trades: tradesGenerated,
        wins: winCount,
        losses: lossCount,
        grossPnl: Number(grossPnlTotal.toFixed(2)),
        netPnl: Number(totalPnl.toFixed(2)),
        totalCommissions: Number(totalCommissions.toFixed(2)),
        totalSlippageCosts: Number(totalSlippageCosts.toFixed(2)),
        tradeRs,
        tradeMFEs: tradeMFEs.length > 0 ? tradeMFEs : undefined,
        tradeHit1R: tradeHit1R.length > 0 ? tradeHit1R : undefined,
        tradeHitTarget: tradeHitTarget.length > 0 ? tradeHitTarget : undefined,
        maxDrawdown: Number(maxDD.toFixed(2)),
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      };
    }

    await storage.updateSimulationRun(runId, {
      status: "completed",
      processedBars,
      tradesGenerated,
      lessonsGenerated,
      totalPnl: Number(totalPnl.toFixed(2)),
      completedAt: new Date(),
    });

    log(
      `[RevSim] ${simulationDate} COMPLETE: ${tradesGenerated} trades, ${winCount}W/${lossCount}L, PnL=$${totalPnl.toFixed(2)}, MaxDD=$${maxDD.toFixed(2)}`,
      "historical",
    );
  } catch (error: any) {
    log(`[RevSim] Error: ${error.message}`, "historical");
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

interface ORFTradeState {
  direction: "SHORT" | "LONG";
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  targetPrice: number;
  trapHigh: number;
  trapLow: number;
  shares: number;
  originalShares: number;
  entryBarIndex: number;
  dollarRisk: number;
  riskPerShare: number;
  targetR: number;
  realizedR: number;
  pendingExit: { reason: string; exitType: string; decisionBarIndex: number } | null;
  mfeR: number;
  mfePrice: number;
  mfeBarIndex: number;
  maeR: number;
  maePrice: number;
  maeBarIndex: number;
  trailingStopPrice: number | null;
  trailingActivated: boolean;
  partialExitDone: boolean;
  partialExitPrice: number | null;
  partialExitShares: number;
  partialPnl: number;
  stopMovedToBE: boolean;
}

const ORF_EXPANDED_TICKERS = [
  "AAPL", "MSFT", "NVDA", "TSLA", "META",
  "AMZN", "GOOGL", "AMD", "NFLX", "AVGO",
  "JPM", "COST", "QQQ", "CRM", "ORCL",
];

export async function runORFSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList?: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    preloadedBars?: SimulationBarData;
    orfConfig?: Partial<ORFConfig>;
  },
): Promise<DryRunResult | void> {
  const tickers = tickerList ?? ORF_EXPANDED_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;
  const orfConfig: ORFConfig = { ...DEFAULT_ORF_CONFIG, ...(options?.orfConfig ?? {}) };

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
            errorMessage: "Alpaca API keys not configured.",
            completedAt: new Date(),
          });
        }
        return;
      }
      bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");
      bars15mMap = await fetchBarsForDate(allSymbols, simulationDate, "15Min");
      prevDayBars = await fetchDailyBarsForDate(allSymbols, simulationDate);
      multiDayBars = await fetchMultiDayDailyBars(allSymbols, simulationDate, 20);
    }

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data for ${simulationDate}.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    const spyOR = calculateOpeningRange(spyBars5m);

    let totalBars = 0;
    for (const t of tickers) totalBars += (bars5mMap.get(t) ?? []).length;
    if (!isDryRun) await storage.updateSimulationRun(runId, { totalBars });

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

    const accountSize = user.accountSize ?? 100000;
    let processedBars = 0;
    let tradesGenerated = 0;
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossPnlTotal = 0;
    let totalCommissions = 0;
    let totalSlippageCosts = 0;
    const tradeRs: number[] = [];
    const tradeMFEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
    const tradeMAEs: number[] = [];
    const tradeSlippageCostsR: number[] = [];
    const tradeScratchAfterPartial: number[] = [];
    const tradeLossBuckets: string[] = [];
    const tradeTickers: string[] = [];
    const tradeRegimes: string[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};

    const closeTrade = (
      trade: ORFTradeState,
      exitPrice: number,
      exitReason: string,
      ticker: string,
      barTimestamp: number,
      entryTimestamp: number,
      minutesSinceOpen: number,
      regimeResult: any,
      atr14: number,
    ) => {
      const shares = trade.shares;
      const riskPerShare = trade.riskPerShare;
      const grossPnl = trade.direction === "SHORT"
        ? (trade.entryPrice - exitPrice) * shares
        : (exitPrice - trade.entryPrice) * shares;
      const totalGrossPnl = grossPnl + trade.partialPnl;
      const commission = calculateCommission(trade.originalShares, costOverrides) * 2;
      const pnl = totalGrossPnl - commission;

      const totalWeightedR = riskPerShare > 0
        ? (trade.direction === "SHORT"
          ? (trade.entryPrice - exitPrice) / riskPerShare
          : (exitPrice - trade.entryPrice) / riskPerShare)
        : 0;

      let compositeR: number;
      if (trade.partialExitDone && trade.originalShares > 0) {
        const runnerFraction = shares / trade.originalShares;
        const partialFraction = trade.partialExitShares / trade.originalShares;
        const partialR = trade.partialExitPrice !== null && riskPerShare > 0
          ? (trade.direction === "SHORT"
            ? (trade.entryPrice - trade.partialExitPrice) / riskPerShare
            : (trade.partialExitPrice - trade.entryPrice) / riskPerShare)
          : 0;
        compositeR = partialR * partialFraction + totalWeightedR * runnerFraction;
      } else {
        compositeR = totalWeightedR;
      }

      totalPnl += pnl;
      if (pnl > 0) winCount++; else lossCount++;
      grossPnlTotal += totalGrossPnl;
      totalCommissions += commission;
      tradeRs.push(compositeR);
      tradeGrossPnls.push(totalGrossPnl);
      tradeNetPnls.push(pnl);

      tradeMFEs.push(trade.mfeR);
      tradeMAEs.push(trade.maeR);
      tradeHit1R.push(trade.mfeR >= 1.0 ? 1 : 0);
      tradeHitTarget.push(trade.mfeR >= trade.targetR ? 1 : 0);

      const frictionCostR = riskPerShare > 0 && trade.originalShares > 0 ? (commission / (riskPerShare * trade.originalShares)) : 0;
      tradeSlippageCostsR.push(frictionCostR);

      const isScratchAfterPartial = trade.partialExitDone && trade.stopMovedToBE && Math.abs(totalWeightedR) < 0.15;
      tradeScratchAfterPartial.push(isScratchAfterPartial ? 1 : 0);

      tradeTickers.push(ticker);
      let lossBucket = "other";
      if (compositeR < 0) {
        if (trade.mfeR < 0.3) lossBucket = "stopped_before_0.3R";
        else if (trade.partialExitDone && trade.stopMovedToBE) lossBucket = "partial_then_scratch";
        else lossBucket = "reversed_after_0.3R";
      }
      tradeLossBuckets.push(lossBucket);
      const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
      const trRegime = regimeResult?.aligned ? "trending" : regimeResult?.chopping ? "choppy" : "neutral";
      tradeRegimes.push(trRegime);
      if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesByTier["orf"]) tradesByTier["orf"] = { wins: 0, losses: 0, pnl: 0 };
      tradesByRegime[trRegime].pnl += pnl;
      tradesBySession[trSession].pnl += pnl;
      tradesByTier["orf"].pnl += pnl;
      if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier["orf"].wins++; }
      else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier["orf"].losses++; }

      addTrade(buildAnalyticsRecord(
        { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares: trade.originalShares, tier: "orf", direction: trade.direction, entryBarIndex: trade.entryBarIndex },
        ticker, exitPrice, exitReason,
        barTimestamp,
        entryTimestamp,
        compositeR, pnl,
        { marketRegime: trRegime, session: trSession, spyAligned: regimeResult?.aligned, entryMode: "orf" },
      ));

      tradesGenerated++;

      log(`[ORFSim] ${ticker} CLOSED: ${exitReason} | R=${compositeR.toFixed(2)} PnL=$${pnl.toFixed(2)}${trade.partialExitDone ? " (partial@" + (trade.partialExitPrice?.toFixed(2)) + ")" : ""}`, "historical");
    }

    for (const ticker of tickers) {
      if (control.cancel) break;

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 5) {
        processedBars += tickerBars5m.length;
        continue;
      }

      const tickerOR = calculateOpeningRange(tickerBars5m);
      if (!tickerOR) {
        processedBars += tickerBars5m.length;
        continue;
      }

      const avgVol20 = dailyHistory.length > 1
        ? dailyHistory.slice(0, -1).reduce((s: number, b: any) => s + b.volume, 0) / (dailyHistory.length - 1)
        : 0;
      const avgVol20per5m = avgVol20 / 78;

      const bars5mAccum: Candle[] = [];
      let activeTrade: ORFTradeState | null = null;
      let cooldownUntilBar = 0;
      let tickerTradeCount = 0;

      let activeBreak: BreakDetection | null = null;
      let breakHandled = false;

      let diag = { breaks: 0, failures: 0, entries: 0, spyDivergent: 0, orQualitySkips: 0, breakQualitySkips: 0, rsSkips: 0 };

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        bars5mAccum.push(bar);
        if (bars5mAccum.length > 200) bars5mAccum.shift();

        const minutesSinceOpen = (i + 1) * 5;
        const atr14 = calculateATR(bars5mAccum, 14);

        const spyBarsToNow = spyBars5m.filter((b: Candle) => b.timestamp <= bar.timestamp);
        const regimeResult = checkMarketRegime(spyBarsToNow.slice(-40), DEFAULT_STRATEGY_CONFIG.marketRegime);

        if (i === 0) {
          const qualityGate = checkORQualityGate(tickerOR, atr14 > 0 ? atr14 : bar.high - bar.low, orfConfig);
          if (!qualityGate.passed) {
            diag.orQualitySkips++;
            log(`[ORFSim] ${ticker} SKIP: ${qualityGate.reason}`, "historical");
            processedBars += tickerBars5m.length;
            break;
          }
          processedBars++;
          continue;
        }

        if (activeTrade) {
          const trade = activeTrade;
          const riskPerShare = trade.riskPerShare;

          if (riskPerShare > 0) {
            let barMfeR: number, barMaeR: number;
            if (trade.direction === "SHORT") {
              barMfeR = (trade.entryPrice - bar.low) / riskPerShare;
              barMaeR = (trade.entryPrice - bar.high) / riskPerShare;
            } else {
              barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
              barMaeR = (bar.low - trade.entryPrice) / riskPerShare;
            }

            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = trade.direction === "SHORT" ? bar.low : bar.high;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = trade.direction === "SHORT" ? bar.high : bar.low;
              trade.maeBarIndex = i;
            }

            if (orfConfig.partialExitEnabled && !trade.partialExitDone && trade.mfeR >= orfConfig.partialExitR) {
              const partialShares = Math.max(1, Math.floor(trade.originalShares * orfConfig.partialExitPct));
              if (partialShares < trade.shares) {
                let partialPrice: number;
                if (trade.direction === "SHORT") {
                  partialPrice = trade.entryPrice - orfConfig.partialExitR * riskPerShare;
                } else {
                  partialPrice = trade.entryPrice + orfConfig.partialExitR * riskPerShare;
                }
                const partialPnl = trade.direction === "SHORT"
                  ? (trade.entryPrice - partialPrice) * partialShares
                  : (partialPrice - trade.entryPrice) * partialShares;

                trade.partialExitDone = true;
                trade.partialExitPrice = partialPrice;
                trade.partialExitShares = partialShares;
                trade.partialPnl = partialPnl;
                trade.shares -= partialShares;

                trade.stopPrice = trade.entryPrice + (trade.direction === "SHORT" ? -0.02 : 0.02) * riskPerShare;
                trade.stopMovedToBE = true;

                log(`[ORFSim] ${ticker} PARTIAL ${partialShares}sh @$${partialPrice.toFixed(2)} (${orfConfig.partialExitR}R), stop->BE+buffer, ${trade.shares}sh remain`, "historical");
              }
            }

            if (!trade.trailingActivated && trade.mfeR >= orfConfig.trailAfterR) {
              trade.trailingActivated = true;
              if (trade.direction === "SHORT") {
                trade.trailingStopPrice = trade.entryPrice - (trade.mfeR * 0.5) * riskPerShare;
              } else {
                trade.trailingStopPrice = trade.entryPrice + (trade.mfeR * 0.5) * riskPerShare;
              }
            }

            if (trade.trailingActivated && trade.trailingStopPrice !== null) {
              if (trade.direction === "SHORT") {
                const newTrail = bar.low + riskPerShare * 0.5;
                if (newTrail < trade.trailingStopPrice) {
                  trade.trailingStopPrice = newTrail;
                }
                trade.stopPrice = Math.min(trade.stopPrice, trade.trailingStopPrice);
              } else {
                const newTrail = bar.high - riskPerShare * 0.5;
                if (newTrail > trade.trailingStopPrice) {
                  trade.trailingStopPrice = newTrail;
                }
                trade.stopPrice = Math.max(trade.stopPrice, trade.trailingStopPrice);
              }
            }
          }

          if (trade.pendingExit) {
            const side: Side = trade.direction === "SHORT" ? "short" : "long";
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: bar.open,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeTrade(trade, exitTrace.finalPrice, trade.pendingExit.reason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            cooldownUntilBar = i + orfConfig.cooldownBars;
            processedBars++;
            continue;
          }

          let shouldExit = false;
          let exitReason = "";

          if (trade.direction === "SHORT") {
            if (bar.high >= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open >= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.stopMovedToBE ? " (BE)" : ""}`;
            }
            else if (bar.low <= trade.targetPrice) {
              shouldExit = true;
              exitReason = bar.open <= trade.targetPrice
                ? `Target ${trade.targetR}R hit (gap-through) at $${bar.open.toFixed(2)}`
                : `Target ${trade.targetR}R hit at $${trade.targetPrice.toFixed(2)}`;
            }
          } else {
            if (bar.low <= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open <= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.stopMovedToBE ? " (BE)" : ""}`;
            }
            else if (bar.high >= trade.targetPrice) {
              shouldExit = true;
              exitReason = bar.open >= trade.targetPrice
                ? `Target ${trade.targetR}R hit (gap-through) at $${bar.open.toFixed(2)}`
                : `Target ${trade.targetR}R hit at $${trade.targetPrice.toFixed(2)}`;
            }
          }

          if (!shouldExit && orfConfig.vwapExitEnabled && orfConfig.vwapExitMode !== "off") {
            const vwap = calculateVWAP(tickerBars5m.slice(0, i + 1));
            if (vwap > 0) {
              let vwapTouched = false;
              if (trade.direction === "SHORT" && bar.low <= vwap && trade.entryPrice > vwap) {
                vwapTouched = true;
              } else if (trade.direction === "LONG" && bar.high >= vwap && trade.entryPrice < vwap) {
                vwapTouched = true;
              }

              if (vwapTouched) {
                if (orfConfig.vwapExitMode === "full") {
                  shouldExit = true;
                  exitReason = `VWAP touch exit at $${vwap.toFixed(2)}`;
                } else if (orfConfig.vwapExitMode === "partial" && !trade.partialExitDone) {
                  const partialShares = Math.max(1, Math.floor(trade.originalShares * 0.5));
                  if (partialShares < trade.shares) {
                    const partialPnl = trade.direction === "SHORT"
                      ? (trade.entryPrice - vwap) * partialShares
                      : (vwap - trade.entryPrice) * partialShares;
                    trade.partialExitDone = true;
                    trade.partialExitPrice = vwap;
                    trade.partialExitShares = partialShares;
                    trade.partialPnl = partialPnl;
                    trade.shares -= partialShares;
                    trade.stopPrice = trade.entryPrice + (trade.direction === "SHORT" ? -0.02 : 0.02) * riskPerShare;
                    trade.stopMovedToBE = true;
                    log(`[ORFSim] ${ticker} VWAP PARTIAL ${partialShares}sh @$${vwap.toFixed(2)}, stop->BE+buffer, ${trade.shares}sh remain`, "historical");
                  }
                }
              }
            }
          }

          if (!shouldExit && minutesSinceOpen >= orfConfig.timeExitMinutes) {
            trade.pendingExit = {
              reason: `Time exit at ${minutesSinceOpen}min`,
              exitType: "time_stop",
              decisionBarIndex: i,
            };
            processedBars++;
            continue;
          }

          if (shouldExit) {
            const isIntrabar = exitReason.includes("Stop hit") || exitReason.includes("Target") || exitReason.includes("VWAP");
            if (!isIntrabar) {
              trade.pendingExit = { reason: exitReason, exitType: "exit", decisionBarIndex: i };
              processedBars++;
              continue;
            }

            const side: Side = trade.direction === "SHORT" ? "short" : "long";
            const isStop = exitReason.includes("Stop") || exitReason.includes("Gap-through stop");
            let rawFill: number;
            if (isStop) {
              if (trade.direction === "SHORT") {
                rawFill = bar.open >= trade.stopPrice ? bar.open : trade.stopPrice;
              } else {
                rawFill = bar.open <= trade.stopPrice ? bar.open : trade.stopPrice;
              }
            } else if (exitReason.includes("VWAP")) {
              const vwap = calculateVWAP(tickerBars5m.slice(0, i + 1));
              rawFill = vwap;
            } else {
              if (trade.direction === "SHORT") {
                rawFill = bar.open <= trade.targetPrice ? bar.open : trade.targetPrice;
              } else {
                rawFill = bar.open >= trade.targetPrice ? bar.open : trade.targetPrice;
              }
            }

            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeTrade(trade, exitTrace.finalPrice, exitReason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            cooldownUntilBar = i + orfConfig.cooldownBars;
          }

          processedBars++;
          continue;
        }

        if (i < cooldownUntilBar) {
          processedBars++;
          continue;
        }

        if (tickerTradeCount >= orfConfig.maxTradesPerTicker) {
          processedBars++;
          continue;
        }

        if (!activeBreak || breakHandled) {
          const breakResult = detectBreak(tickerBars5m, tickerOR, i, orfConfig, avgVol20per5m, atr14);
          if (breakResult.broken) {
            if (!orfConfig.requireVolConfirmation || breakResult.volumeConfirmed) {
              if (!breakResult.qualityPassed) {
                diag.breakQualitySkips++;
              } else {
                activeBreak = breakResult;
                breakHandled = false;
                diag.breaks++;
                log(`[ORFSim] ${ticker} BREAK ${breakResult.direction} at bar ${i}, dist=$${breakResult.breakDistance.toFixed(3)}, OR=[${tickerOR.low.toFixed(2)}, ${tickerOR.high.toFixed(2)}]`, "historical");
              }
            }
          }
        }

        if (activeBreak && !breakHandled) {
          const failureResult = detectFailure(
            tickerBars5m,
            tickerOR,
            activeBreak,
            i,
            spyBars5m,
            spyOR,
            orfConfig,
          );

          if (failureResult.failed && failureResult.direction) {
            diag.failures++;
            if (failureResult.spyDiverging) diag.spyDivergent++;

            if (orfConfig.requireRSConfirmation && !failureResult.rsConfirmed) {
              diag.rsSkips++;
              breakHandled = true;
              log(`[ORFSim] ${ticker} RS SKIP: ${failureResult.reasons.join("; ")}`, "historical");
              processedBars++;
              continue;
            }

            breakHandled = true;

            const entryCalc = calculateORFEntry(bar, failureResult, atr14, orfConfig);
            if (entryCalc && entryCalc.riskPerShare > 0 && entryCalc.riskPerShare < bar.close * 0.05) {
              diag.entries++;
              tickerTradeCount++;

              const side: Side = entryCalc.direction === "SHORT" ? "short" : "long";
              const entryTrace = applyFrictionAndRoundWithTrace({
                rawPrice: entryCalc.entryPrice,
                side,
                direction: "entry",
                atr14,
                costOverrides,
              });
              const entryPrice = entryTrace.finalPrice;
              const riskPerShare = Math.abs(entryPrice - entryCalc.stopPrice);

              if (riskPerShare > 0) {
                const dollarRisk = accountSize * orfConfig.riskPct;
                const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));

                let targetPrice: number;
                if (entryCalc.direction === "SHORT") {
                  targetPrice = entryPrice - riskPerShare * orfConfig.targetMultiple;
                } else {
                  targetPrice = entryPrice + riskPerShare * orfConfig.targetMultiple;
                }

                activeTrade = {
                  direction: entryCalc.direction,
                  entryPrice,
                  stopPrice: entryCalc.stopPrice,
                  originalStopPrice: entryCalc.stopPrice,
                  targetPrice,
                  trapHigh: entryCalc.trapHigh,
                  trapLow: entryCalc.trapLow,
                  shares,
                  originalShares: shares,
                  entryBarIndex: i,
                  dollarRisk,
                  riskPerShare,
                  targetR: orfConfig.targetMultiple,
                  realizedR: 0,
                  pendingExit: null,
                  mfeR: 0,
                  mfePrice: entryPrice,
                  mfeBarIndex: i,
                  maeR: 0,
                  maePrice: entryPrice,
                  maeBarIndex: i,
                  trailingStopPrice: null,
                  trailingActivated: false,
                  partialExitDone: false,
                  partialExitPrice: null,
                  partialExitShares: 0,
                  partialPnl: 0,
                  stopMovedToBE: false,
                };

                log(
                  `[ORFSim] ${ticker} ENTRY ${entryCalc.direction} at $${entryPrice.toFixed(2)} | stop=$${entryCalc.stopPrice.toFixed(2)} | target=$${targetPrice.toFixed(2)} (${orfConfig.targetMultiple}R) | ${shares}sh | RS=${failureResult.rsValue.toFixed(5)} | ${failureResult.reasons.join("; ")}`,
                  "historical",
                );
              }
            }
          }

          const barsSinceBreak = i - activeBreak.breakBarIndex;
          if (barsSinceBreak > orfConfig.failWindowBars && !breakHandled) {
            breakHandled = true;
          }
        }

        processedBars++;

        if (!isDryRun && processedBars % 20 === 0) {
          await storage.updateSimulationRun(runId, {
            processedBars,
            tradesGenerated,
            totalPnl: Number(totalPnl.toFixed(2)),
          });
        }
      }

      if (activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = activeTrade;
        const side: Side = trade.direction === "SHORT" ? "short" : "long";
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side,
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        closeTrade(trade, eodTrace.finalPrice, "End of day close", ticker, lastBar.timestamp,
          tickerBars5m[trade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          tickerBars5m.length * 5, null, calculateATR(bars5mAccum, 14));
        activeTrade = null;
      }

      log(
        `[ORFSim] ${ticker} pipeline: bars=${tickerBars5m.length}, OR=[${tickerOR.low.toFixed(2)}-${tickerOR.high.toFixed(2)}], orSkips=${diag.orQualitySkips}, breaks=${diag.breaks}, breakSkips=${diag.breakQualitySkips}, failures=${diag.failures}, rsSkips=${diag.rsSkips}, entries=${diag.entries}`,
        "historical",
      );
    }

    let maxDD = 0;
    let peak = 0;
    let equity = 0;
    for (const r of tradeNetPnls) {
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    if (isDryRun) {
      return {
        trades: tradesGenerated,
        wins: winCount,
        losses: lossCount,
        grossPnl: Number(grossPnlTotal.toFixed(2)),
        netPnl: Number(totalPnl.toFixed(2)),
        totalCommissions: Number(totalCommissions.toFixed(2)),
        totalSlippageCosts: Number(totalSlippageCosts.toFixed(2)),
        tradeRs,
        tradeMFEs: tradeMFEs.length > 0 ? tradeMFEs : undefined,
        tradeMAEs: tradeMAEs.length > 0 ? tradeMAEs : undefined,
        tradeHit1R: tradeHit1R.length > 0 ? tradeHit1R : undefined,
        tradeHitTarget: tradeHitTarget.length > 0 ? tradeHitTarget : undefined,
        tradeSlippageCostsR: tradeSlippageCostsR.length > 0 ? tradeSlippageCostsR : undefined,
        tradeScratchAfterPartial: tradeScratchAfterPartial.length > 0 ? tradeScratchAfterPartial : undefined,
        tradeLossBuckets: tradeLossBuckets.length > 0 ? tradeLossBuckets : undefined,
        tradeTickers: tradeTickers.length > 0 ? tradeTickers : undefined,
        tradeRegimes: tradeRegimes.length > 0 ? tradeRegimes : undefined,
        maxDrawdown: Number(maxDD.toFixed(2)),
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      };
    }

    await storage.updateSimulationRun(runId, {
      status: "completed",
      processedBars,
      tradesGenerated,
      lessonsGenerated: 0,
      totalPnl: Number(totalPnl.toFixed(2)),
      completedAt: new Date(),
    });

    log(
      `[ORFSim] ${simulationDate} COMPLETE: ${tradesGenerated} trades, ${winCount}W/${lossCount}L, PnL=$${totalPnl.toFixed(2)}, MaxDD=$${maxDD.toFixed(2)}`,
      "historical",
    );
  } catch (error: any) {
    log(`[ORFSim] Error: ${error.message}`, "historical");
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

// ============================================================
// RS Continuation (Institutional Flow) Simulation
// ============================================================

interface RSTradeState {
  direction: "LONG";
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  targetPrice: number;
  shares: number;
  originalShares: number;
  entryBarIndex: number;
  dollarRisk: number;
  riskPerShare: number;
  targetR: number;
  pendingExit: { reason: string; exitType: string; decisionBarIndex: number } | null;
  mfeR: number;
  mfePrice: number;
  mfeBarIndex: number;
  maeR: number;
  maePrice: number;
  maeBarIndex: number;
  trailingStopPrice: number | null;
  trailingActivated: boolean;
  partialExitDone: boolean;
  partialExitPrice: number | null;
  partialExitShares: number;
  partialPnl: number;
  stopMovedToBE: boolean;
  rsAtEntry: number;
}

const RS_TICKERS = [
  "AAPL", "MSFT", "NVDA", "TSLA", "META",
  "AMZN", "GOOGL", "AMD", "NFLX", "AVGO",
  "JPM", "COST", "QQQ", "CRM", "ORCL",
];

export async function runRSContinuationSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList?: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    rsConfig?: Partial<RSConfig>;
  },
): Promise<DryRunResult | void> {
  const tickers = tickerList ?? RS_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;
  const rsConfig: RSConfig = { ...DEFAULT_RS_CONFIG, ...(options?.rsConfig ?? {}) };

  const control = { cancel: false };
  if (!isDryRun) {
    activeSimulations.set(runId, control);
  }

  try {
    if (!isDryRun) {
      await storage.updateSimulationRun(runId, { status: "running", tickers });
    }

    if (!isAlpacaConfigured()) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: "Alpaca API keys not configured.",
          completedAt: new Date(),
        });
      }
      return;
    }

    const bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");
    const multiDayBars = await fetchMultiDayDailyBars(allSymbols, simulationDate, 20);

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data for ${simulationDate}.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    const user = await storage.getUser(userId);
    if (!user) return;
    const accountSize = user.accountSize ?? 100000;

    let processedBars = 0;
    let tradesGenerated = 0;
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossPnlTotal = 0;
    let totalCommissions = 0;
    let totalSlippageCosts = 0;
    const tradeRs: number[] = [];
    const tradeMFEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
    const tradeMAEs: number[] = [];
    const tradeSlippageCostsR: number[] = [];
    const tradeScratchAfterPartial: number[] = [];
    const tradeLossBuckets: string[] = [];
    const tradeTickers: string[] = [];
    const tradeRegimes: string[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};

    const closeRSTrade = (
      trade: RSTradeState,
      exitPrice: number,
      exitReason: string,
      ticker: string,
      barTimestamp: number,
      entryTimestamp: number,
      minutesSinceOpen: number,
      regimeResult: any,
      atr14: number,
    ) => {
      const shares = trade.shares;
      const riskPerShare = trade.riskPerShare;
      const grossPnl = (exitPrice - trade.entryPrice) * shares;
      const totalGrossPnl = grossPnl + trade.partialPnl;
      const commission = calculateCommission(trade.originalShares, costOverrides) * 2;
      const pnl = totalGrossPnl - commission;

      const runnerR = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : 0;

      let compositeR: number;
      if (trade.partialExitDone && trade.originalShares > 0) {
        const runnerFraction = shares / trade.originalShares;
        const partialFraction = trade.partialExitShares / trade.originalShares;
        const partialR = trade.partialExitPrice !== null && riskPerShare > 0
          ? (trade.partialExitPrice - trade.entryPrice) / riskPerShare
          : 0;
        compositeR = partialR * partialFraction + runnerR * runnerFraction;
      } else {
        compositeR = runnerR;
      }

      totalPnl += pnl;
      if (pnl > 0) winCount++; else lossCount++;
      grossPnlTotal += totalGrossPnl;
      totalCommissions += commission;
      tradeRs.push(compositeR);
      tradeGrossPnls.push(totalGrossPnl);
      tradeNetPnls.push(pnl);

      tradeMFEs.push(trade.mfeR);
      tradeMAEs.push(trade.maeR);
      tradeHit1R.push(trade.mfeR >= 1.0 ? 1 : 0);
      tradeHitTarget.push(trade.mfeR >= trade.targetR ? 1 : 0);

      // Loss Decomposition
      let lossBucket = "other";
      if (compositeR <= 0) {
        if (trade.mfeR < 0.3) {
          lossBucket = "stopped_before_0.3R";
        } else if (trade.mfeR >= 0.3 && !trade.partialExitDone) {
          lossBucket = "reversed_after_0.3R";
        } else if (trade.partialExitDone && trade.stopMovedToBE && Math.abs(runnerR) < 0.15) {
          lossBucket = "partial_then_scratch";
        }
      }

      const frictionCostR = riskPerShare > 0 && trade.originalShares > 0 ? (commission / (riskPerShare * trade.originalShares)) : 0;
      tradeSlippageCostsR.push(frictionCostR);

      const isScratchAfterPartial = trade.partialExitDone && trade.stopMovedToBE && Math.abs(runnerR) < 0.15;
      tradeScratchAfterPartial.push(isScratchAfterPartial ? 1 : 0);

      tradeTickers.push(ticker);
      tradeLossBuckets.push(lossBucket);
      const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
      const trRegime = regimeResult?.aligned ? "trending" : regimeResult?.chopping ? "choppy" : "neutral";
      tradeRegimes.push(trRegime);
      if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesByTier["rs_long"]) tradesByTier["rs_long"] = { wins: 0, losses: 0, pnl: 0 };
      tradesByRegime[trRegime].pnl += pnl;
      tradesBySession[trSession].pnl += pnl;
      tradesByTier["rs_long"].pnl += pnl;
      if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier["rs_long"].wins++; }
      else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier["rs_long"].losses++; }

      addTrade(buildAnalyticsRecord(
        { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares: trade.originalShares, tier: "rs_long", direction: "LONG", entryBarIndex: trade.entryBarIndex },
        ticker, exitPrice, exitReason,
        barTimestamp,
        entryTimestamp,
        compositeR, pnl,
        { marketRegime: trRegime, session: trSession, spyAligned: regimeResult?.aligned, entryMode: "rs_continuation" },
      ));

      tradesGenerated++;
      log(`[RSSim] ${ticker} CLOSED: ${exitReason} | R=${compositeR.toFixed(2)} PnL=$${pnl.toFixed(2)} RS@entry=${trade.rsAtEntry.toFixed(4)}${trade.partialExitDone ? " (partial@" + (trade.partialExitPrice?.toFixed(2)) + ")" : ""}`, "historical");
    };

    for (const ticker of tickers) {
      if (control.cancel) break;

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      if (tickerBars5m.length < 10) {
        processedBars += tickerBars5m.length;
        continue;
      }

      const bars5mAccum: Candle[] = [];
      let activeTrade: RSTradeState | null = null;
      let cooldownUntilBar = 0;
      let tickerTradeCount = 0;
      let hod = tickerBars5m[0].high;

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        bars5mAccum.push(bar);
        if (bars5mAccum.length > 200) bars5mAccum.shift();

        const minutesSinceOpen = (i + 1) * 5;
        const atr14 = calculateATR(bars5mAccum, 14);

        if (bar.high > hod) hod = bar.high;

        const spyBarsToNow = spyBars5m.filter((b: Candle) => b.timestamp <= bar.timestamp);
        const regimeResult = checkMarketRegime(spyBarsToNow.slice(-40), DEFAULT_STRATEGY_CONFIG.marketRegime);

        if (i < rsConfig.rsLookbackBars) {
          processedBars++;
          continue;
        }

        if (activeTrade) {
          const trade = activeTrade;
          const riskPerShare = trade.riskPerShare;

          if (riskPerShare > 0) {
            const barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
            const barMaeR = (bar.low - trade.entryPrice) / riskPerShare;

            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = bar.high;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = bar.low;
              trade.maeBarIndex = i;
            }

            if (!trade.partialExitDone && trade.mfeR >= 1.0 && !rsConfig.noPartial) {
              const partialShares = Math.max(1, Math.floor(trade.originalShares * 0.5));
              if (partialShares < trade.shares) {
                const partialPrice = trade.entryPrice + 1.0 * riskPerShare;
                const partialPnl = (partialPrice - trade.entryPrice) * partialShares;
                trade.partialExitDone = true;
                trade.partialExitPrice = partialPrice;
                trade.partialExitShares = partialShares;
                trade.partialPnl = partialPnl;
                trade.shares -= partialShares;
                trade.stopPrice = trade.entryPrice + 0.02 * riskPerShare;
                trade.stopMovedToBE = true;
                log(`[RSSim] ${ticker} PARTIAL ${partialShares}sh @$${partialPrice.toFixed(2)} (1R), stop->BE+buffer, ${trade.shares}sh remain`, "historical");
              }
            }

            if (!trade.trailingActivated && trade.mfeR >= 1.5) {
              trade.trailingActivated = true;
              trade.trailingStopPrice = trade.entryPrice + (trade.mfeR * 0.5) * riskPerShare;
            }

            if (trade.trailingActivated && trade.trailingStopPrice !== null) {
              const newTrail = bar.high - riskPerShare * 0.5;
              if (newTrail > trade.trailingStopPrice) {
                trade.trailingStopPrice = newTrail;
              }
              trade.stopPrice = Math.max(trade.stopPrice, trade.trailingStopPrice);
            }
          }

          if (trade.pendingExit) {
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: bar.open,
              side: "long",
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeRSTrade(trade, exitTrace.finalPrice, trade.pendingExit.reason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            cooldownUntilBar = i + 3;
            processedBars++;
            continue;
          }

          let shouldExit = false;
          let exitReason = "";

          if (bar.low <= trade.stopPrice) {
            shouldExit = true;
            exitReason = bar.open <= trade.stopPrice
              ? `Gap-through stop at $${bar.open.toFixed(2)}`
              : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.stopMovedToBE ? " (BE)" : ""}`;
            if (bar.high >= trade.targetPrice) {
              shouldExit = true;
              exitReason = bar.open >= trade.targetPrice
                ? `Target ${trade.targetR}R hit (gap-through) at $${bar.open.toFixed(2)}`
                : `Target ${trade.targetR}R hit at $${trade.targetPrice.toFixed(2)}`;
            }
          }

          if (!shouldExit && minutesSinceOpen >= rsConfig.timeExitMinutes) {
            trade.pendingExit = {
              reason: `Time exit at ${minutesSinceOpen}min`,
              exitType: "time_stop",
              decisionBarIndex: i,
            };
            processedBars++;
            continue;
          }

          if (shouldExit) {
            const isIntrabar = exitReason.includes("Stop hit") || exitReason.includes("Target");
            if (!isIntrabar) {
              trade.pendingExit = { reason: exitReason, exitType: "exit", decisionBarIndex: i };
              processedBars++;
              continue;
            }

            const isStop = exitReason.includes("Stop") || exitReason.includes("Gap-through stop");
            let rawFill: number;
            if (isStop) {
              rawFill = bar.open <= trade.stopPrice ? bar.open : trade.stopPrice;
            } else {
              rawFill = bar.open >= trade.targetPrice ? bar.open : trade.targetPrice;
            }

            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side: "long",
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeRSTrade(trade, exitTrace.finalPrice, exitReason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            cooldownUntilBar = i + 3;
          }

          processedBars++;
          continue;
        }

        if (i < cooldownUntilBar || tickerTradeCount >= rsConfig.maxTradesPerTicker) {
          processedBars++;
          continue;
        }

        if (minutesSinceOpen < 35) {
          processedBars++;
          continue;
        }

        const hodBeforeThisBar = Math.max(...tickerBars5m.slice(0, i).map(b => b.high));

        const signal = detectRSContinuation(
          tickerBars5m,
          spyBars5m,
          i,
          rsConfig,
          hodBeforeThisBar,
        );

        if (signal.triggered && signal.direction === "LONG") {
          tickerTradeCount++;

          const recentLows = tickerBars5m.slice(Math.max(0, i - 6), i + 1).map(b => b.low);
          const swingLow = Math.min(...recentLows);
          const vwap = calculateVWAP(tickerBars5m.slice(0, i + 1));
          const stopLevel = Math.max(swingLow, vwap) - atr14 * 0.1;

          const entryTrace = applyFrictionAndRoundWithTrace({
            rawPrice: bar.close,
            side: "long",
            direction: "entry",
            atr14,
            costOverrides,
          });
          const entryPrice = entryTrace.finalPrice;
          const riskPerShare = entryPrice - stopLevel;

          if (riskPerShare > 0 && riskPerShare < entryPrice * 0.03) {
            const dollarRisk = accountSize * rsConfig.riskPct;
            const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));
          const targetPrice = rsConfig.noTarget ? 999999 : (entryPrice + riskPerShare * rsConfig.targetMultiple);

          activeTrade = {
            direction: "LONG",
            entryPrice,
            stopPrice: stopLevel,
            originalStopPrice: stopLevel,
            targetPrice,
            shares,
            originalShares: shares,
            entryBarIndex: i,
            dollarRisk,
            riskPerShare,
            targetR: rsConfig.noTarget ? 99 : rsConfig.targetMultiple,
            pendingExit: null,
            mfeR: 0,
            mfePrice: entryPrice,
            mfeBarIndex: i,
            maeR: 0,
            maePrice: entryPrice,
            maeBarIndex: i,
            trailingStopPrice: null,
            trailingActivated: false,
            partialExitDone: false,
            partialExitPrice: null,
            partialExitShares: 0,
            partialPnl: 0,
            stopMovedToBE: false,
            rsAtEntry: signal.rsValue,
          };

          totalSlippageCosts += entryTrace.slippageBps;
          log(
            `[RSSim] ${ticker} ENTRY LONG at $${entryPrice.toFixed(2)} | stop=$${stopLevel.toFixed(2)} | target=${rsConfig.noTarget ? "NONE" : targetPrice.toFixed(2)} | ${shares}sh | RS=${signal.rsValue.toFixed(4)} slope=${signal.rsSlope.toFixed(4)} | ${signal.reasons.join("; ")}`,
            "historical",
          );
          }
        }

        processedBars++;
      }

      if (activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side: "long",
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        closeRSTrade(activeTrade, eodTrace.finalPrice, "End of day close", ticker, lastBar.timestamp,
          tickerBars5m[activeTrade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          tickerBars5m.length * 5, null, calculateATR(bars5mAccum, 14));
        activeTrade = null;
      }
    }

    let maxDD = 0;
    let peak = 0;
    let equity = 0;
    for (const r of tradeNetPnls) {
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    if (isDryRun) {
      return {
        trades: tradesGenerated,
        wins: winCount,
        losses: lossCount,
        grossPnl: Number(grossPnlTotal.toFixed(2)),
        netPnl: Number(totalPnl.toFixed(2)),
        totalCommissions: Number(totalCommissions.toFixed(2)),
        totalSlippageCosts: Number(totalSlippageCosts.toFixed(2)),
        tradeRs,
        tradeMFEs: tradeMFEs.length > 0 ? tradeMFEs : undefined,
        tradeMAEs: tradeMAEs.length > 0 ? tradeMAEs : undefined,
        tradeHit1R: tradeHit1R.length > 0 ? tradeHit1R : undefined,
        tradeHitTarget: tradeHitTarget.length > 0 ? tradeHitTarget : undefined,
        tradeSlippageCostsR: tradeSlippageCostsR.length > 0 ? tradeSlippageCostsR : undefined,
        tradeScratchAfterPartial: tradeScratchAfterPartial.length > 0 ? tradeScratchAfterPartial : undefined,
        tradeLossBuckets: tradeLossBuckets.length > 0 ? tradeLossBuckets : undefined,
        tradeTickers: tradeTickers.length > 0 ? tradeTickers : undefined,
        tradeRegimes: tradeRegimes.length > 0 ? tradeRegimes : undefined,
        maxDrawdown: Number(maxDD.toFixed(2)),
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      };
    }

    log(
      `[RSSim] ${simulationDate} COMPLETE: ${tradesGenerated} trades, ${winCount}W/${lossCount}L, PnL=$${totalPnl.toFixed(2)}, MaxDD=$${maxDD.toFixed(2)}`,
      "historical",
    );
  } catch (error: any) {
    log(`[RSSim] Error: ${error.message}`, "historical");
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

// ============================================================
// Gap Continuation (Overnight Gap + OR Breakout) Simulation
// ============================================================

interface GapTradeState {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  shares: number;
  originalShares: number;
  entryBarIndex: number;
  dollarRisk: number;
  riskPerShare: number;
  pendingExit: { reason: string; exitType: string; decisionBarIndex: number } | null;
  mfeR: number;
  mfePrice: number;
  mfeBarIndex: number;
  maeR: number;
  maePrice: number;
  maeBarIndex: number;
  trailingStopPrice: number | null;
  trailingActivated: boolean;
  gapPct: number;
  orHigh: number;
  orLow: number;
}

const GAP_TICKERS = [
  "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","AVGO",
  "JPM","COST","QQQ","CRM","ORCL",
];

export async function runGapContinuationSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList?: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    gapConfig?: Partial<GapConfig>;
    variantB?: boolean;
    forwardDailyBars?: Map<string, Array<{open: number; high: number; low: number; close: number; volume: number; timestamp: number}>>;
  },
): Promise<DryRunResult | void> {
  const tickers = tickerList ?? GAP_TICKERS;
  const allSymbols = Array.from(new Set([...tickers, "SPY"]));
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;
  const gapConfig: GapConfig = { ...DEFAULT_GAP_CONFIG, ...(options?.gapConfig ?? {}) };

  const control = { cancel: false };
  if (!isDryRun) {
    activeSimulations.set(runId, control);
  }

  try {
    if (!isDryRun) {
      await storage.updateSimulationRun(runId, { status: "running", tickers });
    }

    if (!isAlpacaConfigured()) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: "Alpaca API keys not configured.",
          completedAt: new Date(),
        });
      }
      return;
    }

    const bars5mMap = await fetchBarsForDate(allSymbols, simulationDate, "5Min");
    const multiDayBars = await fetchMultiDayDailyBars(allSymbols, simulationDate, 20);

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data for ${simulationDate}.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    const user = await storage.getUser(userId);
    if (!user) return;
    const accountSize = user.accountSize ?? 100000;

    let processedBars = 0;
    let tradesGenerated = 0;
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossPnlTotal = 0;
    let totalCommissions = 0;
    let totalSlippageCosts = 0;
    const tradeRs: number[] = [];
    const tradeMFEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
    const tradeMAEs: number[] = [];
    const tradeSlippageCostsR: number[] = [];
    const tradeScratchAfterPartial: number[] = [];
    const tradeLossBuckets: string[] = [];
    const tradeTickers: string[] = [];
    const tradeRegimes: string[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};

    const closeGapTrade = (
      trade: GapTradeState,
      exitPrice: number,
      exitReason: string,
      ticker: string,
      barTimestamp: number,
      entryTimestamp: number,
      minutesSinceOpen: number,
      regimeResult: any,
      atr14: number,
    ) => {
      const shares = trade.shares;
      const riskPerShare = trade.riskPerShare;
      const grossPnl = trade.direction === "LONG"
        ? (exitPrice - trade.entryPrice) * shares
        : (trade.entryPrice - exitPrice) * shares;
      const commission = calculateCommission(trade.originalShares, costOverrides) * 2;
      const pnl = grossPnl - commission;

      const compositeR = riskPerShare > 0
        ? (trade.direction === "LONG"
          ? (exitPrice - trade.entryPrice) / riskPerShare
          : (trade.entryPrice - exitPrice) / riskPerShare)
        : 0;

      totalPnl += pnl;
      if (pnl > 0) winCount++; else lossCount++;
      grossPnlTotal += grossPnl;
      totalCommissions += commission;
      tradeRs.push(compositeR);
      tradeGrossPnls.push(grossPnl);
      tradeNetPnls.push(pnl);

      tradeMFEs.push(trade.mfeR);
      tradeMAEs.push(trade.maeR);
      tradeHit1R.push(trade.mfeR >= 1.0 ? 1 : 0);
      tradeHitTarget.push(trade.mfeR >= 2.0 ? 1 : 0);

      let lossBucket = "other";
      if (compositeR < 0) {
        if (trade.mfeR < 0.3) {
          lossBucket = "stopped_before_0.3R";
        } else if (trade.mfeR >= 0.3) {
          lossBucket = "reversed_after_0.3R";
        }
      }

      const frictionCostR = riskPerShare > 0 && trade.originalShares > 0 ? (commission / (riskPerShare * trade.originalShares)) : 0;
      tradeSlippageCostsR.push(frictionCostR);
      tradeScratchAfterPartial.push(0);

      const tierName = trade.direction === "LONG" ? "gap_long" : "gap_short";
      tradeTickers.push(ticker);
      tradeLossBuckets.push(lossBucket);
      const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
      const trRegime = regimeResult?.aligned ? "trending" : regimeResult?.chopping ? "choppy" : "neutral";
      tradeRegimes.push(trRegime);
      if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesByTier[tierName]) tradesByTier[tierName] = { wins: 0, losses: 0, pnl: 0 };
      tradesByRegime[trRegime].pnl += pnl;
      tradesBySession[trSession].pnl += pnl;
      tradesByTier[tierName].pnl += pnl;
      if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier[tierName].wins++; }
      else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier[tierName].losses++; }

      addTrade(buildAnalyticsRecord(
        { entryPrice: trade.entryPrice, stopPrice: trade.originalStopPrice, shares: trade.originalShares, tier: tierName, direction: trade.direction, entryBarIndex: trade.entryBarIndex },
        ticker, exitPrice, exitReason,
        barTimestamp,
        entryTimestamp,
        compositeR, pnl,
        { marketRegime: trRegime, session: trSession, spyAligned: regimeResult?.aligned, entryMode: "gap_continuation" },
      ));

      tradesGenerated++;
      log(`[GapSim] ${ticker} CLOSED ${trade.direction}: ${exitReason} | R=${compositeR.toFixed(2)} PnL=$${pnl.toFixed(2)} gap=${(trade.gapPct * 100).toFixed(2)}%`, "historical");
    };

    for (const ticker of tickers) {
      if (control.cancel) break;

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 10) {
        processedBars += tickerBars5m.length;
        continue;
      }

      const priorClose = dailyHistory.length > 0 ? dailyHistory[dailyHistory.length - 1].close : 0;
      if (priorClose <= 0) {
        processedBars += tickerBars5m.length;
        log(`[GapSim] ${ticker} skipped - no prior day close`, "historical");
        continue;
      }

      const todayOpen = tickerBars5m[0].open;
      const gapSignal = detectGap(priorClose, todayOpen, gapConfig);
      if (!gapSignal.hasGap || !gapSignal.direction) {
        processedBars += tickerBars5m.length;
        continue;
      }

      const todayFirstVolume = tickerBars5m[0].volume;
      const avgFirstVolumes = dailyHistory.length > 1
        ? dailyHistory.slice(0, -1).reduce((s: number, d: any) => s + (d.volume || 0), 0) / (dailyHistory.length - 1)
        : 0;
      const rvolResult = checkRVOL(todayFirstVolume, avgFirstVolumes > 0 ? avgFirstVolumes / 78 : 0, gapConfig.minRvol);
      if (!rvolResult.passed) {
        processedBars += tickerBars5m.length;
        log(`[GapSim] ${ticker} skipped - RVOL ${rvolResult.rvol.toFixed(2)} < ${gapConfig.minRvol}`, "historical");
        continue;
      }

      const openingRange = buildGapOpeningRange(tickerBars5m, gapConfig.orMinutes);
      if (!openingRange.completed || openingRange.barsUsed < 6) {
        processedBars += tickerBars5m.length;
        log(`[GapSim] ${ticker} skipped - OR not completed (${openingRange.barsUsed} bars)`, "historical");
        continue;
      }

      const orRangePct = openingRange.range / todayOpen;
      if (orRangePct > 0.03 || orRangePct < 0.001) {
        processedBars += tickerBars5m.length;
        log(`[GapSim] ${ticker} skipped - OR range ${(orRangePct * 100).toFixed(2)}% out of bounds`, "historical");
        continue;
      }

      const bars5mAccum: Candle[] = [];
      let activeTrade: GapTradeState | null = null;
      let tickerTradeCount = 0;

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        bars5mAccum.push(bar);
        if (bars5mAccum.length > 200) bars5mAccum.shift();

        const minutesSinceOpen = (i + 1) * 5;
        const atr14 = calculateATR(bars5mAccum, 14);

        const spyBarsToNow = spyBars5m.filter((b: Candle) => b.timestamp <= bar.timestamp);
        const regimeResult = checkMarketRegime(spyBarsToNow.slice(-40), DEFAULT_STRATEGY_CONFIG.marketRegime);

        if (activeTrade) {
          const trade = activeTrade;
          const riskPerShare = trade.riskPerShare;
          const side: Side = trade.direction === "LONG" ? "long" : "short";

          if (riskPerShare > 0) {
            let barMfeR: number;
            let barMaeR: number;
            if (trade.direction === "LONG") {
              barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
              barMaeR = (bar.low - trade.entryPrice) / riskPerShare;
            } else {
              barMfeR = (trade.entryPrice - bar.low) / riskPerShare;
              barMaeR = (trade.entryPrice - bar.high) / riskPerShare;
            }

            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = trade.direction === "LONG" ? bar.high : bar.low;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = trade.direction === "LONG" ? bar.low : bar.high;
              trade.maeBarIndex = i;
            }

            if (!trade.trailingActivated && trade.mfeR >= 1.5) {
              trade.trailingActivated = true;
              if (trade.direction === "LONG") {
                trade.trailingStopPrice = bar.high - riskPerShare * 0.5;
              } else {
                trade.trailingStopPrice = bar.low + riskPerShare * 0.5;
              }
            }

            if (trade.trailingActivated && trade.trailingStopPrice !== null) {
              if (trade.direction === "LONG") {
                const newTrail = bar.high - riskPerShare * 0.5;
                if (newTrail > trade.trailingStopPrice) {
                  trade.trailingStopPrice = newTrail;
                }
                trade.stopPrice = Math.max(trade.stopPrice, trade.trailingStopPrice);
              } else {
                const newTrail = bar.low + riskPerShare * 0.5;
                if (newTrail < trade.trailingStopPrice) {
                  trade.trailingStopPrice = newTrail;
                }
                trade.stopPrice = Math.min(trade.stopPrice, trade.trailingStopPrice);
              }
            }
          }

          if (trade.pendingExit) {
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: bar.open,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeGapTrade(trade, exitTrace.finalPrice, trade.pendingExit.reason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            processedBars++;
            continue;
          }

          let shouldExit = false;
          let exitReason = "";

          if (trade.direction === "LONG") {
            if (bar.low <= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open <= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.trailingActivated ? " (trailing)" : ""}`;
            }
          } else {
            if (bar.high >= trade.stopPrice) {
              shouldExit = true;
              exitReason = bar.open >= trade.stopPrice
                ? `Gap-through stop at $${bar.open.toFixed(2)}`
                : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.trailingActivated ? " (trailing)" : ""}`;
            }
          }

          if (!shouldExit && minutesSinceOpen >= gapConfig.timeExitMinutes) {
            trade.pendingExit = {
              reason: `Time exit at ${minutesSinceOpen}min`,
              exitType: "time_stop",
              decisionBarIndex: i,
            };
            processedBars++;
            continue;
          }

          if (shouldExit) {
            let rawFill: number;
            if (trade.direction === "LONG") {
              rawFill = bar.open <= trade.stopPrice ? bar.open : trade.stopPrice;
            } else {
              rawFill = bar.open >= trade.stopPrice ? bar.open : trade.stopPrice;
            }

            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeGapTrade(trade, exitTrace.finalPrice, exitReason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
          }

          processedBars++;
          continue;
        }

        if (i < openingRange.barsUsed || tickerTradeCount >= gapConfig.maxTradesPerTicker) {
          processedBars++;
          continue;
        }

        const breakout = detectORBreakout(bar, openingRange, gapSignal.direction!);
        if (breakout.triggered) {
          tickerTradeCount++;

          const direction = gapSignal.direction!;
          const side: Side = direction === "LONG" ? "long" : "short";
          const breakoutPrice = breakout.breakoutPrice;
          const stopLevel = direction === "LONG" ? openingRange.low : openingRange.high;

          const entryTrace = applyFrictionAndRoundWithTrace({
            rawPrice: breakoutPrice,
            side,
            direction: "entry",
            atr14,
            costOverrides,
          });
          const entryPrice = entryTrace.finalPrice;
          const riskPerShare = Math.abs(entryPrice - stopLevel);

          if (riskPerShare <= 0 || riskPerShare > entryPrice * 0.03) {
            processedBars++;
            continue;
          }

          const dollarRisk = accountSize * gapConfig.riskPct;
          const shares = Math.max(1, Math.floor(dollarRisk / riskPerShare));

          activeTrade = {
            direction,
            entryPrice,
            stopPrice: stopLevel,
            originalStopPrice: stopLevel,
            shares,
            originalShares: shares,
            entryBarIndex: i,
            dollarRisk,
            riskPerShare,
            pendingExit: null,
            mfeR: 0,
            mfePrice: entryPrice,
            mfeBarIndex: i,
            maeR: 0,
            maePrice: entryPrice,
            maeBarIndex: i,
            trailingStopPrice: null,
            trailingActivated: false,
            gapPct: gapSignal.gapPct,
            orHigh: openingRange.high,
            orLow: openingRange.low,
          };

          totalSlippageCosts += entryTrace.slippageBps;
          log(
            `[GapSim] ${ticker} ENTRY ${direction} at $${entryPrice.toFixed(2)} | stop=$${stopLevel.toFixed(2)} | ${shares}sh | gap=${(gapSignal.gapPct * 100).toFixed(2)}% RVOL=${rvolResult.rvol.toFixed(2)} OR=[${openingRange.low.toFixed(2)}-${openingRange.high.toFixed(2)}]`,
            "historical",
          );
        }

        processedBars++;
      }

      if (activeTrade && !options?.variantB) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const side: Side = activeTrade.direction === "LONG" ? "long" : "short";
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side,
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        closeGapTrade(activeTrade, eodTrace.finalPrice, "End of day close", ticker, lastBar.timestamp,
          tickerBars5m[activeTrade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          tickerBars5m.length * 5, null, calculateATR(bars5mAccum, 14));
        activeTrade = null;
      }

      if (activeTrade && options?.variantB && options.forwardDailyBars) {
        const forwardBars = options.forwardDailyBars.get(ticker) ?? [];
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const trade = activeTrade;
        const side: Side = trade.direction === "LONG" ? "long" : "short";
        const atr14 = calculateATR(bars5mAccum, 14);
        let priorDayLow = lastBar.low;
        let priorDayHigh = lastBar.high;
        let exitedMultiDay = false;

        const maxDays = Math.min(gapConfig.variantB_maxHoldDays, forwardBars.length);
        for (let d = 0; d < maxDays; d++) {
          const dailyBar = forwardBars[d];
          const riskPerShare = trade.riskPerShare;

          if (riskPerShare > 0) {
            let dayMfeR: number;
            let dayMaeR: number;
            if (trade.direction === "LONG") {
              dayMfeR = (dailyBar.high - trade.entryPrice) / riskPerShare;
              dayMaeR = (dailyBar.low - trade.entryPrice) / riskPerShare;
            } else {
              dayMfeR = (trade.entryPrice - dailyBar.low) / riskPerShare;
              dayMaeR = (trade.entryPrice - dailyBar.high) / riskPerShare;
            }

            if (dayMfeR > trade.mfeR) {
              trade.mfeR = dayMfeR;
              trade.mfePrice = trade.direction === "LONG" ? dailyBar.high : dailyBar.low;
              trade.mfeBarIndex = tickerBars5m.length + d;
            }
            if (dayMaeR < trade.maeR) {
              trade.maeR = dayMaeR;
              trade.maePrice = trade.direction === "LONG" ? dailyBar.low : dailyBar.high;
              trade.maeBarIndex = tickerBars5m.length + d;
            }
          }

          let shouldExitMultiDay = false;
          if (trade.direction === "LONG" && dailyBar.close < priorDayLow) {
            shouldExitMultiDay = true;
          }
          if (trade.direction === "SHORT" && dailyBar.close > priorDayHigh) {
            shouldExitMultiDay = true;
          }

          if (shouldExitMultiDay || d === maxDays - 1) {
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: dailyBar.close,
              side,
              direction: "exit",
              atr14,
              costOverrides,
            });
            const exitReason = shouldExitMultiDay
              ? `Multi-day exit: close ${trade.direction === "LONG" ? "below prior low" : "above prior high"} day ${d + 1}`
              : `Multi-day max hold (${maxDays} days)`;
            const spyBarsToNow = spyBars5m.slice(-40);
            const regimeResult = checkMarketRegime(spyBarsToNow, DEFAULT_STRATEGY_CONFIG.marketRegime);
            closeGapTrade(trade, exitTrace.finalPrice, exitReason, ticker, dailyBar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? dailyBar.timestamp,
              tickerBars5m.length * 5 + (d + 1) * 390, regimeResult, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            exitedMultiDay = true;
            break;
          }

          priorDayLow = dailyBar.low;
          priorDayHigh = dailyBar.high;
        }

        if (!exitedMultiDay) {
          const lastDailyBar = forwardBars.length > 0 ? forwardBars[forwardBars.length - 1] : lastBar;
          const exitTrace = applyFrictionAndRoundWithTrace({
            rawPrice: lastDailyBar.close,
            side,
            direction: "exit",
            atr14,
            costOverrides,
          });
          const spyBarsToNow = spyBars5m.slice(-40);
          const regimeResult = checkMarketRegime(spyBarsToNow, DEFAULT_STRATEGY_CONFIG.marketRegime);
          closeGapTrade(trade, exitTrace.finalPrice, "Variant B: no forward bars remaining", ticker, lastDailyBar.timestamp,
            tickerBars5m[trade.entryBarIndex]?.timestamp ?? lastDailyBar.timestamp,
            tickerBars5m.length * 5, regimeResult, atr14);
          totalSlippageCosts += exitTrace.slippageBps;
        }

        activeTrade = null;
      }

      if (activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const side: Side = activeTrade.direction === "LONG" ? "long" : "short";
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side,
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        closeGapTrade(activeTrade, eodTrace.finalPrice, "End of day close (fallback)", ticker, lastBar.timestamp,
          tickerBars5m[activeTrade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          tickerBars5m.length * 5, null, calculateATR(bars5mAccum, 14));
        activeTrade = null;
      }
    }

    let maxDD = 0;
    let peak = 0;
    let equity = 0;
    for (const r of tradeNetPnls) {
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    if (isDryRun) {
      return {
        trades: tradesGenerated,
        wins: winCount,
        losses: lossCount,
        grossPnl: Number(grossPnlTotal.toFixed(2)),
        netPnl: Number(totalPnl.toFixed(2)),
        totalCommissions: Number(totalCommissions.toFixed(2)),
        totalSlippageCosts: Number(totalSlippageCosts.toFixed(2)),
        tradeRs,
        tradeMFEs: tradeMFEs.length > 0 ? tradeMFEs : undefined,
        tradeMAEs: tradeMAEs.length > 0 ? tradeMAEs : undefined,
        tradeHit1R: tradeHit1R.length > 0 ? tradeHit1R : undefined,
        tradeHitTarget: tradeHitTarget.length > 0 ? tradeHitTarget : undefined,
        tradeSlippageCostsR: tradeSlippageCostsR.length > 0 ? tradeSlippageCostsR : undefined,
        tradeScratchAfterPartial: tradeScratchAfterPartial.length > 0 ? tradeScratchAfterPartial : undefined,
        tradeLossBuckets: tradeLossBuckets.length > 0 ? tradeLossBuckets : undefined,
        tradeTickers: tradeTickers.length > 0 ? tradeTickers : undefined,
        tradeRegimes: tradeRegimes.length > 0 ? tradeRegimes : undefined,
        maxDrawdown: Number(maxDD.toFixed(2)),
        byRegime: tradesByRegime,
        bySession: tradesBySession,
        byTier: tradesByTier,
      };
    }

    log(
      `[GapSim] ${simulationDate} COMPLETE: ${tradesGenerated} trades, ${winCount}W/${lossCount}L, PnL=$${totalPnl.toFixed(2)}, MaxDD=$${maxDD.toFixed(2)}`,
      "historical",
    );
  } catch (error: any) {
    log(`[GapSim] Error: ${error.message}`, "historical");
    if (isDryRun) {
      throw error;
    }
    await storage.updateSimulationRun(runId, {
      status: "failed",
      errorMessage: error.message,
      completedAt: new Date(),
    });
  } finally {
    if (!isDryRun) {
      activeSimulations.delete(runId);
    }
  }
}

// ===== SMALL-CAP MOMENTUM: FIRST PULLBACK AFTER HOD BREAK =====

interface SmallCapTradeState {
  direction: "LONG";
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  shares: number;
  originalShares: number;
  entryBarIndex: number;
  dollarRisk: number;
  riskPerShare: number;
  mfeR: number;
  mfePrice: number;
  mfeBarIndex: number;
  maeR: number;
  maePrice: number;
  maeBarIndex: number;
  partialFilled: boolean;
  partialShares: number;
  partialR: number;
  trailingActivated: boolean;
  trailingStopPrice: number | null;
  pendingExit: { reason: string; exitType: string; decisionBarIndex: number } | null;
  pullbackSignal: PullbackSignal;
}

export interface SmallCapGapperEvent {
  ticker: string;
  date: string;
  priorClose?: number;
  floatShares?: number;
  premarketVolume?: number;
  catalyst?: string;
}

export type BarsCache = Map<string, { bars5m: Map<string, Candle[]>; multiDay: Map<string, any[]> }>;

export async function runSmallCapMomentumSimulation(
  runId: string,
  simulationDate: string,
  userId: string,
  storage: IStorage,
  tickerList: string[],
  options?: {
    costOverrides?: CostOverrides;
    dryRun?: boolean;
    smallCapConfig?: Partial<SmallCapConfig>;
    pullbackConfig?: Partial<PullbackConfig>;
    floatData?: Record<string, number>;
    premarketVolData?: Record<string, number>;
    useDynamicScanner?: boolean;
    gapScanConfig?: Partial<import("./strategy/dynamicGapScanner").GapScanConfig>;
    barsCache?: BarsCache;
  },
): Promise<DryRunResult | void> {
  const isDryRun = options?.dryRun ?? false;
  const costOverrides = options?.costOverrides;
  const scConfig: SmallCapConfig = { ...DEFAULT_SMALLCAP_CONFIG, ...(options?.smallCapConfig ?? {}) };
  const pbConfig: PullbackConfig = { ...DEFAULT_PULLBACK_CONFIG, ...(options?.pullbackConfig ?? {}) };
  const floatData = options?.floatData ?? {};
  const premarketVolData = options?.premarketVolData ?? {};
  const useDynamicScanner = options?.useDynamicScanner ?? false;

  resetTradeLog();

  const control = { cancel: false };
  if (!isDryRun) {
    activeSimulations.set(runId, control);
  }

  try {
    if (!isAlpacaConfigured()) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: "Alpaca API keys not configured.",
          completedAt: new Date(),
        });
      }
      return;
    }

    let effectiveTickerList = tickerList;
    let dynamicScanStats: DryRunResult["dynamicScannerStats"] | undefined;

    if (useDynamicScanner) {
      const { scanForGappersOnDate } = await import("./strategy/dynamicGapScanner");
      const gapScanCfg = options?.gapScanConfig ?? {};
      if (scConfig.minPrice) gapScanCfg.minPrice = gapScanCfg.minPrice ?? scConfig.minPrice;
      if (scConfig.maxPrice) gapScanCfg.maxPrice = gapScanCfg.maxPrice ?? scConfig.maxPrice;
      if (scConfig.minGapPct) gapScanCfg.minGapPct = gapScanCfg.minGapPct ?? scConfig.minGapPct;

      const scanResult = await scanForGappersOnDate(simulationDate, gapScanCfg);
      effectiveTickerList = scanResult.qualifiers
        .filter(q => q.gapDirection === "LONG")
        .map(q => q.ticker);

      dynamicScanStats = {
        scannedCount: scanResult.scannedCount,
        dataReturnedCount: scanResult.dataReturnedCount,
        qualifiedCount: scanResult.qualifiedCount,
        longCount: effectiveTickerList.length,
        scanTimeMs: scanResult.scanTimeMs,
      };

      log(`[SmallCapSim] ${simulationDate}: dynamic scanner found ${scanResult.qualifiedCount} gappers, ${effectiveTickerList.length} LONG qualifiers`, "historical");

      if (effectiveTickerList.length === 0) {
        log(`[SmallCapSim] ${simulationDate}: no LONG gappers found, skipping day`, "historical");
        if (isDryRun) {
          return {
            trades: 0,
            wins: 0,
            losses: 0,
            grossPnl: 0,
            netPnl: 0,
            totalCommissions: 0,
            totalSlippageCosts: 0,
            tradeRs: [],
            maxDrawdown: 0,
            byRegime: {},
            bySession: {},
            byTier: {},
            qualifications: [],
            spreadRejects: 0,
            dynamicScannerStats: {
              scannedCount: scanResult.scannedCount,
              dataReturnedCount: scanResult.dataReturnedCount,
              qualifiedCount: scanResult.qualifiedCount,
              longCount: 0,
              scanTimeMs: scanResult.scanTimeMs,
            },
          };
        }
        return;
      }
    }

    const allSymbols = Array.from(new Set([...effectiveTickerList, "SPY"]));
    const barsCache = options?.barsCache;
    const bars5mMap = new Map<string, Candle[]>();
    const multiDayBars = new Map<string, any[]>();

    const cached = barsCache?.get(simulationDate);
    const missingSymbols: string[] = [];
    if (cached) {
      allSymbols.forEach(sym => {
        const b5 = cached.bars5m.get(sym);
        if (b5) bars5mMap.set(sym, b5);
        const md = cached.multiDay.get(sym);
        if (md) multiDayBars.set(sym, md);
        if (!b5 && !md) missingSymbols.push(sym);
      });
    }

    if (!cached || missingSymbols.length > 0) {
      const symbolsToFetch = cached ? missingSymbols : allSymbols;
      if (symbolsToFetch.length > 0) {
        const CHUNK_SIZE = 30;
        const chunks: string[][] = [];
        for (let i = 0; i < symbolsToFetch.length; i += CHUNK_SIZE) {
          chunks.push(symbolsToFetch.slice(i, i + CHUNK_SIZE));
        }
        for (const chunk of chunks) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const [chunkBars, chunkDaily] = await Promise.all([
                fetchBarsForDate(chunk, simulationDate, "5Min"),
                fetchMultiDayDailyBars(chunk, simulationDate, 20),
              ]);
              chunkBars.forEach((bars, sym) => bars5mMap.set(sym, bars));
              chunkDaily.forEach((bars, sym) => multiDayBars.set(sym, bars));
              break;
            } catch (e: any) {
              log(`[SmallCapSim] Chunk fetch failed (attempt ${attempt + 1}): ${e.message}`, "historical");
              if (attempt === 1) log(`[SmallCapSim] Skipping chunk: ${chunk.join(",")}`, "historical");
            }
          }
        }
        if (barsCache) {
          if (!cached) {
            barsCache.set(simulationDate, { bars5m: new Map(bars5mMap), multiDay: new Map(multiDayBars) });
          } else {
            bars5mMap.forEach((bars, sym) => cached.bars5m.set(sym, bars));
            multiDayBars.forEach((bars, sym) => cached.multiDay.set(sym, bars));
          }
        }
        log(`[SmallCapSim] ${simulationDate}: fetched ${symbolsToFetch.length} symbols (${cached ? 'incremental' : 'full'}), total 5m: ${bars5mMap.size}/${allSymbols.length}`, "historical");
      } else {
        log(`[SmallCapSim] ${simulationDate}: all ${allSymbols.length} symbols from cache`, "historical");
      }
    }

    const spyBars5m = bars5mMap.get("SPY") ?? [];
    if (spyBars5m.length === 0) {
      if (!isDryRun) {
        await storage.updateSimulationRun(runId, {
          status: "failed",
          errorMessage: `No SPY data for ${simulationDate}.`,
          completedAt: new Date(),
        });
      }
      return;
    }

    let accountSize = 100000;
    try {
      const user = await storage.getUser(userId);
      if (user) accountSize = user.accountSize ?? 100000;
    } catch {}

    let tradesGenerated = 0;
    let totalPnl = 0;
    let winCount = 0;
    let lossCount = 0;
    let grossPnlTotal = 0;
    let totalCommissions = 0;
    let totalSlippageCosts = 0;
    const tradeRs: number[] = [];
    const tradeMFEs: number[] = [];
    const tradeMAEs: number[] = [];
    const tradeHit1R: number[] = [];
    const tradeHitTarget: number[] = [];
    const tradeSlippageCostsR: number[] = [];
    const tradeScratchAfterPartial: number[] = [];
    const tradeLossBuckets: string[] = [];
    const tradeTickers: string[] = [];
    const tradeGapPcts: number[] = [];
    const tradeRegimes: string[] = [];
    const tradeGrossPnls: number[] = [];
    const tradeNetPnls: number[] = [];
    const tradesByRegime: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesBySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const tradesByTier: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const qualifications: SmallCapQualification[] = [];
    let spreadRejects = 0;

    const closeSmallCapTrade = (
      trade: SmallCapTradeState,
      exitPrice: number,
      exitReason: string,
      ticker: string,
      barTimestamp: number,
      entryTimestamp: number,
      minutesSinceOpen: number,
      atr14: number,
    ) => {
      const shares = trade.shares;
      const riskPerShare = trade.riskPerShare;

      const grossPnl = (exitPrice - trade.entryPrice) * shares;
      const commission = calculateCommission(trade.originalShares, costOverrides) * 2;
      const partialGrossPnl = trade.partialFilled
        ? (trade.partialR * riskPerShare) * trade.partialShares
        : 0;
      const totalGrossPnl = grossPnl + partialGrossPnl;
      const pnl = totalGrossPnl - commission;

      const remainingR = riskPerShare > 0
        ? (exitPrice - trade.entryPrice) / riskPerShare
        : 0;
      const compositeR = riskPerShare > 0 && trade.originalShares > 0
        ? ((trade.partialFilled ? trade.partialR * trade.partialShares : 0) + remainingR * shares) / trade.originalShares
        : 0;

      totalPnl += pnl;
      if (pnl > 0) winCount++; else lossCount++;
      grossPnlTotal += totalGrossPnl;
      totalCommissions += commission;
      tradeRs.push(compositeR);
      tradeGrossPnls.push(totalGrossPnl);
      tradeNetPnls.push(pnl);

      tradeMFEs.push(trade.mfeR);
      tradeMAEs.push(trade.maeR);
      tradeHit1R.push(trade.mfeR >= 1.0 ? 1 : 0);
      tradeHitTarget.push(trade.mfeR >= scConfig.partialExitR ? 1 : 0);

      let lossBucket = "winner";
      if (compositeR < 0) {
        if (trade.mfeR < 0.3) {
          lossBucket = "stopped_before_0.3R";
        } else if (trade.mfeR >= 0.3 && trade.mfeR < 1.0) {
          lossBucket = "reversed_after_0.3R";
        } else if (trade.partialFilled && compositeR < 0) {
          lossBucket = "partial_then_scratch";
        } else {
          lossBucket = "other_loss";
        }
      }

      const frictionCostR = riskPerShare > 0 && trade.originalShares > 0 ? (commission / (riskPerShare * trade.originalShares)) : 0;
      tradeSlippageCostsR.push(frictionCostR);
      tradeScratchAfterPartial.push(trade.partialFilled && compositeR < 0.1 ? 1 : 0);

      tradeTickers.push(ticker);
      const tickerQual = qualifications.find(q => q.ticker === ticker);
      tradeGapPcts.push(tickerQual ? Math.abs(tickerQual.gapPct) : 0);
      tradeLossBuckets.push(lossBucket);
      const trSession = minutesSinceOpen <= 90 ? "open" : minutesSinceOpen <= 240 ? "mid" : "power";
      const trRegime = "smallcap";
      tradeRegimes.push(trRegime);
      const tierName = "pullback_long";
      if (!tradesByRegime[trRegime]) tradesByRegime[trRegime] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesBySession[trSession]) tradesBySession[trSession] = { wins: 0, losses: 0, pnl: 0 };
      if (!tradesByTier[tierName]) tradesByTier[tierName] = { wins: 0, losses: 0, pnl: 0 };
      tradesByRegime[trRegime].pnl += pnl;
      tradesBySession[trSession].pnl += pnl;
      tradesByTier[tierName].pnl += pnl;
      if (pnl > 0) { tradesByRegime[trRegime].wins++; tradesBySession[trSession].wins++; tradesByTier[tierName].wins++; }
      else { tradesByRegime[trRegime].losses++; tradesBySession[trSession].losses++; tradesByTier[tierName].losses++; }

      tradesGenerated++;
      log(`[SmallCapSim] ${ticker} CLOSED: ${exitReason} | R=${compositeR.toFixed(2)} MFE=${trade.mfeR.toFixed(2)}R PnL=$${pnl.toFixed(2)}${trade.partialFilled ? " (partial filled)" : ""}`, "historical");

      logTradeExit({
        id: `${ticker}-${simulationDate}-sc-${trade.entryBarIndex}`,
        symbol: ticker,
        exitTimestamp: barTimestamp,
        exitPrice,
        exitReason,
        rMultiple: compositeR,
        pnlDollars: pnl,
        mfeR: trade.mfeR,
        maeR: trade.maeR,
        isPartiallyExited: trade.partialFilled,
        partialExitPrice: trade.partialFilled ? trade.entryPrice + trade.partialR * trade.riskPerShare : undefined,
        partialShares: trade.partialFilled ? trade.partialShares : undefined,
      });
    };

    for (const ticker of effectiveTickerList) {
      if (control.cancel) break;

      const tickerBars5m = bars5mMap.get(ticker) ?? [];
      const dailyHistory = multiDayBars.get(ticker) ?? [];

      if (tickerBars5m.length < 10) continue;

      const priorClose = dailyHistory.length > 0 ? dailyHistory[dailyHistory.length - 1].close : 0;
      if (priorClose <= 0) continue;

      const todayOpen = tickerBars5m[0].open;
      const atr14Daily = computeATRFromDailyBars(dailyHistory, 14);
      const avgDailyVol = computeAvgDailyVolume(dailyHistory, 20);
      const premarketVol = premarketVolData[ticker] ?? tickerBars5m[0].volume * 3;
      const floatShares = floatData[ticker] ?? 0;

      const qual = qualifySmallCapGapper(
        ticker, priorClose, todayOpen, atr14Daily,
        premarketVol, avgDailyVol, floatShares, scConfig,
      );
      qualifications.push(qual);

      if (!qual.passed) {
        log(`[SmallCapSim] ${ticker} REJECTED: ${qual.rejectReason}`, "historical");
        continue;
      }

      if (qual.gapDirection !== "LONG") {
        log(`[SmallCapSim] ${ticker} skipped - SHORT gap (long-only strategy)`, "historical");
        continue;
      }

      log(`[SmallCapSim] ${ticker} QUALIFIED: gap=${(qual.gapPct * 100).toFixed(1)}% ATR%=${(qual.atrPct * 100).toFixed(1)}% preVol=${premarketVol.toLocaleString()}`, "historical");

      let hodState = initHODState();
      hodState.hodPrice = todayOpen;
      hodState.hodBarIndex = 0;

      let activeTrade: SmallCapTradeState | null = null;
      let tickerTradeCount = 0;
      const bars5mAccum: Candle[] = [];

      for (let i = 0; i < tickerBars5m.length; i++) {
        if (control.cancel) break;

        const bar = tickerBars5m[i];
        bars5mAccum.push(bar);
        if (bars5mAccum.length > 200) bars5mAccum.shift();

        const minutesSinceOpen = (i + 1) * 5;
        const atr14 = calculateATR(bars5mAccum, 14);

        if (activeTrade) {
          const trade = activeTrade;
          const riskPerShare = trade.riskPerShare;

          if (riskPerShare > 0) {
            const barMfeR = (bar.high - trade.entryPrice) / riskPerShare;
            const barMaeR = (bar.low - trade.entryPrice) / riskPerShare;

            if (barMfeR > trade.mfeR) {
              trade.mfeR = barMfeR;
              trade.mfePrice = bar.high;
              trade.mfeBarIndex = i;
            }
            if (barMaeR < trade.maeR) {
              trade.maeR = barMaeR;
              trade.maePrice = bar.low;
              trade.maeBarIndex = i;
            }

            if (!trade.partialFilled && trade.mfeR >= scConfig.partialExitR) {
              const partialShares = Math.floor(trade.originalShares * scConfig.partialExitPct);
              if (partialShares > 0) {
                const partialPrice = trade.entryPrice + riskPerShare * scConfig.partialExitR;
                const partialTrace = applyFrictionAndRoundWithTrace({
                  rawPrice: partialPrice,
                  side: "long",
                  direction: "exit",
                  atr14,
                  costOverrides,
                });
                trade.partialFilled = true;
                trade.partialShares = partialShares;
                trade.partialR = (partialTrace.finalPrice - trade.entryPrice) / riskPerShare;
                trade.shares -= partialShares;
                totalSlippageCosts += partialTrace.slippageBps;

                trade.stopPrice = trade.entryPrice + riskPerShare * 0.1;
                trade.trailingStopPrice = trade.stopPrice;

                log(`[SmallCapSim] ${ticker} PARTIAL at ${scConfig.partialExitR}R: ${partialShares}sh @ $${partialTrace.finalPrice.toFixed(2)} | stop moved to BE+0.1R`, "historical");
              }
            }

            if (!trade.trailingActivated && trade.mfeR >= scConfig.trailActivationR) {
              trade.trailingActivated = true;
              if (trade.trailingStopPrice === null) {
                trade.trailingStopPrice = Math.max(trade.stopPrice, bar.high - riskPerShare * scConfig.trailOffsetR);
              }
              log(`[SmallCapSim] ${ticker} trail activated at ${trade.mfeR.toFixed(2)}R MFE (threshold: ${scConfig.trailActivationR}R), trail=$${trade.trailingStopPrice.toFixed(2)}`, "historical");
            }

            if (trade.trailingActivated && trade.trailingStopPrice !== null) {
              const newTrail = bar.high - riskPerShare * scConfig.trailOffsetR;
              if (newTrail > trade.trailingStopPrice) {
                trade.trailingStopPrice = newTrail;
              }
              trade.stopPrice = Math.max(trade.stopPrice, trade.trailingStopPrice);
            }
          }

          if (trade.pendingExit) {
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: bar.open,
              side: "long",
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeSmallCapTrade(trade, exitTrace.finalPrice, trade.pendingExit.reason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
            continue;
          }

          let shouldExit = false;
          let exitReason = "";

          if (bar.low <= trade.stopPrice) {
            shouldExit = true;
            exitReason = bar.open <= trade.stopPrice
              ? `Gap-through stop at $${bar.open.toFixed(2)}`
              : `Stop hit at $${trade.stopPrice.toFixed(2)}${trade.trailingActivated ? " (trailing)" : ""}`;
          }

          if (!shouldExit && minutesSinceOpen >= scConfig.timeExitMinutes) {
            trade.pendingExit = {
              reason: `Time exit at ${minutesSinceOpen}min`,
              exitType: "time_stop",
              decisionBarIndex: i,
            };
            continue;
          }

          if (shouldExit) {
            const rawFill = bar.open <= trade.stopPrice ? bar.open : trade.stopPrice;
            const exitTrace = applyFrictionAndRoundWithTrace({
              rawPrice: rawFill,
              side: "long",
              direction: "exit",
              atr14,
              costOverrides,
            });
            closeSmallCapTrade(trade, exitTrace.finalPrice, exitReason, ticker, bar.timestamp,
              tickerBars5m[trade.entryBarIndex]?.timestamp ?? bar.timestamp, minutesSinceOpen, atr14);
            totalSlippageCosts += exitTrace.slippageBps;
            activeTrade = null;
          }

          continue;
        }

        if (tickerTradeCount >= scConfig.maxTradesPerTicker) continue;
        if (minutesSinceOpen <= 15) {
          if (bar.high > hodState.hodPrice) {
            hodState.hodPrice = bar.high;
            hodState.hodBarIndex = i;
          }
          continue;
        }

        hodState = updateHODState(hodState, bar, i, todayOpen, bars5mAccum.slice(-20));

        if (hodState.pullbackStarted && !hodState.signalFired) {
          const signal = checkPullbackRebreak(hodState, bar, i, pbConfig);
          if (signal) {
            const barSpreadPct = bar.close > 0 ? (bar.high - bar.low) / bar.close : 0;
            if (barSpreadPct > scConfig.maxSpreadPct) {
              log(`[SmallCapSim] ${ticker} ENTRY SKIPPED: spread ${(barSpreadPct * 100).toFixed(2)}% > max ${(scConfig.maxSpreadPct * 100).toFixed(2)}%`, "historical");
              spreadRejects++;
              continue;
            }

            hodState.signalFired = true;
            tickerTradeCount++;

            const entryTrace = applyFrictionAndRoundWithTrace({
              rawPrice: signal.entryPrice,
              side: "long",
              direction: "entry",
              atr14,
              costOverrides,
            });
            const entryPrice = entryTrace.finalPrice;
            const riskPerShare = entryPrice - signal.stopPrice;

            if (riskPerShare <= 0 || riskPerShare > entryPrice * 0.05) {
              tickerTradeCount--;
              continue;
            }

            const sizing = calculatePositionSize(
              accountSize,
              scConfig.riskPct,
              20, // Default for small cap or pull from config if available
              entryPrice,
              riskPerShare
            );
            const shares = sizing.shares;
            const dollarRisk = sizing.dollarRisk;

            if (shares <= 0) {
              tickerTradeCount--;
              continue;
            }

            if (sizing.isCapLimited) {
              log(`[SmallCapSim] ${ticker} ENTRY CAP-LIMITED: reduced to ${shares}sh to respect 20% max position size`, "historical");
            }

            activeTrade = {
              direction: "LONG",
              entryPrice,
              stopPrice: signal.stopPrice,
              originalStopPrice: signal.stopPrice,
              shares,
              originalShares: shares,
              entryBarIndex: i,
              dollarRisk,
              riskPerShare,
              mfeR: 0,
              mfePrice: entryPrice,
              mfeBarIndex: i,
              maeR: 0,
              maePrice: entryPrice,
              maeBarIndex: i,
              partialFilled: false,
              partialShares: 0,
              partialR: 0,
              trailingActivated: false,
              trailingStopPrice: null,
              pendingExit: null,
              pullbackSignal: signal,
            };

            totalSlippageCosts += entryTrace.slippageBps;
            log(
              `[SmallCapSim] ${ticker} ENTRY LONG at $${entryPrice.toFixed(2)} | stop=$${signal.stopPrice.toFixed(2)} | ${shares}sh | HOD=$${signal.hodPrice.toFixed(2)} pullback=${signal.pullbackBars}bars depth=${(signal.pullbackDepthPct * 100).toFixed(1)}%`,
              "historical",
            );

            logTradeEntry({
              id: `${ticker}-${simulationDate}-sc-${i}`,
              strategy: "smallcap_pullback",
              symbol: ticker,
              direction: "LONG",
              entryTimestamp: bar.timestamp,
              entryPrice,
              stopLoss: signal.stopPrice,
              target1: entryPrice + riskPerShare * scConfig.partialExitR,
              shares,
              dollarRisk,
              riskPerShare,
              isCapLimited: sizing.isCapLimited,
              entryReason: `HOD break pullback | HOD=$${signal.hodPrice.toFixed(2)} depth=${(signal.pullbackDepthPct * 100).toFixed(1)}%`,
              tier: "pullback_long",
              gapPct: signal.gapPct,
              pullbackDepth: signal.pullbackDepthPct,
            });
          }
        }
      }

      if (activeTrade) {
        const lastBar = tickerBars5m[tickerBars5m.length - 1];
        const eodTrace = applyFrictionAndRoundWithTrace({
          rawPrice: lastBar.close,
          side: "long",
          direction: "exit",
          atr14: calculateATR(bars5mAccum, 14),
          costOverrides,
        });
        closeSmallCapTrade(activeTrade, eodTrace.finalPrice, "End of day close", ticker, lastBar.timestamp,
          tickerBars5m[activeTrade.entryBarIndex]?.timestamp ?? lastBar.timestamp,
          tickerBars5m.length * 5, calculateATR(bars5mAccum, 14));
        activeTrade = null;
      }
    }

    let maxDD = 0;
    let peak = 0;
    let equity = 0;
    for (const r of tradeNetPnls) {
      equity += r;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    flushOpenEntries();

    const result: DryRunResult = {
      trades: tradesGenerated,
      wins: winCount,
      losses: lossCount,
      grossPnl: Number(grossPnlTotal.toFixed(2)),
      netPnl: Number(totalPnl.toFixed(2)),
      totalCommissions: Number(totalCommissions.toFixed(2)),
      totalSlippageCosts: Number(totalSlippageCosts.toFixed(2)),
      tradeRs,
      tradeMFEs: tradeMFEs.length > 0 ? tradeMFEs : undefined,
      tradeMAEs: tradeMAEs.length > 0 ? tradeMAEs : undefined,
      tradeHit1R: tradeHit1R.length > 0 ? tradeHit1R : undefined,
      tradeHitTarget: tradeHitTarget.length > 0 ? tradeHitTarget : undefined,
      tradeSlippageCostsR: tradeSlippageCostsR.length > 0 ? tradeSlippageCostsR : undefined,
      tradeScratchAfterPartial: tradeScratchAfterPartial.length > 0 ? tradeScratchAfterPartial : undefined,
      tradeLossBuckets: tradeLossBuckets.length > 0 ? tradeLossBuckets : undefined,
      tradeTickers: tradeTickers.length > 0 ? tradeTickers : undefined,
      tradeGapPcts: tradeGapPcts.length > 0 ? tradeGapPcts : undefined,
      tradeRegimes: tradeRegimes.length > 0 ? tradeRegimes : undefined,
      maxDrawdown: Number(maxDD.toFixed(2)),
      byRegime: tradesByRegime,
      bySession: tradesBySession,
      byTier: tradesByTier,
      qualifications: qualifications,
      spreadRejects,
      dynamicScannerStats: dynamicScanStats,
    };

    if (isDryRun) {
      return result;
    }

    log(
      `[SmallCapSim] ${simulationDate} COMPLETE: ${tradesGenerated} trades, ${winCount}W/${lossCount}L, PnL=$${totalPnl.toFixed(2)}, MaxDD=$${maxDD.toFixed(2)}`,
      "historical",
    );
  } catch (error: any) {
    log(`[SmallCapSim] Error: ${error.message}`, "historical");
    if (isDryRun) {
      throw error;
    }
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
