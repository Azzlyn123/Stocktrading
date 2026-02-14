// src/analytics/tradeStore.ts
import { TradeRecord } from "./tradeAnalytics";

let trades: TradeRecord[] = [];

function toLocalDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addTrade(t: TradeRecord): void {
  trades.push(t);
}

export function getTodayTrades(): TradeRecord[] {
  const today = toLocalDateISO(new Date());
  return trades.filter((t) => {
    const dt = new Date(t.entryTime);
    return toLocalDateISO(dt) === today;
  });
}

export function resetTodayTrades(): void {
  const today = toLocalDateISO(new Date());
  trades = trades.filter((t) => {
    const dt = new Date(t.entryTime);
    return toLocalDateISO(dt) !== today;
  });
}

export function getAllTrades(): TradeRecord[] {
  return trades.slice();
}
