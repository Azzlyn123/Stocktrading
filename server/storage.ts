import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
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
  createLesson(lesson: InsertTradeLesson): Promise<TradeLesson>;

  getSimulationRuns(): Promise<SimulationRun[]>;
  getSimulationRun(id: string): Promise<SimulationRun | undefined>;
  createSimulationRun(run: InsertSimulationRun): Promise<SimulationRun>;
  updateSimulationRun(id: string, updates: Partial<SimulationRun>): Promise<SimulationRun | undefined>;
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
    const [result] = await db.update(paperTrades).set(updates).where(eq(paperTrades.id, id)).returning();
    return result;
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

  async createLesson(lesson: InsertTradeLesson): Promise<TradeLesson> {
    const [result] = await db.insert(tradeLessons).values(lesson).returning();
    return result;
  }

  async getSimulationRuns(): Promise<SimulationRun[]> {
    return db.select().from(simulationRuns).orderBy(desc(simulationRuns.startedAt));
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
}

export const storage = new DatabaseStorage();
