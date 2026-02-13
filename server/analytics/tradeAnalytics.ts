export type ExitReasonType =
  | "STOP_LOSS"
  | "TIME_STOP"
  | "HARD_EXIT"
  | "TARGET_2"
  | "MANUAL"
  | "EOD"
  | "UNKNOWN";

export interface TradeRecord {
  id: string;
  symbol: string;
  tier: "A" | "B" | "C";
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  stopPrice: number;
  exitPrice: number;
  qty: number;
  riskDollars: number;
  rMultiple: number;
  pnlDollars: number;
  durationMinutes: number;
  exitReason: ExitReasonType;
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
  direction: "LONG" | "SHORT",
  entryPrice: number,
  stopPrice: number,
  exitPrice: number,
): number {
  if (direction === "LONG") {
    const risk = entryPrice - stopPrice;
    if (risk === 0) return 0;
    return (exitPrice - entryPrice) / risk;
  }
  const risk = stopPrice - entryPrice;
  if (risk === 0) return 0;
  return (entryPrice - exitPrice) / risk;
}

export function computePnLDollars(
  direction: "LONG" | "SHORT",
  entryPrice: number,
  exitPrice: number,
  qty: number,
): number {
  if (direction === "LONG") {
    return (exitPrice - entryPrice) * qty;
  }
  return (entryPrice - exitPrice) * qty;
}

export function computeDurationMinutes(
  entryTimeISO: string,
  exitTimeISO: string,
): number {
  const entryMs = new Date(entryTimeISO).getTime();
  const exitMs = new Date(exitTimeISO).getTime();
  return (exitMs - entryMs) / 60000;
}

export function buildDailySummary(trades: TradeRecord[]): DailySummary {
  if (trades.length === 0) {
    return {
      dateISO: new Date().toISOString().split("T")[0],
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

  const dateISO = trades[0].entryTime.split("T")[0];
  const wins = trades.filter((t) => t.pnlDollars > 0);
  const losses = trades.filter((t) => t.pnlDollars <= 0);
  const winRs = wins.map((t) => t.rMultiple);
  const lossRs = losses.map((t) => t.rMultiple);
  const allRs = trades.map((t) => t.rMultiple);
  const totalR = allRs.reduce((s, r) => s + r, 0);
  const totalPnL = trades.reduce((s, t) => s + t.pnlDollars, 0);
  const totalDuration = trades.reduce((s, t) => s + t.durationMinutes, 0);

  let maxDrawdownR = 0;
  let peakR = 0;
  let cumulativeR = 0;
  for (const t of trades) {
    cumulativeR += t.rMultiple;
    if (cumulativeR > peakR) peakR = cumulativeR;
    const dd = peakR - cumulativeR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
  }

  const exitReasonCounts: Record<string, number> = {};
  for (const t of trades) {
    exitReasonCounts[t.exitReason] =
      (exitReasonCounts[t.exitReason] || 0) + 1;
  }

  return {
    dateISO,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    avgR: totalR / trades.length,
    totalR,
    avgWinR: winRs.length > 0 ? winRs.reduce((s, r) => s + r, 0) / winRs.length : 0,
    avgLossR: lossRs.length > 0 ? lossRs.reduce((s, r) => s + r, 0) / lossRs.length : 0,
    bestR: Math.max(...allRs),
    worstR: Math.min(...allRs),
    totalPnL,
    avgDurationMin: totalDuration / trades.length,
    maxDrawdownR,
    exitReasonCounts,
  };
}

export function formatDailySummary(summary: DailySummary): string {
  if (summary.trades === 0) {
    return "No trades yet today.";
  }

  const exitStr = Object.entries(summary.exitReasonCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return [
    `DAILY SUMMARY (${summary.dateISO})`,
    `Trades: ${summary.trades} | Wins: ${summary.wins} | Losses: ${summary.losses} | WinRate: ${summary.winRate.toFixed(1)}%`,
    `Total R: ${summary.totalR >= 0 ? "+" : ""}${summary.totalR.toFixed(2)} | Avg R: ${summary.avgR >= 0 ? "+" : ""}${summary.avgR.toFixed(2)} | Total PnL: $${summary.totalPnL.toFixed(2)}`,
    `Best R: ${summary.bestR >= 0 ? "+" : ""}${summary.bestR.toFixed(2)} | Worst R: ${summary.worstR.toFixed(2)} | Avg Win R: ${summary.avgWinR >= 0 ? "+" : ""}${summary.avgWinR.toFixed(2)} | Avg Loss R: ${summary.avgLossR.toFixed(2)}`,
    `Avg Duration: ${summary.avgDurationMin.toFixed(1)} min | Max Drawdown: -${summary.maxDrawdownR.toFixed(2)}R`,
    `Exit Reasons: ${exitStr}`,
  ].join("\n");
}
