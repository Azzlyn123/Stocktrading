import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import { addTrade } from "./analytics/tradeStore";
import {
  computeRMultiple,
  computePnLDollars,
  computeDurationMinutes,
  classifyExitReason,
  classifySession,
  type TradeRecord,
  type MarketRegime,
} from "./analytics/tradeAnalytics";
import {
  users,
  watchlistItems,
  signals,
  alerts,
  paperTrades,
  dailySummaries,
  tradeLessons,
  simulationRuns,
  type User,
  type InsertUser,
  type WatchlistItem,
  type InsertWatchlistItem,
  type Signal,
  type InsertSignal,
  type Alert,
  type InsertAlert,
  type PaperTrade,
  type InsertPaperTrade,
  type DailySummary,
  type InsertDailySummary,
  type TradeLesson,
  type InsertTradeLesson,
  type SettingsUpdate,
  type SimulationRun,
  type InsertSimulationRun,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getFirstUser(): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserSettings(id: string, settings: SettingsUpdate): Promise<User | undefined>;

  getWatchlist(userId: string): Promise<WatchlistItem[]>;
  getAllWatchlist(): Promise<WatchlistItem[]>;
  addWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeWatchlistItem(id: string, userId: string): Promise<void>;
  removeWatchlistItemGlobal(id: string): Promise<void>;

  getSignals(userId: string): Promise<Signal[]>;
  getAllSignals(): Promise<Signal[]>;
  getSignalById(id: string): Promise<Signal | undefined>;
  createSignal(signal: InsertSignal): Promise<Signal>;
  updateSignal(id: string, updates: Partial<Signal>): Promise<Signal | undefined>;

  getAlerts(userId: string): Promise<Alert[]>;
  getAllAlerts(): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertsRead(userId: string): Promise<void>;
  markAllAlertsRead(): Promise<void>;

  getTrades(userId: string): Promise<PaperTrade[]>;
  getAllTrades(): Promise<PaperTrade[]>;
  createTrade(trade: InsertPaperTrade): Promise<PaperTrade>;
  updateTrade(id: string, updates: Partial<PaperTrade>): Promise<PaperTrade | undefined>;

  getSummaries(userId: string): Promise<DailySummary[]>;
  getAllSummaries(): Promise<DailySummary[]>;
  createSummary(summary: InsertDailySummary): Promise<DailySummary>;
  upsertDailySummary(userId: string, pnl: number, isWin: boolean, accountBalance: number): Promise<DailySummary>;

  getLessons(): Promise<TradeLesson[]>;
  getRecentLessons(limit: number): Promise<TradeLesson[]>;
  getRecentLessonsByVersion(limit: number, strategyVersion: string): Promise<TradeLesson[]>;
  createLesson(lesson: InsertTradeLesson): Promise<TradeLesson>;

  getCompletedDatesByVersion(userId: string, strategyVersion: string): Promise<Set<string>>;
  getSimulationRuns(userId: string): Promise<SimulationRun[]>;
  getSimulationRun(id: string): Promise<SimulationRun | undefined>;
  createSimulationRun(run: InsertSimulationRun): Promise<SimulationRun>;
  updateSimulationRun(id: string, updates: Partial<SimulationRun>): Promise<SimulationRun | undefined>;
  resetAllSimulationData(): Promise<{ simulationRuns: number; trades: number; lessons: number; signals: number; alerts: number; summaries: number }>;
  getTradeCountForVersion(version: string): Promise<number>;
  getArchiveData(): Promise<{ simulationRuns: SimulationRun[]; paperTrades: PaperTrade[]; dailySummaries: DailySummary[]; tradeLessons: TradeLesson[] }>;
  getCoreMetrics(version?: string): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinR: number;
    avgLossR: number;
    expectancyR: number;
    maxDrawdownR: number;
    tradesPerDay: number;
    distinctDays: number;
    rValues: number[];
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getFirstUser(): Promise<User | undefined> {
    const [user] = await db.select().from(users).limit(1);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserSettings(id: string, settings: SettingsUpdate): Promise<User | undefined> {
    const [user] = await db.update(users).set(settings).where(eq(users.id, id)).returning();
    return user;
  }

  async getWatchlist(userId: string): Promise<WatchlistItem[]> {
    return db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)).orderBy(desc(watchlistItems.addedAt));
  }

  async getAllWatchlist(): Promise<WatchlistItem[]> {
    return db.select().from(watchlistItems).orderBy(desc(watchlistItems.addedAt));
  }

  async addWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [result] = await db.insert(watchlistItems).values(item).returning();
    return result;
  }

  async removeWatchlistItem(id: string, userId: string): Promise<void> {
    await db.delete(watchlistItems).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
  }

  async removeWatchlistItemGlobal(id: string): Promise<void> {
    await db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  }

  async getSignals(userId: string): Promise<Signal[]> {
    return db.select().from(signals).where(eq(signals.userId, userId)).orderBy(desc(signals.createdAt));
  }

  async getAllSignals(): Promise<Signal[]> {
    return db.select().from(signals).orderBy(desc(signals.createdAt));
  }

  async getSignalById(id: string): Promise<Signal | undefined> {
    const [signal] = await db.select().from(signals).where(eq(signals.id, id));
    return signal;
  }

  async createSignal(signal: InsertSignal): Promise<Signal> {
    const [result] = await db.insert(signals).values(signal).returning();
    return result;
  }

  async updateSignal(id: string, updates: Partial<Signal>): Promise<Signal | undefined> {
    const [result] = await db.update(signals).set({ ...updates, updatedAt: new Date() }).where(eq(signals.id, id)).returning();
    return result;
  }

  async getAlerts(userId: string): Promise<Alert[]> {
    return db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
  }

  async getAllAlerts(): Promise<Alert[]> {
    return db.select().from(alerts).orderBy(desc(alerts.createdAt));
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [result] = await db.insert(alerts).values(alert).returning();
    return result;
  }

  async markAlertsRead(userId: string): Promise<void> {
    await db.update(alerts).set({ isRead: true }).where(eq(alerts.userId, userId));
  }

  async markAllAlertsRead(): Promise<void> {
    await db.update(alerts).set({ isRead: true });
  }

  async getTrades(userId: string): Promise<PaperTrade[]> {
    return db.select().from(paperTrades).where(eq(paperTrades.userId, userId)).orderBy(desc(paperTrades.enteredAt));
  }

  async getAllTrades(): Promise<PaperTrade[]> {
    return db.select().from(paperTrades).orderBy(desc(paperTrades.enteredAt));
  }

  async createTrade(trade: InsertPaperTrade): Promise<PaperTrade> {
    const [result] = await db.insert(paperTrades).values(trade).returning();
    return result;
  }

  async updateTrade(id: string, updates: Partial<PaperTrade>): Promise<PaperTrade | undefined> {
    let previousStatus: string | null = null;
    if (updates.status === "closed") {
      const [existing] = await db.select({ status: paperTrades.status }).from(paperTrades).where(eq(paperTrades.id, id));
      previousStatus = existing?.status ?? null;
    }

    const [result] = await db.update(paperTrades).set(updates).where(eq(paperTrades.id, id)).returning();
    if (!result) return undefined;

    if (updates.status === "closed" && previousStatus !== "closed" && result.exitPrice != null) {
      this.recordAnalytics(result).catch(() => {});
    }

    return result;
  }

  private async recordAnalytics(trade: PaperTrade): Promise<void> {
    try {
      const direction = (trade.direction === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT";
      const entryTime = trade.enteredAt?.toISOString() ?? new Date().toISOString();
      const exitTime = trade.exitedAt?.toISOString() ?? new Date().toISOString();
      const exitPrice = trade.exitPrice!;

      const rMultiple = computeRMultiple(direction, trade.entryPrice, trade.stopPrice, exitPrice);
      const pnlDollars = computePnLDollars(direction, trade.entryPrice, exitPrice, trade.shares);
      const durationMinutes = computeDurationMinutes(entryTime, exitTime);
      const riskDollars = Math.abs(trade.entryPrice - trade.stopPrice) * trade.shares;

      let regime: MarketRegime = "unknown";
      let spyAligned = false;
      let volatilityGatePassed = false;

      if (trade.signalId) {
        const signal = await this.getSignalById(trade.signalId);
        if (signal) {
          regime = (signal.marketRegime as MarketRegime) ?? "unknown";
          spyAligned = signal.spyAligned ?? false;
          volatilityGatePassed = signal.volatilityGatePassed ?? false;
        }
      }

      const record: TradeRecord = {
        id: trade.id,
        symbol: trade.ticker,
        tier: (trade.scoreTier ?? trade.tier ?? "C") as "A" | "B" | "C",
        direction,
        entryTime,
        exitTime,
        entryPrice: trade.entryPrice,
        stopPrice: trade.stopPrice,
        exitPrice,
        qty: trade.shares,
        riskDollars,
        rMultiple,
        pnlDollars,
        durationMinutes,
        exitReason: classifyExitReason(trade.exitReason),
        score: trade.score ?? 0,
        marketRegime: regime,
        session: classifySession(exitTime),
        spyAligned,
        volatilityGatePassed,
        entryMode: trade.entryMode ?? null,
        isPowerSetup: trade.isPowerSetup ?? false,
      };

      addTrade(record);
    } catch {
    }
  }

  async getSummaries(userId: string): Promise<DailySummary[]> {
    return db.select().from(dailySummaries).where(eq(dailySummaries.userId, userId)).orderBy(desc(dailySummaries.date));
  }

  async getAllSummaries(): Promise<DailySummary[]> {
    return db.select().from(dailySummaries).orderBy(desc(dailySummaries.date));
  }

  async createSummary(summary: InsertDailySummary): Promise<DailySummary> {
    const [result] = await db.insert(dailySummaries).values(summary).returning();
    return result;
  }

  async upsertDailySummary(userId: string, pnl: number, isWin: boolean, accountBalance: number): Promise<DailySummary> {
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }).split("/");
    const dateStr = `${today[2]}-${today[0].padStart(2, "0")}-${today[1].padStart(2, "0")}`;

    const [existing] = await db
      .select()
      .from(dailySummaries)
      .where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.date, dateStr)));

    if (existing) {
      const totalTrades = (existing.totalTrades ?? 0) + 1;
      const winningTrades = (existing.winningTrades ?? 0) + (isWin ? 1 : 0);
      const losingTrades = (existing.losingTrades ?? 0) + (isWin ? 0 : 1);
      const totalPnl = (existing.totalPnl ?? 0) + pnl;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      const prevBalance = existing.accountBalance ?? accountBalance;
      const peakBalance = Math.max(prevBalance, accountBalance);
      const currentDrawdown = accountBalance < peakBalance ? accountBalance - peakBalance : 0;
      const maxDrawdown = Math.min(existing.maxDrawdown ?? 0, currentDrawdown);

      const [result] = await db
        .update(dailySummaries)
        .set({
          totalTrades,
          winningTrades,
          losingTrades,
          totalPnl: Number(totalPnl.toFixed(2)),
          winRate: Number(winRate.toFixed(1)),
          maxDrawdown: Number(maxDrawdown.toFixed(2)),
          accountBalance: Number(accountBalance.toFixed(2)),
        })
        .where(eq(dailySummaries.id, existing.id))
        .returning();
      return result;
    } else {
      return this.createSummary({
        userId,
        date: dateStr,
        totalTrades: 1,
        winningTrades: isWin ? 1 : 0,
        losingTrades: isWin ? 0 : 1,
        winRate: isWin ? 100 : 0,
        totalPnl: Number(pnl.toFixed(2)),
        maxDrawdown: pnl < 0 ? Number(pnl.toFixed(2)) : 0,
        accountBalance: Number(accountBalance.toFixed(2)),
      });
    }
  }

  async getLessons(): Promise<TradeLesson[]> {
    return db.select().from(tradeLessons).orderBy(desc(tradeLessons.createdAt));
  }

  async getRecentLessons(limit: number): Promise<TradeLesson[]> {
    return db.select().from(tradeLessons).orderBy(desc(tradeLessons.createdAt)).limit(limit);
  }

  async getRecentLessonsByVersion(limit: number, strategyVersion: string): Promise<TradeLesson[]> {
    return db.select().from(tradeLessons)
      .where(eq(tradeLessons.strategyVersion, strategyVersion))
      .orderBy(desc(tradeLessons.createdAt))
      .limit(limit);
  }

  async createLesson(lesson: InsertTradeLesson): Promise<TradeLesson> {
    const [result] = await db.insert(tradeLessons).values(lesson).returning();
    return result;
  }

  async getCompletedDatesByVersion(userId: string, strategyVersion: string): Promise<Set<string>> {
    const rows = await db.select({ simulationDate: simulationRuns.simulationDate })
      .from(simulationRuns)
      .where(and(
        eq(simulationRuns.userId, userId),
        eq(simulationRuns.strategyVersion, strategyVersion),
        eq(simulationRuns.status, "completed")
      ));
    return new Set(rows.map(r => r.simulationDate).filter(Boolean) as string[]);
  }

  async getSimulationRuns(userId: string): Promise<SimulationRun[]> {
    return db.select().from(simulationRuns).where(eq(simulationRuns.userId, userId)).orderBy(desc(simulationRuns.startedAt));
  }

  async getSimulationRun(id: string): Promise<SimulationRun | undefined> {
    const [run] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, id));
    return run;
  }

  async createSimulationRun(run: InsertSimulationRun): Promise<SimulationRun> {
    const [result] = await db.insert(simulationRuns).values(run).returning();
    return result;
  }

  async updateSimulationRun(id: string, updates: Partial<SimulationRun>): Promise<SimulationRun | undefined> {
    const [result] = await db.update(simulationRuns).set(updates).where(eq(simulationRuns.id, id)).returning();
    return result;
  }

  async resetAllSimulationData(): Promise<{ simulationRuns: number; trades: number; lessons: number; signals: number; alerts: number; summaries: number }> {
    const simRows = await db.delete(simulationRuns).returning();
    const tradeRows = await db.delete(paperTrades).returning();
    const lessonRows = await db.delete(tradeLessons).returning();
    const signalRows = await db.delete(signals).returning();
    const alertRows = await db.delete(alerts).returning();
    const summaryRows = await db.delete(dailySummaries).returning();
    return {
      simulationRuns: simRows.length,
      trades: tradeRows.length,
      lessons: lessonRows.length,
      signals: signalRows.length,
      alerts: alertRows.length,
      summaries: summaryRows.length,
    };
  }

  async getTradeCountForVersion(version: string): Promise<number> {
    const runs = await db.select().from(simulationRuns)
      .where(eq(simulationRuns.strategyVersion, version));
    const runIds = new Set(runs.map(r => r.id));
    if (runIds.size === 0) return 0;
    const allTrades = await db.select().from(paperTrades)
      .where(eq(paperTrades.status, "closed"));
    return allTrades.filter(t => t.simulationRunId && runIds.has(t.simulationRunId)).length;
  }

  async getArchiveData(): Promise<{ simulationRuns: SimulationRun[]; paperTrades: PaperTrade[]; dailySummaries: DailySummary[]; tradeLessons: TradeLesson[] }> {
    const allRuns = await db.select().from(simulationRuns).orderBy(desc(simulationRuns.startedAt));
    const allTrades = await db.select().from(paperTrades).orderBy(desc(paperTrades.enteredAt));
    const allSummaries = await db.select().from(dailySummaries).orderBy(desc(dailySummaries.date));
    const allLessons = await db.select().from(tradeLessons).orderBy(desc(tradeLessons.createdAt));
    return { simulationRuns: allRuns, paperTrades: allTrades, dailySummaries: allSummaries, tradeLessons: allLessons };
  }

  async getCoreMetrics(version?: string): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinR: number;
    avgLossR: number;
    expectancyR: number;
    maxDrawdownR: number;
    tradesPerDay: number;
    distinctDays: number;
    rValues: number[];
  }> {
    let runs: SimulationRun[];
    if (version) {
      runs = await db.select().from(simulationRuns)
        .where(and(eq(simulationRuns.status, "completed"), eq(simulationRuns.strategyVersion, version)));
    } else {
      runs = await db.select().from(simulationRuns)
        .where(eq(simulationRuns.status, "completed"));
    }

    const runIds = new Set(runs.map(r => r.id));
    const allTrades = await db.select().from(paperTrades)
      .where(eq(paperTrades.status, "closed"));

    const trades = allTrades.filter(t => t.simulationRunId && runIds.has(t.simulationRunId));

    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgWinR: 0, avgLossR: 0, expectancyR: 0, maxDrawdownR: 0, tradesPerDay: 0, distinctDays: 0, rValues: [] };
    }

    const rValues = trades.map(t => t.realizedR ?? t.rMultiple ?? 0);
    const winTrades = trades.filter(t => (t.pnl ?? 0) > 0);
    const lossTrades = trades.filter(t => (t.pnl ?? 0) <= 0);
    const wins = winTrades.length;
    const losses = lossTrades.length;
    const winRate = (wins / totalTrades) * 100;

    const winRs = winTrades.map(t => t.realizedR ?? t.rMultiple ?? 0);
    const lossRs = lossTrades.map(t => t.realizedR ?? t.rMultiple ?? 0);
    const avgWinR = winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : 0;
    const avgLossR = lossRs.length > 0 ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length : 0;
    const expectancyR = rValues.reduce((a, b) => a + b, 0) / totalTrades;

    let peak = 0;
    let cumR = 0;
    let maxDD = 0;
    for (const r of rValues) {
      cumR += r;
      if (cumR > peak) peak = cumR;
      const dd = peak - cumR;
      if (dd > maxDD) maxDD = dd;
    }

    const distinctDays = new Set(runs.map(r => r.simulationDate)).size;
    const tradesPerDay = distinctDays > 0 ? totalTrades / distinctDays : 0;

    return {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      avgWinR: Math.round(avgWinR * 1000) / 1000,
      avgLossR: Math.round(avgLossR * 1000) / 1000,
      expectancyR: Math.round(expectancyR * 1000) / 1000,
      maxDrawdownR: Math.round(maxDD * 1000) / 1000,
      tradesPerDay: Math.round(tradesPerDay * 10) / 10,
      distinctDays,
      rValues,
    };
  }
}

export const storage = new DatabaseStorage();
