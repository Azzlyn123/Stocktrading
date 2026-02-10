import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const signalStateEnum = pgEnum("signal_state", [
  "IDLE",
  "BREAKOUT",
  "RETEST",
  "TRIGGERED",
  "MANAGED",
  "CLOSED",
]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  accountSize: real("account_size").default(100000),
  paperMode: boolean("paper_mode").default(true),
  maxDailyLossPct: real("max_daily_loss_pct").default(2),
  maxLosingTrades: integer("max_losing_trades").default(3),
  cooldownMinutes: integer("cooldown_minutes").default(15),
  perTradeRiskPct: real("per_trade_risk_pct").default(0.5),
  maxPositionPct: real("max_position_pct").default(20),
  resistanceBars: integer("resistance_bars").default(48),
  breakoutBuffer: real("breakout_buffer").default(0.1),
  retestBuffer: real("retest_buffer").default(0.15),
  volumeMultiplier: real("volume_multiplier").default(1.5),
  atrPeriod: integer("atr_period").default(14),
  trailingAtrMultiplier: real("trailing_atr_multiplier").default(1.5),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  ticker: text("ticker").notNull(),
  name: text("name"),
  sector: text("sector"),
  addedAt: timestamp("added_at").defaultNow(),
  isActive: boolean("is_active").default(true),
});

export const signals = pgTable("signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  ticker: text("ticker").notNull(),
  state: signalStateEnum("state").default("IDLE"),
  resistanceLevel: real("resistance_level"),
  breakoutPrice: real("breakout_price"),
  breakoutVolume: real("breakout_volume"),
  retestLow: real("retest_low"),
  entryPrice: real("entry_price"),
  stopPrice: real("stop_price"),
  target1: real("target_1"),
  target2: real("target_2"),
  riskReward: real("risk_reward"),
  positionSize: integer("position_size"),
  dollarRisk: real("dollar_risk"),
  currentPrice: real("current_price"),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  timeframe: text("timeframe").default("5m"),
  trendConfirmed: boolean("trend_confirmed").default(false),
  volumeConfirmed: boolean("volume_confirmed").default(false),
  atrExpansion: boolean("atr_expansion").default(false),
  candlePattern: text("candle_pattern"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalId: varchar("signal_id"),
  ticker: text("ticker").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: text("priority").default("medium"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const paperTrades = pgTable("paper_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalId: varchar("signal_id"),
  ticker: text("ticker").notNull(),
  side: text("side").default("long"),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  stopPrice: real("stop_price").notNull(),
  target1: real("target_1"),
  target2: real("target_2"),
  shares: integer("shares").notNull(),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  rMultiple: real("r_multiple"),
  status: text("status").default("open"),
  enteredAt: timestamp("entered_at").defaultNow(),
  exitedAt: timestamp("exited_at"),
  exitReason: text("exit_reason"),
});

export const dailySummaries = pgTable("daily_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: text("date").notNull(),
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  losingTrades: integer("losing_trades").default(0),
  winRate: real("win_rate"),
  avgRMultiple: real("avg_r_multiple"),
  totalPnl: real("total_pnl").default(0),
  maxDrawdown: real("max_drawdown"),
  ruleViolations: integer("rule_violations").default(0),
  accountBalance: real("account_balance"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertWatchlistSchema = createInsertSchema(watchlistItems).omit({
  id: true,
  addedAt: true,
});

export const insertSignalSchema = createInsertSchema(signals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
});

export const insertAlertSchema = createInsertSchema(alerts).omit({
  id: true,
  createdAt: true,
});

export const insertPaperTradeSchema = createInsertSchema(paperTrades).omit({
  id: true,
  enteredAt: true,
  exitedAt: true,
});

export const insertDailySummarySchema = createInsertSchema(dailySummaries).omit({
  id: true,
});

export const settingsUpdateSchema = z.object({
  accountSize: z.number().min(1000).optional(),
  paperMode: z.boolean().optional(),
  maxDailyLossPct: z.number().min(0.5).max(10).optional(),
  maxLosingTrades: z.number().min(1).max(10).optional(),
  cooldownMinutes: z.number().min(1).max(60).optional(),
  perTradeRiskPct: z.number().min(0.1).max(1).optional(),
  maxPositionPct: z.number().min(5).max(50).optional(),
  resistanceBars: z.number().min(10).max(200).optional(),
  breakoutBuffer: z.number().min(0.01).max(1).optional(),
  retestBuffer: z.number().min(0.01).max(1).optional(),
  volumeMultiplier: z.number().min(1).max(5).optional(),
  atrPeriod: z.number().min(5).max(50).optional(),
  trailingAtrMultiplier: z.number().min(0.5).max(5).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type DailySummary = typeof dailySummaries.$inferSelect;
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
