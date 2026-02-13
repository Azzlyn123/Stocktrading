import type { TradeRecord } from "./tradeAnalytics";
import { buildDailySummary, formatDailySummary } from "./tradeAnalytics";

let todayTrades: TradeRecord[] = [];
let currentDate: string = new Date().toISOString().split("T")[0];

function ensureDate(): void {
  const now = new Date().toISOString().split("T")[0];
  if (now !== currentDate) {
    todayTrades = [];
    currentDate = now;
  }
}

export function addTrade(trade: TradeRecord): void {
  ensureDate();
  todayTrades.push(trade);
}

export function getTodayTrades(): TradeRecord[] {
  ensureDate();
  return [...todayTrades];
}

export function resetTodayTrades(): void {
  todayTrades = [];
  currentDate = new Date().toISOString().split("T")[0];
}

export function printDailyReport(): void {
  const trades = getTodayTrades();
  const summary = buildDailySummary(trades);
  console.log(formatDailySummary(summary));
}
