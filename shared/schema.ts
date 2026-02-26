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
  volumeMultiplier: real("volume_multiplier").default(1.8),
  atrPeriod: integer("atr_period").default(14),
  trailingAtrMultiplier: real("trailing_atr_multiplier").default(1.5),
  minPrice: real("min_price").default(10),
  minAvgVolume: integer("min_avg_volume").default(2000000),
  minDollarVolume: real("min_dollar_volume").default(100000000),
  avoidEarnings: boolean("avoid_earnings").default(true),
  lunchChopFilter: boolean("lunch_chop_filter").default(true),
  lunchChopStart: text("lunch_chop_start").default("11:30"),
  lunchChopEnd: text("lunch_chop_end").default("13:30"),
  timeStopEnabled: boolean("time_stop_enabled").default(true),
  timeStopMinutes: integer("time_stop_minutes").default(30),
  timeStopR: real("time_stop_r").default(0.5),
  partialExitPct: real("partial_exit_pct").default(50),
  partialExitR: real("partial_exit_r").default(1),
  mainTargetRMin: real("main_target_r_min").default(2),
  mainTargetRMax: real("main_target_r_max").default(3),
  earningsGapPct: real("earnings_gap_pct").default(10),
  earningsRvolMin: real("earnings_rvol_min").default(5),
  maxSpreadPct: real("max_spread_pct").default(0.05),
  minDailyATRpct: real("min_daily_atr_pct").default(1.2),
  minRVOL: real("min_rvol").default(1.5),
  rvolCutoffMinutes: integer("rvol_cutoff_minutes").default(15),
  htfConfirmations: integer("htf_confirmations").default(2),
  breakoutMinBodyPct: real("breakout_min_body_pct").default(0.60),
  breakoutMinRangeMultiplier: real("breakout_min_range_multiplier").default(1.2),
  retestMaxPullbackPct: real("retest_max_pullback_pct").default(50),
  entryMode: text("entry_mode").default("conservative"),
  maxVwapCrosses: integer("max_vwap_crosses").default(3),
  chopSizeReduction: real("chop_size_reduction").default(0.50),
  volGateFirstRangePct: real("vol_gate_first_range_pct").default(70),
  volGateAtrMultiplier: real("vol_gate_atr_multiplier").default(1.3),
  scoreFullSizeMin: integer("score_full_size_min").default(80),
  scoreHalfSizeMin: integer("score_half_size_min").default(65),
  riskMode: text("risk_mode").default("balanced"), 
  powerSetupEnabled: boolean("power_setup_enabled").default(true),
  currentStrategyVersion: text("current_strategy_version").default("v1"),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  ticker: text("ticker").notNull(),
  name: text("name"),
  sector: text("sector"),
  addedAt: timestamp("added_at").defaultNow(),
  isActive: boolean("is_active").default(true),
  avgVolume: integer("avg_volume"),
  avgPrice: real("avg_price"),
  dollarVolume: real("dollar_volume"),
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
  rvol: real("rvol"),
  atrValue: real("atr_value"),
  rejectionCount: integer("rejection_count"),
  score: integer("score"),
  scoreTier: text("score_tier"),
  marketRegime: text("market_regime"),
  entryMode: text("entry_mode"),
  stopBasis: text("stop_basis"),
  spyAligned: boolean("spy_aligned").default(false),
  volatilityGatePassed: boolean("volatility_gate_passed").default(false),
  scoreBreakdown: jsonb("score_breakdown"),
  relStrengthVsSpy: real("rel_strength_vs_spy"),
  isPowerSetup: boolean("is_power_setup").default(false),
  tier: text("tier"),
  direction: text("direction").default("LONG"),
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
  originalStopPrice: real("original_stop_price"),
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
  isPartiallyExited: boolean("is_partially_exited").default(false),
  partialExitPrice: real("partial_exit_price"),
  partialExitShares: integer("partial_exit_shares"),
  stopMovedToBE: boolean("stop_moved_to_be").default(false),
  runnerShares: integer("runner_shares"),
  trailingStopPrice: real("trailing_stop_price"),
  timeStopAt: timestamp("time_stop_at"),
  dollarRisk: real("dollar_risk"),
  score: integer("score"),
  scoreTier: text("score_tier"),
  entryMode: text("entry_mode"),
  isPowerSetup: boolean("is_power_setup").default(false),
  realizedR: real("realized_r").default(0),
  tier: text("tier"),
  direction: text("direction").default("LONG"),
  scoreBreakdown: jsonb("score_breakdown"),
  simulationRunId: varchar("simulation_run_id"),
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
  ruleViolationDetails: jsonb("rule_violation_details"),
  accountBalance: real("account_balance"),
  dailyR: real("daily_r").default(0),
  isLockedOut: boolean("is_locked_out").default(false),
});

export const tradeLessons = pgTable("trade_lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeId: varchar("trade_id"),
  signalId: varchar("signal_id"),
  ticker: text("ticker").notNull(),
  tier: text("tier"),
  direction: text("direction").default("LONG"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  pnl: real("pnl"),
  rMultiple: real("r_multiple"),
  outcomeCategory: text("outcome_category").notNull(),
  exitReason: text("exit_reason"),
  lessonTags: text("lesson_tags").array(),
  lessonDetail: text("lesson_detail"),
  entryConditions: jsonb("entry_conditions"),
  marketContext: jsonb("market_context"),
  scoreAtEntry: integer("score_at_entry"),
  scoreBreakdown: jsonb("score_breakdown_at_entry"),
  durationMinutes: integer("duration_minutes"),
  patternHash: text("pattern_hash"),
  strategyVersion: text("strategy_version"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const simulationRuns = pgTable("simulation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  simulationDate: text("simulation_date").notNull(),
  status: text("status").default("pending"),
  tickers: text("tickers").array(),
  totalBars: integer("total_bars").default(0),
  processedBars: integer("processed_bars").default(0),
  tradesGenerated: integer("trades_generated").default(0),
  lessonsGenerated: integer("lessons_generated").default(0),
  totalPnl: real("total_pnl").default(0),
  grossPnl: real("gross_pnl").default(0),
  totalCommission: real("total_commission").default(0),
  totalSlippageCost: real("total_slippage_cost").default(0),
  winRate: real("win_rate"),
  benchmarks: jsonb("benchmarks").default({}),
  metrics: jsonb("metrics").default({}),
  breakdown: jsonb("breakdown").default({}),
  skippedSetups: jsonb("skipped_setups").default([]),
  errorMessage: text("error_message"),
  strategyVersion: text("strategy_version"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertSimulationRunSchema = createInsertSchema(simulationRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type SimulationRun = typeof simulationRuns.$inferSelect;
export type InsertSimulationRun = z.infer<typeof insertSimulationRunSchema>;

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

export const insertTradeLessonSchema = createInsertSchema(tradeLessons).omit({
  id: true,
  createdAt: true,
});

export const settingsUpdateSchema = z.object({
  accountSize: z.number().min(1000).optional(),
  paperMode: z.boolean().optional(),
  maxDailyLossPct: z.number().min(0.5).max(10).optional(),
  maxLosingTrades: z.number().min(1).max(50).optional(),
  cooldownMinutes: z.number().min(1).max(60).optional(),
  perTradeRiskPct: z.number().min(0.1).max(2).optional(),
  maxPositionPct: z.number().min(5).max(50).optional(),
  resistanceBars: z.number().min(10).max(200).optional(),
  breakoutBuffer: z.number().min(0.01).max(1).optional(),
  retestBuffer: z.number().min(0.01).max(1).optional(),
  volumeMultiplier: z.number().min(1).max(5).optional(),
  atrPeriod: z.number().min(5).max(50).optional(),
  trailingAtrMultiplier: z.number().min(0.5).max(5).optional(),
  minPrice: z.number().min(1).max(500).optional(),
  minAvgVolume: z.number().min(100000).max(50000000).optional(),
  minDollarVolume: z.number().min(1000000).max(500000000).optional(),
  avoidEarnings: z.boolean().optional(),
  lunchChopFilter: z.boolean().optional(),
  lunchChopStart: z.string().optional(),
  lunchChopEnd: z.string().optional(),
  timeStopEnabled: z.boolean().optional(),
  timeStopMinutes: z.number().min(5).max(120).optional(),
  timeStopR: z.number().min(0.1).max(2).optional(),
  partialExitPct: z.number().min(10).max(90).optional(),
  partialExitR: z.number().min(0.5).max(3).optional(),
  mainTargetRMin: z.number().min(1).max(5).optional(),
  mainTargetRMax: z.number().min(1.5).max(10).optional(),
  earningsGapPct: z.number().min(5).max(30).optional(),
  earningsRvolMin: z.number().min(2).max(20).optional(),
  maxSpreadPct: z.number().min(0.01).max(0.5).optional(),
  minDailyATRpct: z.number().min(0.5).max(5).optional(),
  minRVOL: z.number().min(0.5).max(5).optional(),
  rvolCutoffMinutes: z.number().min(5).max(60).optional(),
  htfConfirmations: z.number().min(1).max(3).optional(),
  breakoutMinBodyPct: z.number().min(0.3).max(0.9).optional(),
  breakoutMinRangeMultiplier: z.number().min(0.5).max(3).optional(),
  retestMaxPullbackPct: z.number().min(20).max(80).optional(),
  entryMode: z.enum(["conservative", "aggressive"]).optional(),
  maxVwapCrosses: z.number().min(1).max(10).optional(),
  chopSizeReduction: z.number().min(0.1).max(1).optional(),
  volGateFirstRangePct: z.number().min(30).max(100).optional(),
  volGateAtrMultiplier: z.number().min(1).max(3).optional(),
  scoreFullSizeMin: z.number().min(50).max(100).optional(),
  scoreHalfSizeMin: z.number().min(30).max(90).optional(),
  riskMode: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  powerSetupEnabled: z.boolean().optional(),
  currentStrategyVersion: z.string().min(1).max(50).optional(),
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
export type TradeLesson = typeof tradeLessons.$inferSelect;
export type InsertTradeLesson = z.infer<typeof insertTradeLessonSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
