// client/src/analytics/report.ts
import { getTodayTrades } from "./tradeStore";
import { buildDailySummary, formatDailySummary } from "./tradeAnalytics";

export function printDailyReport(): void {
  const trades = getTodayTrades();
  const summary = buildDailySummary(trades);
  console.log(formatDailySummary(summary));
}
