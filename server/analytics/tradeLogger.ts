export interface TradeLogEntry {
  id: string;
  strategy: "breakout_retest" | "smallcap_pullback" | "gap_continuation";
  symbol: string;
  direction: "LONG" | "SHORT";

  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number;
  target1: number;
  target2: number | null;

  shares: number;
  dollarRisk: number;
  riskPerShare: number;
  isCapLimited: boolean;

  rMultiple: number | null;
  pnlDollars: number | null;
  outcome: "win" | "loss" | "open" | null;
  durationMinutes: number | null;

  entryReason: string;
  exitReason: string | null;

  tier: string | null;
  score: number | null;
  marketRegime: string | null;
  session: string | null;

  mfeR: number | null;
  maeR: number | null;
  gapPct: number | null;
  pullbackDepth: number | null;

  isPartiallyExited: boolean;
  partialExitPrice: number | null;
  partialShares: number | null;
}

const tradeLog: TradeLogEntry[] = [];
const openEntries: Map<string, TradeLogEntry> = new Map();

export function logTradeEntry(params: {
  id: string;
  strategy: TradeLogEntry["strategy"];
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTimestamp: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2?: number;
  shares: number;
  dollarRisk: number;
  riskPerShare: number;
  isCapLimited: boolean;
  entryReason: string;
  tier?: string;
  score?: number;
  marketRegime?: string;
  session?: string;
  gapPct?: number;
  pullbackDepth?: number;
}): void {
  const entry: TradeLogEntry = {
    id: params.id,
    strategy: params.strategy,
    symbol: params.symbol,
    direction: params.direction,
    entryTimestamp: new Date(params.entryTimestamp).toISOString(),
    exitTimestamp: null,
    entryPrice: round2(params.entryPrice),
    exitPrice: null,
    stopLoss: round2(params.stopLoss),
    target1: round2(params.target1),
    target2: params.target2 != null ? round2(params.target2) : null,
    shares: params.shares,
    dollarRisk: round2(params.dollarRisk),
    riskPerShare: round4(params.riskPerShare),
    isCapLimited: params.isCapLimited,
    rMultiple: null,
    pnlDollars: null,
    outcome: "open",
    durationMinutes: null,
    entryReason: params.entryReason,
    exitReason: null,
    tier: params.tier ?? null,
    score: params.score ?? null,
    marketRegime: params.marketRegime ?? null,
    session: params.session ?? null,
    mfeR: null,
    maeR: null,
    gapPct: params.gapPct ?? null,
    pullbackDepth: params.pullbackDepth ?? null,
    isPartiallyExited: false,
    partialExitPrice: null,
    partialShares: null,
  };

  openEntries.set(params.id, entry);

  console.log(
    `[TradeLog] ENTRY | ${params.strategy} | ${params.symbol} ${params.direction} @ $${entry.entryPrice} | stop=$${entry.stopLoss} target=$${entry.target1} | ${params.shares}sh risk=$${entry.dollarRisk}${params.isCapLimited ? " [CAP-LIMITED]" : ""} | ${params.entryReason}`,
  );
}

export function logTradeExit(params: {
  id: string;
  symbol: string;
  exitTimestamp: number;
  exitPrice: number;
  exitReason: string;
  rMultiple: number;
  pnlDollars: number;
  mfeR?: number;
  maeR?: number;
  isPartiallyExited?: boolean;
  partialExitPrice?: number;
  partialShares?: number;
}): void {
  const open = openEntries.get(params.id);

  if (!open) {
    console.warn(`[TradeLog] WARNING: logTradeExit called for unknown id="${params.id}" (${params.symbol}) — entry may not have been logged`);
  }

  const entry: TradeLogEntry = open ?? {
    id: params.id,
    strategy: "breakout_retest",
    symbol: params.symbol,
    direction: "LONG",
    entryTimestamp: "",
    exitTimestamp: null,
    entryPrice: 0,
    exitPrice: null,
    stopLoss: 0,
    target1: 0,
    target2: null,
    shares: 0,
    dollarRisk: 0,
    riskPerShare: 0,
    isCapLimited: false,
    rMultiple: null,
    pnlDollars: null,
    outcome: null,
    durationMinutes: null,
    entryReason: "unknown",
    exitReason: null,
    tier: null,
    score: null,
    marketRegime: null,
    session: null,
    mfeR: null,
    maeR: null,
    gapPct: null,
    pullbackDepth: null,
    isPartiallyExited: false,
    partialExitPrice: null,
    partialShares: null,
  };

  const exitTime = new Date(params.exitTimestamp).toISOString();
  const entryMs = entry.entryTimestamp ? new Date(entry.entryTimestamp).getTime() : params.exitTimestamp;
  const durationMinutes = round2((params.exitTimestamp - entryMs) / 60000);

  entry.exitTimestamp = exitTime;
  entry.exitPrice = round2(params.exitPrice);
  entry.exitReason = params.exitReason;
  entry.rMultiple = round3(params.rMultiple);
  entry.pnlDollars = round2(params.pnlDollars);
  entry.outcome = params.pnlDollars > 0 ? "win" : "loss";
  entry.durationMinutes = durationMinutes;
  entry.mfeR = params.mfeR != null ? round3(params.mfeR) : null;
  entry.maeR = params.maeR != null ? round3(params.maeR) : null;
  entry.isPartiallyExited = params.isPartiallyExited ?? false;
  entry.partialExitPrice = params.partialExitPrice != null ? round2(params.partialExitPrice) : null;
  entry.partialShares = params.partialShares ?? null;

  tradeLog.push(entry);
  openEntries.delete(params.id);

  const outcomeStr = entry.outcome === "win" ? "WIN" : "LOSS";
  console.log(
    `[TradeLog] EXIT  | ${entry.strategy} | ${entry.symbol} ${outcomeStr} @ $${entry.exitPrice} | R=${entry.rMultiple} PnL=$${entry.pnlDollars} | MFE=${entry.mfeR ?? "?"}R MAE=${entry.maeR ?? "?"}R | dur=${durationMinutes}min | ${params.exitReason}`,
  );
}

export function getTradeLog(strategy?: string): TradeLogEntry[] {
  if (!strategy || strategy === "all") return [...tradeLog];
  return tradeLog.filter((t) => t.strategy === strategy);
}

export function getTradeLogCSV(strategy?: string): string {
  const entries = getTradeLog(strategy);
  const headers = [
    "id", "strategy", "symbol", "direction",
    "entryTimestamp", "exitTimestamp", "entryPrice", "exitPrice",
    "stopLoss", "target1", "target2",
    "shares", "dollarRisk", "riskPerShare", "isCapLimited",
    "rMultiple", "pnlDollars", "outcome", "durationMinutes",
    "entryReason", "exitReason",
    "tier", "score", "marketRegime", "session",
    "mfeR", "maeR", "gapPct", "pullbackDepth",
    "isPartiallyExited", "partialExitPrice", "partialShares",
  ];

  const rows = entries.map((e) =>
    headers.map((h) => {
      const val = (e as any)[h];
      if (val == null) return "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"')))
        return `"${val.replace(/"/g, '""')}"`;
      return String(val);
    }).join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

export function flushOpenEntries(): number {
  if (openEntries.size > 0) {
    console.warn(`[TradeLog] WARNING: ${openEntries.size} open entries never received an exit call:`);
    for (const [id, entry] of openEntries) {
      console.warn(`  - ${id}: ${entry.symbol} entered at ${entry.entryTimestamp}`);
    }
  }
  const orphanCount = openEntries.size;
  openEntries.clear();
  return orphanCount;
}

export function resetTradeLog(): void {
  tradeLog.length = 0;
  openEntries.clear();
}

export function getTradeLogCount(): number {
  return tradeLog.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
