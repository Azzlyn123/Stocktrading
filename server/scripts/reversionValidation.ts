const VALIDATION_DATES = [
  "2026-02-03",
  "2026-02-04",
  "2026-02-05",
  "2026-02-06",
  "2026-02-09",
  "2026-02-10",
  "2026-02-11",
  "2026-02-12",
  "2026-02-13",
];

const TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "META"];
const BASE_URL = "http://localhost:5000";

interface SimRun {
  id: string;
  status: string;
  tradesGenerated?: number;
  totalPnl?: number;
  winRate?: number;
  maxDrawdown?: number;
  errorMessage?: string;
  analyticsJson?: any;
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demo", password: "demo123" }),
    redirect: "manual",
  });

  const cookies = res.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c: string) => c.startsWith("connect.sid="));
  if (!sessionCookie) {
    const text = await res.text();
    throw new Error(`Login failed: ${res.status} ${text}`);
  }
  return sessionCookie.split(";")[0];
}

async function startReversion(cookie: string, date: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/simulations/reversion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ simulationDate: date, tickers: TICKERS }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Start failed: ${res.status} ${text}`);
  }

  const data = await res.json() as SimRun;
  return data.id;
}

async function pollSimulation(cookie: string, runId: string): Promise<SimRun> {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE_URL}/api/simulations/${runId}`, {
      headers: { Cookie: cookie },
    });
    if (!res.ok) continue;
    const data = await res.json() as SimRun;
    if (data.status === "completed" || data.status === "failed") {
      return data;
    }
  }
  throw new Error("Simulation timed out after 4 minutes");
}

async function main() {
  console.log("=== VWAP Reversion 9-Day Validation ===");
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`Dates: ${VALIDATION_DATES[0]} to ${VALIDATION_DATES[VALIDATION_DATES.length - 1]}`);

  const cookie = await login();
  console.log("Authenticated successfully\n");

  const results: Array<{
    date: string;
    trades: number;
    winRate: number;
    netPnl: number;
    maxDD: number;
    analytics: any;
  }> = [];

  for (const date of VALIDATION_DATES) {
    console.log(`--- Running ${date} ---`);
    try {
      const runId = await startReversion(cookie, date);
      console.log(`  Started run ${runId}, polling...`);
      const result = await pollSimulation(cookie, runId);

      if (result.status === "failed") {
        console.log(`  FAILED: ${result.errorMessage}`);
        results.push({ date, trades: 0, winRate: 0, netPnl: 0, maxDD: 0, analytics: null });
        continue;
      }

      const trades = result.tradesGenerated ?? 0;
      const pnl = result.totalPnl ?? 0;
      const wr = result.winRate ?? 0;
      const dd = result.maxDrawdown ?? 0;
      const analytics = result.analyticsJson;

      console.log(`  ${trades} trades | WR=${(wr * 100).toFixed(1)}% | Net=$${pnl.toFixed(2)} | MaxDD=$${dd.toFixed(2)}`);
      results.push({ date, trades, winRate: wr, netPnl: pnl, maxDD: dd, analytics });
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ date, trades: 0, winRate: 0, netPnl: 0, maxDD: 0, analytics: null });
    }
  }

  console.log("\n========================================");
  console.log("        VALIDATION SUMMARY");
  console.log("========================================");

  const totalTrades = results.reduce((s, r) => s + r.trades, 0);
  const totalNetPnl = results.reduce((s, r) => s + r.netPnl, 0);
  const avgWinRate = results.filter((r) => r.trades > 0).length > 0
    ? results.filter((r) => r.trades > 0).reduce((s, r) => s + r.winRate, 0) / results.filter((r) => r.trades > 0).length
    : 0;
  const worstDD = Math.max(...results.map((r) => r.maxDD));

  console.log(`Total trades:     ${totalTrades}`);
  console.log(`Avg win rate:     ${(avgWinRate * 100).toFixed(1)}%`);
  console.log(`Net PnL:          $${totalNetPnl.toFixed(2)}`);
  console.log(`Worst drawdown:   $${worstDD.toFixed(2)}`);

  console.log("\n--- Per-day breakdown ---");
  for (const r of results) {
    console.log(
      `  ${r.date}: ${r.trades}T WR=${(r.winRate * 100).toFixed(1)}% Net=$${r.netPnl.toFixed(2)} DD=$${r.maxDD.toFixed(2)}`,
    );
  }

  console.log("\n--- Breakout baseline comparison ---");
  console.log("Breakout 3mo: -0.309R expectancy, 12% win rate, 108 trades");
  console.log(`Reversion 9d: ${(avgWinRate * 100).toFixed(1)}% win rate, ${totalTrades} trades, Net=$${totalNetPnl.toFixed(2)}`);

  console.log("\n=== Validation complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
