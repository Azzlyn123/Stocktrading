import type { TradeRecord } from "./tradeAnalytics";
import { buildDailySummary, formatDailySummary } from "./tradeAnalytics";

const tradeMap: Map<string, TradeRecord> = new Map();

export function addTrade(trade: TradeRecord): boolean {
  if (tradeMap.has(trade.id)) {
    return false;
  }
  tradeMap.set(trade.id, trade);
  return true;
}

export function getTodayTrades(): TradeRecord[] {
  const today = new Date().toISOString().split("T")[0];
  return Array.from(tradeMap.values())
    .filter((t) => t.exitTime.startsWith(today))
    .sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());
}

export function getAllTrades(): TradeRecord[] {
  return Array.from(tradeMap.values()).sort(
    (a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime(),
  );
}

export function getTradesByDate(dateISO: string): TradeRecord[] {
  return Array.from(tradeMap.values())
    .filter((t) => t.exitTime.startsWith(dateISO))
    .sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());
}

export function resetAllTrades(): void {
  tradeMap.clear();
}

export function getTradeCount(): number {
  return tradeMap.size;
}

export function printDailyReport(): void {
  const trades = getTodayTrades();
  const summary = buildDailySummary(trades);
  console.log(formatDailySummary(summary));
}
