// src/analytics/tradeAnalytics.ts
export type Tier = "A" | "B" | "C";
export type Direction = "LONG" | "SHORT";
export type ExitReason =
  | "STOP_LOSS"
  | "TIME_STOP"
  | "HARD_EXIT"
  | "TARGET_2"
  | "MANUAL"
  | "UNKNOWN";

export interface TradeRecord {
  id: string;
  symbol: string;
  tier: Tier;
  direction: Direction;
  entryTime: string; // ISO
  exitTime: string; // ISO
  entryPrice: number;
  stopPrice: number;
  exitPrice: number;
  qty: number;
  riskDollars: number;
  rMultiple: number;
  pnlDollars: number;
  durationMinutes: number;
  exitReason: ExitReason;
  notes?: string;
}

export interface DailySummary {
  dateISO: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
  avgWinR: number;
  avgLossR: number;
  bestR: number;
  worstR: number;
  totalPnL: number;
  avgDurationMin: number;
  maxDrawdownR: number;
  exitReasonCounts: Record<string, number>;
}

export function computeRMultiple(
  direction: Direction,
  entryPrice: number,
  stopPrice: number,
  exitPrice: number,
): { r: number; notes?: string } {
  const riskDist = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(riskDist) || riskDist <= 0) {
    return { r: 0, notes: "invalid risk distance (stop == entry)" };
  }

  if (direction === "LONG") {
    return { r: (exitPrice - entryPrice) / (entryPrice - stopPrice) };
  } else {
    return { r: (entryPrice - exitPrice) / (stopPrice - entryPrice) };
  }
}

export function computePnLDollars(
  direction: Direction,
  entryPrice: number,
  exitPrice: number,
  qty: number,
): number {
  if (direction === "LONG") return (exitPrice - entryPrice) * qty;
  return (entryPrice - exitPrice) * qty;
}

export function computeDurationMinutes(
  entryISO: string,
  exitISO: string,
): number {
  const a = new Date(entryISO).getTime();
  const b = new Date(exitISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return (b - a) / 60000;
}

export function buildDailySummary(trades: TradeRecord[]): DailySummary {
  const dateISO = new Date().toISOString().slice(0, 10);

  if (!trades.length) {
    return {
      dateISO,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgR: 0,
      totalR: 0,
      avgWinR: 0,
      avgLossR: 0,
      bestR: 0,
      worstR: 0,
      totalPnL: 0,
      avgDurationMin: 0,
      maxDrawdownR: 0,
      exitReasonCounts: {},
    };
  }

  const rs = trades.map((t) => t.rMultiple);
  const wins = rs.filter((r) => r > 0).length;
  const losses = rs.filter((r) => r <= 0).length;
  const totalR = rs.reduce((a, b) => a + b, 0);
  const avgR = totalR / rs.length;

  const winRs = rs.filter((r) => r > 0);
  const lossRs = rs.filter((r) => r <= 0);

  const avgWinR = winRs.length
    ? winRs.reduce((a, b) => a + b, 0) / winRs.length
    : 0;
  const avgLossR = lossRs.length
    ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length
    : 0;

  const bestR = Math.max(...rs);
  const worstR = Math.min(...rs);

  const totalPnL = trades.reduce((a, t) => a + t.pnlDollars, 0);
  const avgDurationMin =
    trades.reduce((a, t) => a + t.durationMinutes, 0) / trades.length;

  const exitReasonCounts: Record<string, number> = {};
  for (const t of trades) {
    exitReasonCounts[t.exitReason] = (exitReasonCounts[t.exitReason] ?? 0) + 1;
  }

  // Max drawdown in R (simple equity curve)
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity - peak); // negative
  }

  return {
    dateISO,
    trades: trades.length,
    wins,
    losses,
    winRate: (wins / trades.length) * 100,
    avgR,
    totalR,
    avgWinR,
    avgLossR,
    bestR,
    worstR,
    totalPnL,
    avgDurationMin,
    maxDrawdownR: maxDD,
    exitReasonCounts,
  };
}

export function formatDailySummary(s: DailySummary): string {
  if (s.trades === 0)
    return `DAILY SUMMARY (${s.dateISO})\nNo trades yet today.`;

  const reasons = Object.entries(s.exitReasonCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return [
    `DAILY SUMMARY (${s.dateISO})`,
    `Trades: ${s.trades} | Wins: ${s.wins} | Losses: ${s.losses} | WinRate: ${s.winRate.toFixed(1)}%`,
    `Total R: ${s.totalR.toFixed(2)} | Avg R: ${s.avgR.toFixed(2)} | Total PnL: $${s.totalPnL.toFixed(2)}`,
    `Best R: ${s.bestR.toFixed(2)} | Worst R: ${s.worstR.toFixed(2)} | Avg Win R: ${s.avgWinR.toFixed(2)} | Avg Loss R: ${s.avgLossR.toFixed(2)}`,
    `Avg Duration: ${s.avgDurationMin.toFixed(1)} min | Max Drawdown: ${s.maxDrawdownR.toFixed(2)}R`,
    `Exit Reasons: ${reasons || "none"}`,
  ].join("\n");
}
