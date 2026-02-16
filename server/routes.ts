import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import passport from "passport";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { insertUserSchema, settingsUpdateSchema } from "@shared/schema";
import type { User } from "@shared/schema";
import { startSimulatedDataFeed, registerUser, unregisterUser, getScannerData, getDataSource, isLiveConnected, getSharedUserId } from "./simulator";
import { seedDemoData } from "./seed";
import { generateAdaptiveInsights } from "./strategy/learning";
import { runHistoricalSimulation, runReversionSimulation, runORFSimulation, runRSContinuationSimulation, runGapContinuationSimulation, runSmallCapMomentumSimulation, getActiveSimulations, cancelSimulation, startAutoRun, getAutoRunStatus, cancelAutoRun, runCostSensitivity, runWalkForwardEvaluation, getWalkForwardStatus, cancelWalkForward, type BarsCache } from "./historicalSimulator";
import { DEFAULT_RS_CONFIG, type RSConfig } from "./strategy/rsDetector";
import { DEFAULT_GAP_CONFIG, type GapConfig } from "./strategy/gapDetector";
import { DEFAULT_SMALLCAP_CONFIG } from "./strategy/smallCapScanner";
import { DEFAULT_PULLBACK_CONFIG } from "./strategy/pullbackDetector";
import { SMALLCAP_SCAN_TICKERS, buildScanDatesRange } from "./strategy/smallCapUniverse";
import { fetchMultiDayDailyBars, fetchForwardDailyBars } from "./alpaca";

declare global {
  namespace Express {
    interface User {
      id: string;
      username: string;
      password: string;
      email: string | null;
      accountSize: number | null;
      paperMode: boolean | null;
      maxDailyLossPct: number | null;
      maxLosingTrades: number | null;
      cooldownMinutes: number | null;
      perTradeRiskPct: number | null;
      maxPositionPct: number | null;
      resistanceBars: number | null;
      breakoutBuffer: number | null;
      retestBuffer: number | null;
      volumeMultiplier: number | null;
      atrPeriod: number | null;
      trailingAtrMultiplier: number | null;
      minPrice: number | null;
      minAvgVolume: number | null;
      minDollarVolume: number | null;
      avoidEarnings: boolean | null;
      lunchChopFilter: boolean | null;
      lunchChopStart: string | null;
      lunchChopEnd: string | null;
      timeStopEnabled: boolean | null;
      timeStopMinutes: number | null;
      timeStopR: number | null;
      partialExitPct: number | null;
      partialExitR: number | null;
      mainTargetRMin: number | null;
      mainTargetRMax: number | null;
      earningsGapPct: number | null;
      earningsRvolMin: number | null;
      maxSpreadPct: number | null;
      minDailyATRpct: number | null;
      minRVOL: number | null;
      rvolCutoffMinutes: number | null;
      htfConfirmations: number | null;
      breakoutMinBodyPct: number | null;
      breakoutMinRangeMultiplier: number | null;
      retestMaxPullbackPct: number | null;
      entryMode: string | null;
      maxVwapCrosses: number | null;
      chopSizeReduction: number | null;
      volGateFirstRangePct: number | null;
      volGateAtrMultiplier: number | null;
      scoreFullSizeMin: number | null;
      scoreHalfSizeMin: number | null;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  const walkForwardResults = new Map<string, any>();

  // Auth routes
  app.post("/api/register", async (req, res, next) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input" });
      }
      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const user = await storage.createUser(parsed.data);
      req.login(user, async (err) => {
        if (err) return next(err);
        registerUser(user.id);
        try {
          await seedDemoData(user.id);
        } catch (e) {
          console.error("Seed error:", e);
        }
        const { password, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (err) => {
        if (err) return next(err);
        registerUser(user.id);
        const { password, ...safeUser } = user;
        res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res) => {
    req.logout(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    registerUser(req.user!.id);
    const { password, ...safeUser } = req.user!;
    res.json(safeUser);
  });

  // Settings
  app.patch("/api/settings", requireAuth, async (req, res, next) => {
    try {
      const parsed = settingsUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings" });
      }
      const user = await storage.updateUserSettings(req.user!.id, parsed.data);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (err) {
      next(err);
    }
  });

  // Watchlist (shared across all users)
  app.get("/api/watchlist", requireAuth, async (req, res) => {
    const items = await storage.getAllWatchlist();
    res.json(items);
  });

  app.post("/api/watchlist", requireAuth, async (req, res, next) => {
    try {
      const { ticker, name, sector } = req.body;
      if (!ticker) return res.status(400).json({ message: "Ticker required" });
      const item = await storage.addWatchlistItem({
        userId: req.user!.id,
        ticker: ticker.toUpperCase(),
        name: name || null,
        sector: sector || null,
        isActive: true,
      });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/watchlist/:id", requireAuth, async (req, res) => {
    await storage.removeWatchlistItemGlobal(req.params.id as string);
    res.json({ ok: true });
  });

  // Signals (shared across all users)
  app.get("/api/signals", requireAuth, async (req, res) => {
    const items = await storage.getAllSignals();
    res.json(items);
  });

  // Alerts (shared across all users)
  app.get("/api/alerts", requireAuth, async (req, res) => {
    const items = await storage.getAllAlerts();
    res.json(items);
  });

  app.post("/api/alerts/mark-read", requireAuth, async (req, res) => {
    await storage.markAllAlertsRead();
    res.json({ ok: true });
  });

  // Paper Trades (shared across all users)
  app.get("/api/trades", requireAuth, async (req, res) => {
    const items = await storage.getAllTrades();
    res.json(items);
  });

  // Daily Summaries (shared across all users)
  app.get("/api/summaries", requireAuth, async (req, res) => {
    const items = await storage.getAllSummaries();
    res.json(items);
  });

  // Scanner data (shared across all users - uses shared user's settings)
  app.get("/api/scanner", requireAuth, async (req, res) => {
    const sharedId = getSharedUserId();
    const scannerUser = sharedId ? await storage.getUser(sharedId) : null;
    const su = scannerUser ?? req.user!;
    const data = getScannerData({
      minPrice: su.minPrice ?? 15,
      minAvgVolume: su.minAvgVolume ?? 2000000,
      minDollarVolume: su.minDollarVolume ?? 50000000,
    });
    res.json(data);
  });

  // Learning Insights (shared across all users)
  app.get("/api/lessons", requireAuth, async (req, res) => {
    const lessons = await storage.getLessons();
    res.json(lessons);
  });

  app.get("/api/lessons/insights", requireAuth, async (req, res) => {
    const lessons = await storage.getLessons();
    const insights = generateAdaptiveInsights(
      lessons.map(l => ({
        ticker: l.ticker,
        tier: l.tier,
        outcomeCategory: l.outcomeCategory,
        lessonTags: l.lessonTags,
        marketContext: l.marketContext,
        pnl: l.pnl,
        scoreAtEntry: l.scoreAtEntry,
        exitReason: l.exitReason,
        durationMinutes: l.durationMinutes,
        rMultiple: l.rMultiple,
      }))
    );
    res.json({ lessons, insights });
  });

  // Historical simulation routes
  app.get("/api/simulations", requireAuth, async (req, res) => {
    const userId = (req.user as User).id;
    const runs = await storage.getSimulationRuns(userId);
    res.json(runs);
  });

  app.get("/api/simulations/active/list", requireAuth, (_req, res) => {
    res.json(getActiveSimulations());
  });

  app.get("/api/simulations/auto-run/status", requireAuth, (_req, res) => {
    const status = getAutoRunStatus();
    res.json(status);
  });

  app.get("/api/simulations/:id", requireAuth, async (req, res) => {
    const run = await storage.getSimulationRun(req.params.id as string);
    if (!run) return res.status(404).json({ error: "Simulation not found" });
    res.json(run);
  });

  app.post("/api/simulations", requireAuth, async (req, res) => {
    const userId = (req.user as User).id;
    const { simulationDate, tickers } = req.body;

    if (!simulationDate || typeof simulationDate !== "string") {
      return res.status(400).json({ error: "simulationDate is required (YYYY-MM-DD)" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(simulationDate)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    const today = new Date();
    const simDate = new Date(simulationDate + "T12:00:00Z");
    if (simDate >= today) {
      return res.status(400).json({ error: "Simulation date must be in the past." });
    }

    const run = await storage.createSimulationRun({
      userId,
      simulationDate,
      status: "pending",
      tickers: tickers ?? null,
    });

    runHistoricalSimulation(
      run.id,
      simulationDate,
      userId,
      storage,
      tickers && tickers.length > 0 ? tickers : undefined
    ).catch((err) => {
      console.error("Historical simulation error:", err);
    });

    res.status(201).json(run);
  });

  app.post("/api/simulations/reversion", requireAuth, async (req, res) => {
    const userId = (req.user as User).id;
    const { simulationDate, tickers, reversionConfig } = req.body;

    if (!simulationDate || typeof simulationDate !== "string") {
      return res.status(400).json({ error: "simulationDate is required (YYYY-MM-DD)" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(simulationDate)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    const today = new Date();
    const simDate = new Date(simulationDate + "T12:00:00Z");
    if (simDate >= today) {
      return res.status(400).json({ error: "Simulation date must be in the past." });
    }

    const run = await storage.createSimulationRun({
      userId,
      simulationDate,
      status: "pending",
      tickers: tickers ?? null,
    });

    runReversionSimulation(
      run.id,
      simulationDate,
      userId,
      storage,
      tickers && tickers.length > 0 ? tickers : undefined,
      { reversionConfig },
    ).catch((err) => {
      console.error("Reversion simulation error:", err);
    });

    res.status(201).json(run);
  });

  app.post("/api/simulations/:id/cancel", requireAuth, async (req, res) => {
    const cancelled = cancelSimulation(req.params.id as string);
    if (!cancelled) return res.status(404).json({ error: "Simulation not found or already completed" });
    res.json({ success: true });
  });

  app.post("/api/simulations/auto-run", requireAuth, async (req, res) => {
    const userId = (req.user as User).id;
    const { durationMinutes, exactDays } = req.body;
    const duration = Math.min(Math.max(Number(durationMinutes) || 5, 1), 15);
    const days = exactDays ? Math.min(Math.max(Number(exactDays), 1), 30) : undefined;
    const result = await startAutoRun(userId, duration, storage, days);
    if (!result.started) {
      return res.status(409).json({ error: result.message });
    }
    res.json(result);
  });

  app.post("/api/simulations/auto-run/cancel", requireAuth, (_req, res) => {
    const cancelled = cancelAutoRun();
    if (!cancelled) return res.status(404).json({ error: "No active auto-run to cancel" });
    res.json({ success: true });
  });

  app.post("/api/simulations/:id/cost-sensitivity", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const simulationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await runCostSensitivity(simulationId, user.id, storage);
      if ("error" in result) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      console.error("Cost sensitivity error:", err);
      res.status(500).json({ error: err.message || "Cost sensitivity analysis failed" });
    }
  });

  app.post("/api/walk-forward", requireAuth, async (req, res) => {
    const { trainDays = 60, testDays = 10, totalWindows = 3 } = req.body;

    if (trainDays < 5 || trainDays > 200) {
      return res.status(400).json({ error: "trainDays must be between 5 and 200" });
    }
    if (testDays < 3 || testDays > 60) {
      return res.status(400).json({ error: "testDays must be between 3 and 60" });
    }
    if (totalWindows < 1 || totalWindows > 10) {
      return res.status(400).json({ error: "totalWindows must be between 1 and 10" });
    }

    const userId = (req.user as User).id;

    runWalkForwardEvaluation(userId, trainDays, testDays, totalWindows, storage)
      .then(result => {
        walkForwardResults.set(userId, result);
      })
      .catch(err => {
        walkForwardResults.set(userId, { error: err.message });
      });

    res.json({ started: true, message: `Walk-forward evaluation started: ${totalWindows} windows, ${trainDays} train / ${testDays} test days each` });
  });

  app.get("/api/walk-forward/status", requireAuth, (_req, res) => {
    const status = getWalkForwardStatus();
    res.json(status || { active: false });
  });

  app.get("/api/walk-forward/results", requireAuth, (req, res) => {
    const userId = (req.user as User).id;
    const result = walkForwardResults.get(userId);
    if (!result) {
      return res.json(null);
    }
    res.json(result);
  });

  app.post("/api/walk-forward/cancel", requireAuth, (_req, res) => {
    const cancelled = cancelWalkForward();
    res.json({ cancelled });
  });

  app.post("/api/simulations/reset", requireAuth, async (_req, res) => {
    try {
      const result = await storage.resetAllSimulationData();
      res.json({ success: true, deleted: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to reset simulation data" });
    }
  });

  // Data source status
  app.get("/api/data-source", requireAuth, (_req, res) => {
    res.json({
      source: getDataSource(),
      liveConnected: isLiveConnected(),
    });
  });

  // WebSocket setup
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "connected", data: { timestamp: Date.now() } }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "identify" && msg.data?.userId) {
          registerUser(msg.data.userId);
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  function broadcast(type: string, data: any) {
    const msg = JSON.stringify({ type, data });
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  app.get("/api/analytics/daily-report", requireAuth, (req, res) => {
    const { getTodayTrades, getTradesByDate, getAllTrades, getTradeCount } = require("./analytics/tradeStore");
    const { buildDailySummary, formatDailySummary } = require("./analytics/tradeAnalytics");
    const dateParam = req.query.date as string | undefined;
    const trades = dateParam ? getTradesByDate(dateParam) : getTodayTrades();
    const summary = buildDailySummary(trades);
    res.json({
      summary,
      formatted: formatDailySummary(summary),
      trades,
      totalTracked: getTradeCount(),
    });
  });

  app.post("/api/simulations/orf", requireAuth, async (req, res) => {
    const userId = (req.user as User).id;
    const { simulationDate, tickers, orfConfig } = req.body;

    if (!simulationDate || typeof simulationDate !== "string") {
      return res.status(400).json({ error: "simulationDate is required (YYYY-MM-DD)" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(simulationDate)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    const today = new Date();
    const simDate = new Date(simulationDate + "T12:00:00Z");
    if (simDate >= today) {
      return res.status(400).json({ error: "Simulation date must be in the past." });
    }

    const run = await storage.createSimulationRun({
      userId,
      simulationDate,
      status: "pending",
      tickers: tickers ?? null,
    });

    runORFSimulation(
      run.id,
      simulationDate,
      userId,
      storage,
      tickers && tickers.length > 0 ? tickers : undefined,
      { orfConfig },
    ).catch((err) => {
      console.error("ORF simulation error:", err);
    });

    res.status(201).json(run);
  });

  app.post("/api/internal/orf-validate", async (req, res) => {
    const { dates, tickers, orfConfig } = req.body;
    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({ error: "dates array required" });
    }
    const tickerList = tickers ?? ["AAPL", "MSFT", "NVDA", "TSLA", "META"];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    const results: any[] = [];

    for (const date of dates) {
      try {
        const dummyRunId = `orf-validation-${date}-${Date.now()}`;
        const result = await runORFSimulation(
          dummyRunId,
          date,
          userId,
          storage,
          tickerList,
          { dryRun: true, orfConfig: orfConfig ?? undefined },
        );
        results.push({ date, ...(result as any) });
      } catch (err: any) {
        results.push({ date, error: err.message, trades: 0, wins: 0, losses: 0, netPnl: 0 });
      }
    }

    res.json({ results });
  });

  app.post("/api/internal/reversion-validate", async (req, res) => {
    const { dates, tickers, reversionConfig } = req.body;
    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({ error: "dates array required" });
    }
    const tickerList = tickers ?? ["AAPL", "MSFT", "NVDA", "TSLA", "META"];

    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    const results: any[] = [];

    for (const date of dates) {
      try {
        const dummyRunId = `validation-${date}-${Date.now()}`;
        const result = await runReversionSimulation(
          dummyRunId,
          date,
          userId,
          storage,
          tickerList,
          { dryRun: true, reversionConfig: reversionConfig ?? undefined },
        );
        results.push({ date, ...(result as any) });
      } catch (err: any) {
        results.push({ date, error: err.message, trades: 0, wins: 0, losses: 0, netPnl: 0 });
      }
    }

    res.json({ results });
  });

  app.post("/api/internal/rs-phase-a", async (req, res) => {
    const { tickers } = req.body;
    const dates = [
      "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09",
      "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13"
    ];
    const tickerList = tickers ?? [
      "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","AVGO",
      "JPM","COST","QQQ","CRM","ORCL",
    ];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    const runVariant = async (config: Partial<RSConfig>) => {
      const results: any[] = [];
      for (const date of dates) {
        try {
          const result = await runRSContinuationSimulation(
            `phase-a-${date}-${Date.now()}`,
            date,
            userId,
            storage,
            tickerList,
            { dryRun: true, rsConfig: { ...DEFAULT_RS_CONFIG, ...config } },
          );
          results.push({ date, ...(result as any) });
        } catch (err: any) {
          results.push({ date, error: err.message });
        }
      }
      return results;
    };

    const v1Results = await runVariant({ noTarget: false, noPartial: false });
    const v2Results = await runVariant({ noTarget: true, noPartial: false });
    const v3Results = await runVariant({ noTarget: true, noPartial: true });

    const aggregate = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const lossBuckets: Record<string, number> = {
        "stopped_before_0.3R": 0,
        "reversed_after_0.3R": 0,
        "partial_then_scratch": 0,
        "other": 0
      };
      
      let mfe1R = 0, mfe15R = 0, mfe2R = 0;

      for (const day of results) {
        if (day.error || !day.tradeRs) continue;
        trades += day.trades ?? 0;
        wins += day.wins ?? 0;
        totalR += (day.tradeRs as number[]).reduce((a, b) => a + b, 0);
        allRs.push(...day.tradeRs);
        if (day.tradeMFEs) {
          allMFEs.push(...day.tradeMFEs);
          for (const mfe of day.tradeMFEs) {
            if (mfe >= 1.0) mfe1R++;
            if (mfe >= 1.5) mfe15R++;
            if (mfe >= 2.0) mfe2R++;
          }
        }
        if (day.tradeMAEs) allMAEs.push(...day.tradeMAEs);
        if (day.tradeLossBuckets) {
          for (const bucket of day.tradeLossBuckets) {
            if (lossBuckets[bucket] !== undefined) lossBuckets[bucket]++;
            else lossBuckets.other++;
          }
        }
      }
      
      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;

      return {
        trades,
        winRate: trades > 0 ? (wins / trades * 100).toFixed(1) + "%" : "0%",
        avgR: trades > 0 ? (totalR / trades).toFixed(3) : "0",
        medianMFE: medianMFE.toFixed(3),
        medianMAE: medianMAE.toFixed(3),
        mfeDist: {
          ge1R: trades > 0 ? (mfe1R / trades * 100).toFixed(1) + "%" : "0%",
          ge15R: trades > 0 ? (mfe15R / trades * 100).toFixed(1) + "%" : "0%",
          ge2R: trades > 0 ? (mfe2R / trades * 100).toFixed(1) + "%" : "0%"
        },
        lossDecomp: lossBuckets
      };
    };

    res.json({
      variant1: aggregate(v1Results),
      variant2: aggregate(v2Results),
      variant3: aggregate(v3Results),
      dates
    });
  });

  app.post("/api/internal/rs-phase-b", async (req, res) => {
    const { tickers } = req.body;
    const devDates = [
      "2025-12-01", "2025-12-02", "2025-12-03", "2025-12-04", "2025-12-05",
      "2025-12-08", "2025-12-09", "2025-12-10", "2025-12-11", "2025-12-12",
      "2025-12-15", "2025-12-16", "2025-12-17", "2025-12-18", "2025-12-19",
      "2025-12-22", "2025-12-23", "2025-12-24", "2025-12-26", "2025-12-29",
      "2025-12-30", "2025-12-31",
      "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08",
      "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15",
      "2026-01-16", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23",
      "2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30"
    ];
    const testDates = [
      "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06",
      "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13"
    ];

    const tickerList = tickers ?? [
      "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","AVGO",
      "JPM","COST","QQQ","CRM","ORCL",
    ];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    const aggregate = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const lossBuckets: Record<string, number> = {
        "stopped_before_0.3R": 0,
        "reversed_after_0.3R": 0,
        "partial_then_scratch": 0,
        "other": 0
      };
      
      let mfe1R = 0, mfe15R = 0, mfe2R = 0;

      for (const day of results) {
        if (day.error || !day.tradeRs) continue;
        trades += day.trades ?? 0;
        wins += day.wins ?? 0;
        totalR += (day.tradeRs as number[]).reduce((a, b) => a + b, 0);
        allRs.push(...day.tradeRs);
        if (day.tradeMFEs) {
          allMFEs.push(...day.tradeMFEs);
          for (const mfe of day.tradeMFEs) {
            if (mfe >= 1.0) mfe1R++;
            if (mfe >= 1.5) mfe15R++;
            if (mfe >= 2.0) mfe2R++;
          }
        }
        if (day.tradeMAEs) allMAEs.push(...day.tradeMAEs);
        if (day.tradeLossBuckets) {
          for (const bucket of day.tradeLossBuckets) {
            if (lossBuckets[bucket] !== undefined) lossBuckets[bucket]++;
            else lossBuckets.other++;
          }
        }
      }
      
      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;

      return {
        trades,
        winRate: trades > 0 ? (wins / trades * 100).toFixed(1) + "%" : "0%",
        avgR: trades > 0 ? (totalR / trades).toFixed(3) : "0",
        medianMFE: medianMFE.toFixed(3),
        medianMAE: medianMAE.toFixed(3),
        mfeDist: {
          ge1R: trades > 0 ? (mfe1R / trades * 100).toFixed(1) + "%" : "0%",
          ge15R: trades > 0 ? (mfe15R / trades * 100).toFixed(1) + "%" : "0%",
          ge2R: trades > 0 ? (mfe2R / trades * 100).toFixed(1) + "%" : "0%"
        },
        lossDecomp: lossBuckets
      };
    };

    const runVariantOnDates = async (config: Partial<RSConfig>, dates: string[]) => {
      const results: any[] = [];
      for (const date of dates) {
        try {
          const result = await runRSContinuationSimulation(
            `phase-b-${date}-${Date.now()}`,
            date,
            userId,
            storage,
            tickerList,
            { dryRun: true, rsConfig: { ...DEFAULT_RS_CONFIG, ...config } },
          );
          results.push({ date, ...(result as any) });
        } catch (err: any) {
          results.push({ date, error: err.message });
        }
      }
      return results;
    };

    const runFullValidation = async (config: Partial<RSConfig>) => {
      const devRes = await runVariantOnDates(config, devDates);
      const testRes = await runVariantOnDates(config, testDates);
      return {
        dev: aggregate(devRes),
        test: aggregate(testRes)
      };
    };

    const v1 = await runFullValidation({ noTarget: false, noPartial: false });
    const v2 = await runFullValidation({ noTarget: true, noPartial: false });
    const v3 = await runFullValidation({ noTarget: true, noPartial: true });

    res.header('Content-Type', 'application/json');
    res.send(JSON.stringify({
      v1, v2, v3,
      windows: { dev: devDates.length, test: testDates.length }
    }));
  });

  app.post("/api/internal/rs-validate", async (req, res) => {
    const { dates, tickers, rsConfig } = req.body;
    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({ error: "dates array required" });
    }
    const tickerList = tickers ?? [
      "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","AVGO",
      "JPM","COST","QQQ","CRM","ORCL",
    ];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    const results: any[] = [];

    for (const date of dates) {
      try {
        const dummyRunId = `rs-validation-${date}-${Date.now()}`;
        const result = await runRSContinuationSimulation(
          dummyRunId,
          date,
          userId,
          storage,
          tickerList,
          { dryRun: true, rsConfig: rsConfig ?? undefined },
        );
        results.push({ date, ...(result as any) });
      } catch (err: any) {
        results.push({ date, error: err.message, trades: 0, wins: 0, losses: 0, netPnl: 0 });
      }
    }

    const allRs: number[] = [];
    const allMFEs: number[] = [];
    const allMAEs: number[] = [];
    let totalTrades = 0, totalWins = 0;
    const bySymbol: Record<string, { trades: number; rs: number[]; wins: number }> = {};
    const byRegime: Record<string, { trades: number; totalR: number; wins: number }> = {};

    for (const day of results) {
      if (day.error || !day.tradeRs) continue;
      totalTrades += day.trades ?? 0;
      totalWins += day.wins ?? 0;
      const tradeCount = day.tradeRs?.length ?? 0;
      for (let i = 0; i < tradeCount; i++) {
        const r = day.tradeRs[i];
        allRs.push(r);
        if (day.tradeMFEs && i < day.tradeMFEs.length) allMFEs.push(day.tradeMFEs[i]);
        if (day.tradeMAEs && i < day.tradeMAEs.length) allMAEs.push(day.tradeMAEs[i]);
        const ticker = day.tradeTickers && i < day.tradeTickers.length ? day.tradeTickers[i] : undefined;
        const regime = day.tradeRegimes && i < day.tradeRegimes.length ? day.tradeRegimes[i] : undefined;
        if (ticker) {
          if (!bySymbol[ticker]) bySymbol[ticker] = { trades: 0, rs: [], wins: 0 };
          bySymbol[ticker].trades++;
          bySymbol[ticker].rs.push(r);
          if (r > 0) bySymbol[ticker].wins++;
        }
        if (regime) {
          if (!byRegime[regime]) byRegime[regime] = { trades: 0, totalR: 0, wins: 0 };
          byRegime[regime].trades++;
          byRegime[regime].totalR += r;
          if (r > 0) byRegime[regime].wins++;
        }
      }
    }

    const avgR = allRs.length > 0 ? allRs.reduce((a, b) => a + b, 0) / allRs.length : 0;
    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
    const avgMFE = allMFEs.length > 0 ? allMFEs.reduce((a, b) => a + b, 0) / allMFEs.length : 0;
    const avgMAE = allMAEs.length > 0 ? allMAEs.reduce((a, b) => a + b, 0) / allMAEs.length : 0;
    const medianMFE = allMFEs.length > 0 ? [...allMFEs].sort((a, b) => a - b)[Math.floor(allMFEs.length / 2)] : 0;

    const symbolSummary: Record<string, any> = {};
    for (const [sym, data] of Object.entries(bySymbol)) {
      const symAvgR = data.rs.length > 0 ? data.rs.reduce((a, b) => a + b, 0) / data.rs.length : 0;
      symbolSummary[sym] = { trades: data.trades, avgR: Number(symAvgR.toFixed(3)), winRate: Number((data.wins / data.trades).toFixed(3)) };
    }

    const regimeSummary: Record<string, any> = {};
    for (const [reg, data] of Object.entries(byRegime)) {
      regimeSummary[reg] = { trades: data.trades, avgR: Number((data.totalR / data.trades).toFixed(3)), winRate: Number((data.wins / data.trades).toFixed(3)) };
    }

    res.json({
      strategy: "RS_CONTINUATION",
      config: { ...DEFAULT_RS_CONFIG, ...(rsConfig ?? {}) },
      aggregate: {
        totalTrades,
        winRate: Number(winRate.toFixed(3)),
        avgR: Number(avgR.toFixed(3)),
        avgMFE: Number(avgMFE.toFixed(3)),
        medianMFE: Number(medianMFE.toFixed(3)),
        avgMAE: Number(avgMAE.toFixed(3)),
      },
      bySymbol: symbolSummary,
      byRegime: regimeSummary,
      results,
    });
  });

  app.post("/api/internal/gap-phase-a", async (req, res) => {
    const { tickers, gapConfig: userGapConfig, dates: userDates } = req.body;
    const defaultDates = [
      "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09",
      "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13"
    ];
    const dates: string[] = (userDates && Array.isArray(userDates) && userDates.length > 0) ? userDates : defaultDates;
    const tickerList = tickers ?? [
      "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","AVGO",
      "JPM","COST","QQQ","CRM","ORCL",
    ];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";
    const gapCfg: Partial<GapConfig> = userGapConfig ?? {};

    const aggregate = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const lossBuckets: Record<string, number> = {
        "stopped_before_0.3R": 0,
        "reversed_after_0.3R": 0,
        "partial_then_scratch": 0,
        "other": 0
      };
      let mfe1R = 0, mfe15R = 0, mfe2R = 0;
      const bySymbol: Record<string, { trades: number; rs: number[]; wins: number }> = {};
      const byDirection: Record<string, { trades: number; totalR: number; wins: number }> = {};

      for (const day of results) {
        if (day.error || !day.tradeRs) continue;
        trades += day.trades ?? 0;
        wins += day.wins ?? 0;
        totalR += (day.tradeRs as number[]).reduce((a: number, b: number) => a + b, 0);
        allRs.push(...day.tradeRs);
        if (day.tradeMFEs) {
          allMFEs.push(...day.tradeMFEs);
          for (const mfe of day.tradeMFEs) {
            if (mfe >= 1.0) mfe1R++;
            if (mfe >= 1.5) mfe15R++;
            if (mfe >= 2.0) mfe2R++;
          }
        }
        if (day.tradeMAEs) allMAEs.push(...day.tradeMAEs);
        if (day.tradeLossBuckets) {
          for (const bucket of day.tradeLossBuckets) {
            if (lossBuckets[bucket] !== undefined) lossBuckets[bucket]++;
            else lossBuckets.other++;
          }
        }
        if (day.tradeTickers && day.tradeRs) {
          for (let i = 0; i < day.tradeTickers.length; i++) {
            const sym = day.tradeTickers[i];
            const r = day.tradeRs[i] ?? 0;
            if (!bySymbol[sym]) bySymbol[sym] = { trades: 0, rs: [], wins: 0 };
            bySymbol[sym].trades++;
            bySymbol[sym].rs.push(r);
            if (r > 0) bySymbol[sym].wins++;
          }
        }
        if (day.byTier) {
          for (const [tier, data] of Object.entries(day.byTier as Record<string, any>)) {
            const dir = tier.includes("long") ? "LONG" : "SHORT";
            if (!byDirection[dir]) byDirection[dir] = { trades: 0, totalR: 0, wins: 0 };
            byDirection[dir].trades += data.wins + data.losses;
            byDirection[dir].totalR += data.pnl;
            byDirection[dir].wins += data.wins;
          }
        }
      }

      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;

      const symbolSummary: Record<string, any> = {};
      for (const [sym, data] of Object.entries(bySymbol)) {
        const symAvgR = data.rs.length > 0 ? data.rs.reduce((a, b) => a + b, 0) / data.rs.length : 0;
        symbolSummary[sym] = { trades: data.trades, avgR: Number(symAvgR.toFixed(3)), winRate: Number((data.wins / data.trades).toFixed(3)) };
      }

      return {
        trades,
        winRate: trades > 0 ? (wins / trades * 100).toFixed(1) + "%" : "0%",
        avgR: trades > 0 ? (totalR / trades).toFixed(3) : "0",
        medianMFE: medianMFE.toFixed(3),
        medianMAE: medianMAE.toFixed(3),
        mfeDist: {
          ge1R: trades > 0 ? (mfe1R / trades * 100).toFixed(1) + "%" : "0%",
          ge15R: trades > 0 ? (mfe15R / trades * 100).toFixed(1) + "%" : "0%",
          ge2R: trades > 0 ? (mfe2R / trades * 100).toFixed(1) + "%" : "0%"
        },
        lossDecomp: lossBuckets,
        bySymbol: symbolSummary,
        byDirection
      };
    };

    const runVariantOnDates = async (variantB: boolean, variantDates: string[]) => {
      const results: any[] = [];
      for (const date of variantDates) {
        try {
          let forwardDailyBars: Map<string, any[]> | undefined;
          if (variantB) {
            forwardDailyBars = await fetchForwardDailyBars(
              Array.from(new Set([...tickerList, "SPY"])),
              date,
              gapCfg.variantB_maxHoldDays ?? 3
            );
          }
          const result = await runGapContinuationSimulation(
            `gap-phase-a-${date}-${Date.now()}`,
            date,
            userId,
            storage,
            tickerList,
            { dryRun: true, gapConfig: gapCfg, variantB, forwardDailyBars },
          );
          results.push({ date, ...(result as any) });
        } catch (err: any) {
          results.push({ date, error: err?.message ?? String(err), trades: 0, tradeRs: [] });
        }
      }
      return results;
    };

    const variantAResults = await runVariantOnDates(false, dates);
    const variantBResults = await runVariantOnDates(true, dates);

    res.json({
      strategy: "GAP_CONTINUATION",
      config: { ...DEFAULT_GAP_CONFIG, ...gapCfg },
      variantA: aggregate(variantAResults),
      variantB: aggregate(variantBResults),
      dates,
      rawA: variantAResults,
      rawB: variantBResults,
    });
  });

  app.post("/api/internal/orf-walkforward", async (req, res) => {
    const { devDates, testDates, tickers, orfConfig } = req.body;
    if (!devDates || !Array.isArray(devDates) || !testDates || !Array.isArray(testDates)) {
      return res.status(400).json({ error: "devDates and testDates arrays required" });
    }
    const tickerList = tickers ?? [
      "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","AMD","NFLX","SPY",
      "QQQ","AVGO","CRM","ORCL","COIN",
    ];
    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";

    function aggregateWindow(dayResults: any[]) {
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const allHit1R: number[] = [];
      const allHitTarget: number[] = [];
      const allSlipR: number[] = [];
      const allScratch: number[] = [];
      const allTickers: string[] = [];
      const allRegimes: string[] = [];
      let totalTrades = 0, totalWins = 0, totalLosses = 0;
      let totalGrossPnl = 0, totalNetPnl = 0, totalComm = 0, totalSlip = 0;
      const byRegime: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = {};
      const bySymbol: Record<string, { wins: number; losses: number; pnl: number; trades: number; rs: number[] }> = {};
      const byDayOfWeek: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = {};
      const dailyPnls: { date: string; trades: number; netPnl: number; avgR: number }[] = [];

      for (const day of dayResults) {
        if (day.error || day.trades === 0) {
          dailyPnls.push({ date: day.date, trades: 0, netPnl: 0, avgR: 0 });
          continue;
        }
        totalTrades += day.trades;
        totalWins += day.wins;
        totalLosses += day.losses;
        totalGrossPnl += day.grossPnl ?? 0;
        totalNetPnl += day.netPnl ?? 0;
        totalComm += day.totalCommissions ?? 0;
        totalSlip += day.totalSlippageCosts ?? 0;

        const tradeCount = day.tradeRs?.length ?? 0;
        for (let i = 0; i < tradeCount; i++) {
          const r = day.tradeRs[i];
          allRs.push(r);
          if (day.tradeMFEs && i < day.tradeMFEs.length) allMFEs.push(day.tradeMFEs[i]);
          if (day.tradeMAEs && i < day.tradeMAEs.length) allMAEs.push(day.tradeMAEs[i]);
          if (day.tradeHit1R && i < day.tradeHit1R.length) allHit1R.push(day.tradeHit1R[i]);
          if (day.tradeHitTarget && i < day.tradeHitTarget.length) allHitTarget.push(day.tradeHitTarget[i]);
          if (day.tradeSlippageCostsR && i < day.tradeSlippageCostsR.length) allSlipR.push(day.tradeSlippageCostsR[i]);
          if (day.tradeScratchAfterPartial && i < day.tradeScratchAfterPartial.length) allScratch.push(day.tradeScratchAfterPartial[i]);

          const ticker = day.tradeTickers && i < day.tradeTickers.length ? day.tradeTickers[i] : undefined;
          const regime = day.tradeRegimes && i < day.tradeRegimes.length ? day.tradeRegimes[i] : undefined;
          if (ticker) allTickers.push(ticker);
          if (regime) allRegimes.push(regime);

          if (ticker) {
            if (!bySymbol[ticker]) bySymbol[ticker] = { wins: 0, losses: 0, pnl: 0, trades: 0, rs: [] };
            bySymbol[ticker].trades++;
            bySymbol[ticker].rs.push(r);
            bySymbol[ticker].pnl += r;
            if (r > 0) bySymbol[ticker].wins++; else bySymbol[ticker].losses++;
          }
        }

        const dayAvgR = tradeCount > 0
          ? day.tradeRs.reduce((a: number, b: number) => a + b, 0) / tradeCount : 0;
        dailyPnls.push({ date: day.date, trades: day.trades, netPnl: day.netPnl ?? 0, avgR: Number(dayAvgR.toFixed(3)) });

        const dow = new Date(day.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
        if (!byDayOfWeek[dow]) byDayOfWeek[dow] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
        byDayOfWeek[dow].trades += day.trades;
        byDayOfWeek[dow].wins += day.wins;
        byDayOfWeek[dow].losses += day.losses;
        byDayOfWeek[dow].pnl += day.netPnl ?? 0;
      }

      const avgR = allRs.length > 0 ? allRs.reduce((a, b) => a + b, 0) / allRs.length : 0;
      const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
      const avgMFE = allMFEs.length > 0 ? allMFEs.reduce((a, b) => a + b, 0) / allMFEs.length : 0;
      const avgMAE = allMAEs.length > 0 ? allMAEs.reduce((a, b) => a + b, 0) / allMAEs.length : 0;
      const medianMFE = allMFEs.length > 0 ? allMFEs.sort((a, b) => a - b)[Math.floor(allMFEs.length / 2)] : 0;
      const hit1RPct = allHit1R.length > 0 ? allHit1R.reduce((a, b) => a + b, 0) / allHit1R.length : 0;
      const hitTargetPct = allHitTarget.length > 0 ? allHitTarget.reduce((a, b) => a + b, 0) / allHitTarget.length : 0;
      const avgSlipR = allSlipR.length > 0 ? allSlipR.reduce((a, b) => a + b, 0) / allSlipR.length : 0;
      const scratchPct = allScratch.length > 0 ? allScratch.reduce((a, b) => a + b, 0) / allScratch.length : 0;

      const winners = allRs.filter(r => r > 0);
      const losers = allRs.filter(r => r <= 0);
      const avgWinR = winners.length > 0 ? winners.reduce((a, b) => a + b, 0) / winners.length : 0;
      const avgLossR = losers.length > 0 ? losers.reduce((a, b) => a + b, 0) / losers.length : 0;
      const profitFactor = losers.length > 0 && Math.abs(avgLossR * losers.length) > 0
        ? (avgWinR * winners.length) / Math.abs(avgLossR * losers.length) : 0;

      let maxDD = 0, peak = 0, equity = 0;
      for (const r of allRs) {
        equity += r;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDD) maxDD = dd;
      }

      const regimeSummary: Record<string, any> = {};
      for (let i = 0; i < allRegimes.length; i++) {
        const reg = allRegimes[i];
        if (!regimeSummary[reg]) regimeSummary[reg] = { trades: 0, wins: 0, totalR: 0 };
        regimeSummary[reg].trades++;
        if (allRs[i] > 0) regimeSummary[reg].wins++;
        regimeSummary[reg].totalR += allRs[i];
      }
      for (const k of Object.keys(regimeSummary)) {
        const s = regimeSummary[k];
        s.avgR = s.trades > 0 ? Number((s.totalR / s.trades).toFixed(3)) : 0;
        s.winRate = s.trades > 0 ? Number((s.wins / s.trades).toFixed(3)) : 0;
      }

      const symbolSummary: Record<string, any> = {};
      for (const [sym, data] of Object.entries(bySymbol)) {
        const symAvgR = data.rs.length > 0 ? data.rs.reduce((a, b) => a + b, 0) / data.rs.length : 0;
        symbolSummary[sym] = {
          trades: data.trades,
          wins: data.wins,
          losses: data.losses,
          avgR: Number(symAvgR.toFixed(3)),
          winRate: data.trades > 0 ? Number((data.wins / data.trades).toFixed(3)) : 0,
        };
      }

      return {
        core: {
          trades: totalTrades,
          wins: totalWins,
          losses: totalLosses,
          winRate: Number(winRate.toFixed(3)),
          avgR: Number(avgR.toFixed(3)),
          avgWinR: Number(avgWinR.toFixed(3)),
          avgLossR: Number(avgLossR.toFixed(3)),
          profitFactor: Number(profitFactor.toFixed(3)),
          maxDrawdownR: Number(maxDD.toFixed(3)),
          totalNetPnl: Number(totalNetPnl.toFixed(2)),
        },
        structure: {
          avgMFE: Number(avgMFE.toFixed(3)),
          medianMFE: Number(medianMFE.toFixed(3)),
          avgMAE: Number(avgMAE.toFixed(3)),
          hit1RPct: Number(hit1RPct.toFixed(3)),
          hitTargetPct: Number(hitTargetPct.toFixed(3)),
        },
        execution: {
          avgSlippageCostR: Number(avgSlipR.toFixed(4)),
          scratchAfterPartialPct: Number(scratchPct.toFixed(3)),
          totalCommissions: Number(totalComm.toFixed(2)),
          totalSlippageCosts: Number(totalSlip.toFixed(2)),
        },
        robustness: {
          byRegime: regimeSummary,
          byDayOfWeek,
        },
        perSymbol: symbolSummary,
        dailyPnls,
      };
    }

    try {
      const devResults: any[] = [];
      for (const date of devDates) {
        try {
          const result = await runORFSimulation(
            `wf-dev-${date}-${Date.now()}`, date, userId, storage, tickerList,
            { dryRun: true, orfConfig: orfConfig ?? undefined },
          );
          devResults.push({ date, ...(result as any) });
        } catch (err: any) {
          devResults.push({ date, error: err.message, trades: 0, wins: 0, losses: 0, netPnl: 0 });
        }
      }

      const testResults: any[] = [];
      for (const date of testDates) {
        try {
          const result = await runORFSimulation(
            `wf-test-${date}-${Date.now()}`, date, userId, storage, tickerList,
            { dryRun: true, orfConfig: orfConfig ?? undefined },
          );
          testResults.push({ date, ...(result as any) });
        } catch (err: any) {
          testResults.push({ date, error: err.message, trades: 0, wins: 0, losses: 0, netPnl: 0 });
        }
      }

      const devAgg = aggregateWindow(devResults);
      const testAgg = aggregateWindow(testResults);

      const degradation = devAgg.core.avgR !== 0
        ? Number(((testAgg.core.avgR - devAgg.core.avgR) / Math.abs(devAgg.core.avgR)).toFixed(3)) : 0;

      res.json({
        devWindow: { dates: devDates.length, ...devAgg },
        testWindow: { dates: testDates.length, ...testAgg },
        walkForwardDegradation: degradation,
        verdict: testAgg.core.avgR >= -0.10 ? "MARGINAL" : "NO_EDGE",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== SMALL-CAP MOMENTUM VALIDATION =====
  app.post("/api/internal/smallcap-validate", async (req, res) => {
    const {
      tickers: userTickers,
      dates: userDates,
      smallCapConfig: userScConfig,
      pullbackConfig: userPbConfig,
      floatData: userFloatData,
      premarketVolData: userPremarketData,
      startDate,
      endDate,
      useDynamicScanner: userDynamicScanner,
      gapScanConfig: userGapScanConfig,
    } = req.body;

    const useDynamicScanner = userDynamicScanner ?? false;
    const tickerList: string[] = userTickers ?? SMALLCAP_SCAN_TICKERS;

    let dates: string[];
    if (userDates && Array.isArray(userDates) && userDates.length > 0) {
      dates = userDates;
    } else if (startDate && endDate) {
      dates = buildScanDatesRange(startDate, endDate);
    } else {
      dates = buildScanDatesRange("2026-01-06", "2026-02-14");
    }

    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";
    const scConfig = userScConfig ?? {};
    const pbConfig = userPbConfig ?? {};
    const floatData = userFloatData ?? {};
    const premarketVolData = userPremarketData ?? {};

    const aggregate = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      let grossWinR = 0, grossLossR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const lossBuckets: Record<string, number> = {
        "stopped_before_0.3R": 0,
        "reversed_after_0.3R": 0,
        "partial_then_scratch": 0,
        "winner": 0,
        "other_loss": 0,
      };
      let mfe1R = 0, mfe15R = 0, mfe2R = 0, mfe3R = 0, mfe4R = 0, mfe6R = 0;
      const bySymbol: Record<string, { trades: number; rs: number[]; wins: number }> = {};
      const allSlippageCostsR: number[] = [];
      const allQualifications: any[] = [];
      let daysWithTrades = 0;
      let totalSpreadRejects = 0;
      let maxDD = 0;
      let equity = 0;
      let peak = 0;
      let totalScannerScanned = 0;
      let totalScannerData = 0;
      let totalScannerQualified = 0;
      let totalScannerLong = 0;
      let totalScannerTimeMs = 0;

      for (const day of results) {
        if (day.error || !day.tradeRs) continue;
        const dayTrades = day.trades ?? 0;
        trades += dayTrades;
        wins += day.wins ?? 0;
        if (dayTrades > 0) daysWithTrades++;
        const dayRs = day.tradeRs as number[];
        totalR += dayRs.reduce((a: number, b: number) => a + b, 0);
        allRs.push(...dayRs);
        for (const r of dayRs) {
          if (r > 0) grossWinR += r;
          else grossLossR += Math.abs(r);
          equity += r;
          if (equity > peak) peak = equity;
          const dd = peak - equity;
          if (dd > maxDD) maxDD = dd;
        }
        if (day.tradeMFEs) {
          allMFEs.push(...day.tradeMFEs);
          for (const mfe of day.tradeMFEs) {
            if (mfe >= 1.0) mfe1R++;
            if (mfe >= 1.5) mfe15R++;
            if (mfe >= 2.0) mfe2R++;
            if (mfe >= 3.0) mfe3R++;
            if (mfe >= 4.0) mfe4R++;
            if (mfe >= 6.0) mfe6R++;
          }
        }
        if (day.tradeMAEs) allMAEs.push(...day.tradeMAEs);
        if (day.tradeLossBuckets) {
          for (const bucket of day.tradeLossBuckets) {
            if (lossBuckets[bucket] !== undefined) lossBuckets[bucket]++;
            else lossBuckets.other_loss++;
          }
        }
        if (day.tradeTickers && day.tradeRs) {
          for (let i = 0; i < day.tradeTickers.length; i++) {
            const sym = day.tradeTickers[i];
            const r = day.tradeRs[i] ?? 0;
            if (!bySymbol[sym]) bySymbol[sym] = { trades: 0, rs: [], wins: 0 };
            bySymbol[sym].trades++;
            bySymbol[sym].rs.push(r);
            if (r > 0) bySymbol[sym].wins++;
          }
        }
        if (day.tradeSlippageCostsR) allSlippageCostsR.push(...day.tradeSlippageCostsR);
        if (day.qualifications) allQualifications.push(...day.qualifications);
        if (day.spreadRejects) totalSpreadRejects += day.spreadRejects;
        if (day.dynamicScannerStats) {
          totalScannerScanned += day.dynamicScannerStats.scannedCount;
          totalScannerData += day.dynamicScannerStats.dataReturnedCount;
          totalScannerQualified += day.dynamicScannerStats.qualifiedCount;
          totalScannerLong += day.dynamicScannerStats.longCount;
          totalScannerTimeMs += day.dynamicScannerStats.scanTimeMs;
        }
      }

      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const p75MFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length * 0.75)] : 0;
      const avgMFE = allMFEs.length > 0 ? allMFEs.reduce((a, b) => a + b, 0) / allMFEs.length : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;
      const avgMAE = allMAEs.length > 0 ? allMAEs.reduce((a, b) => a + b, 0) / allMAEs.length : 0;
      const avgSlippageR = allSlippageCostsR.length > 0
        ? allSlippageCostsR.reduce((a, b) => a + b, 0) / allSlippageCostsR.length : 0;

      const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? Infinity : 0;
      const tradesPerDay = dates.length > 0 ? trades / dates.length : 0;
      const avgR = trades > 0 ? totalR / trades : 0;
      const edgeDensity = tradesPerDay * avgR;

      const symbolSummary: Record<string, any> = {};
      for (const [sym, data] of Object.entries(bySymbol)) {
        const symAvgR = data.rs.length > 0 ? data.rs.reduce((a, b) => a + b, 0) / data.rs.length : 0;
        symbolSummary[sym] = {
          trades: data.trades,
          avgR: Number(symAvgR.toFixed(3)),
          winRate: Number((data.wins / data.trades).toFixed(3)),
          maxR: data.rs.length > 0 ? Number(Math.max(...data.rs).toFixed(3)) : 0,
          minR: data.rs.length > 0 ? Number(Math.min(...data.rs).toFixed(3)) : 0,
        };
      }

      const qualPassed = allQualifications.filter((q: any) => q.passed);
      const qualRejected = allQualifications.filter((q: any) => !q.passed);
      const qualTotal = allQualifications.length;

      const rejectionReasons: Record<string, number> = {};
      for (const q of qualRejected) {
        const reason = q.rejectReason ?? "unknown";
        const bucket = reason.includes("gap") ? "gap_too_small"
          : reason.includes("dollar vol") ? "dollar_vol_low"
          : reason.includes("vol") && reason.includes("premarket") ? "premarket_vol_low"
          : reason.includes("vol") ? "avg_vol_low"
          : reason.includes("ATR") ? "atr_too_low"
          : reason.includes("float") ? "float_too_big"
          : reason.includes("price") || reason.includes("open") ? "price_out_of_range"
          : "other";
        rejectionReasons[bucket] = (rejectionReasons[bucket] ?? 0) + 1;
      }

      const avgPremarketVol = qualPassed.length > 0
        ? qualPassed.reduce((s: number, q: any) => s + (q.premarketVolume ?? 0), 0) / qualPassed.length : 0;
      const avgFloat = qualPassed.length > 0
        ? qualPassed.reduce((s: number, q: any) => s + (q.floatShares ?? 0), 0) / qualPassed.length : 0;
      const candidatesPerDay = dates.length > 0 ? qualPassed.length / dates.length : 0;

      const sortedRs = [...allRs].sort((a, b) => a - b);

      return {
        core: {
          trades,
          wins,
          losses: trades - wins,
          winRate: trades > 0 ? Number((wins / trades * 100).toFixed(1)) : 0,
          avgR: Number(avgR.toFixed(3)),
          totalR: Number(totalR.toFixed(3)),
          medianR: sortedRs.length > 0 ? Number(sortedRs[Math.floor(sortedRs.length / 2)].toFixed(3)) : 0,
          profitFactor: Number(profitFactor.toFixed(3)),
          maxDrawdownR: Number(maxDD.toFixed(2)),
          tradesPerDay: Number(tradesPerDay.toFixed(2)),
          edgeDensity: Number(edgeDensity.toFixed(4)),
          daysScanned: dates.length,
          daysWithTrades,
        },
        mfe: {
          avg: Number(avgMFE.toFixed(3)),
          median: Number(medianMFE.toFixed(3)),
          p75: Number(p75MFE.toFixed(3)),
          ge1R: trades > 0 ? Number((mfe1R / trades * 100).toFixed(1)) : 0,
          ge15R: trades > 0 ? Number((mfe15R / trades * 100).toFixed(1)) : 0,
          ge2R: trades > 0 ? Number((mfe2R / trades * 100).toFixed(1)) : 0,
          ge3R: trades > 0 ? Number((mfe3R / trades * 100).toFixed(1)) : 0,
          ge4R: trades > 0 ? Number((mfe4R / trades * 100).toFixed(1)) : 0,
          ge6R: trades > 0 ? Number((mfe6R / trades * 100).toFixed(1)) : 0,
        },
        mae: {
          avg: Number(avgMAE.toFixed(3)),
          median: Number(medianMAE.toFixed(3)),
        },
        friction: {
          avgSlippageCostR: Number(avgSlippageR.toFixed(4)),
          spreadRejects: totalSpreadRejects,
        },
        lossDecomp: lossBuckets,
        bySymbol: symbolSummary,
        qualification: {
          scanned: qualTotal,
          passed: qualPassed.length,
          passRate: qualTotal > 0 ? Number((qualPassed.length / qualTotal * 100).toFixed(1)) : 0,
          candidatesPerDay: Number(candidatesPerDay.toFixed(2)),
          avgPremarketVolForPassed: Math.round(avgPremarketVol),
          avgFloatForPassed: Math.round(avgFloat),
          rejectionReasons,
        },
        ...(useDynamicScanner ? {
          dynamicScanner: {
            totalScanned: totalScannerScanned,
            totalDataReturned: totalScannerData,
            totalQualified: totalScannerQualified,
            totalLong: totalScannerLong,
            avgQualifiedPerDay: dates.length > 0 ? Number((totalScannerQualified / dates.length).toFixed(1)) : 0,
            avgLongPerDay: dates.length > 0 ? Number((totalScannerLong / dates.length).toFixed(1)) : 0,
            totalScanTimeMs: totalScannerTimeMs,
          },
        } : {}),
      };
    };

    try {
      let batchGapResults: Map<string, { qualifiers: any[], scannedCount: number, dataReturnedCount: number, qualifiedCount: number }> | null = null;

      if (useDynamicScanner && userGapScanConfig?.useFullMarket && dates.length > 1) {
        const { batchScanForGappers } = await import("./strategy/batchGapScanner");
        const gapCfg = { ...(userGapScanConfig ?? {}), useFullMarket: true };
        if (scConfig.minPrice) gapCfg.minPrice = gapCfg.minPrice ?? scConfig.minPrice;
        if (scConfig.maxPrice) gapCfg.maxPrice = gapCfg.maxPrice ?? scConfig.maxPrice;
        if (scConfig.minGapPct) gapCfg.minGapPct = gapCfg.minGapPct ?? scConfig.minGapPct;

        const batchResult = await batchScanForGappers(dates[0], dates[dates.length - 1], gapCfg);
        batchGapResults = new Map();
        batchResult.dailyResults.forEach((dr, date) => {
          batchGapResults!.set(date, {
            qualifiers: dr.qualifiers,
            scannedCount: dr.scannedCount,
            dataReturnedCount: dr.dataReturnedCount,
            qualifiedCount: dr.qualifiedCount,
          });
        });
      }

      const results: any[] = [];
      for (const date of dates) {
        try {
          let overrideTickerList = tickerList;
          let preBatchScanStats: any = undefined;

          if (batchGapResults) {
            const dayGap = batchGapResults.get(date);
            if (dayGap) {
              overrideTickerList = dayGap.qualifiers
                .filter((q: any) => q.gapDirection === "LONG")
                .map((q: any) => q.ticker);
              preBatchScanStats = {
                scannedCount: dayGap.scannedCount,
                dataReturnedCount: dayGap.dataReturnedCount,
                qualifiedCount: dayGap.qualifiedCount,
                longCount: overrideTickerList.length,
                scanTimeMs: 0,
              };
            } else {
              overrideTickerList = [];
            }
          }

          const result = await runSmallCapMomentumSimulation(
            `smallcap-${date}-${Date.now()}`,
            date,
            userId,
            storage,
            batchGapResults ? overrideTickerList : tickerList,
            {
              dryRun: true,
              smallCapConfig: scConfig,
              pullbackConfig: pbConfig,
              floatData,
              premarketVolData,
              useDynamicScanner: batchGapResults ? false : useDynamicScanner,
              gapScanConfig: batchGapResults ? undefined : userGapScanConfig,
            },
          );
          if (preBatchScanStats) {
            (result as any).dynamicScannerStats = preBatchScanStats;
          }
          results.push({ date, ...(result as any) });
        } catch (err: any) {
          results.push({ date, error: err?.message ?? String(err), trades: 0, tradeRs: [] });
        }
      }

      const agg = aggregate(results);
      const verdict = agg.core.avgR >= 0.1
        ? "POTENTIAL_EDGE"
        : agg.core.avgR >= -0.1
          ? "MARGINAL"
          : "NO_EDGE";

      res.json({
        strategy: "Small-Cap Momentum: First Pullback After HOD Break",
        scannerMode: useDynamicScanner ? "dynamic" : "static",
        config: { smallCap: { ...DEFAULT_SMALLCAP_CONFIG, ...scConfig }, pullback: { ...DEFAULT_PULLBACK_CONFIG, ...pbConfig } },
        dateRange: { start: dates[0], end: dates[dates.length - 1], totalDays: dates.length },
        tickerCount: useDynamicScanner ? (agg as any).dynamicScanner?.avgLongPerDay ?? "dynamic" : tickerList.length,
        ...agg,
        verdict,
        perDay: results.map(r => ({
          date: r.date,
          trades: r.trades ?? 0,
          wins: r.wins ?? 0,
          losses: r.losses ?? 0,
          avgR: r.tradeRs && r.tradeRs.length > 0
            ? Number((r.tradeRs.reduce((a: number, b: number) => a + b, 0) / r.tradeRs.length).toFixed(3))
            : null,
          error: r.error ?? null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/internal/smallcap-walkforward", async (req, res) => {
    const {
      devStartDate = "2025-11-01",
      devEndDate = "2026-01-31",
      testStartDate = "2026-02-01",
      testEndDate = "2026-02-14",
      gapThresholds = [0.04, 0.05, 0.06],
      premarketVolFloors = [200_000, 500_000, 1_000_000],
      trailOffsets = [0.5, 0.75, 1.0],
      smallCapConfig: userScConfig,
      pullbackConfig: userPbConfig,
      gapScanConfig: userGapScanConfig,
    } = req.body;

    const userId = "1a70fbad-ee1b-46ea-96a3-36749e24f3ba";
    const baseScConfig = { ...DEFAULT_SMALLCAP_CONFIG, ...(userScConfig ?? {}) };
    const basePbConfig = { ...DEFAULT_PULLBACK_CONFIG, ...(userPbConfig ?? {}) };

    const devDates = buildScanDatesRange(devStartDate, devEndDate);
    const testDates = buildScanDatesRange(testStartDate, testEndDate);
    const allDates = buildScanDatesRange(devStartDate, testEndDate);

    const aggregateResults = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      let grossWinR = 0, grossLossR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      let mfe1R = 0, mfe2R = 0;
      let maxDD = 0, equity = 0, peak = 0;
      let totalSpreadRejects = 0;
      let daysWithTrades = 0;
      let worstTradeR = 0;

      for (const day of results) {
        if (day.error || !day.tradeRs) continue;
        const dayTrades = day.trades ?? 0;
        trades += dayTrades;
        wins += day.wins ?? 0;
        if (dayTrades > 0) daysWithTrades++;
        const dayRs = day.tradeRs as number[];
        totalR += dayRs.reduce((a: number, b: number) => a + b, 0);
        allRs.push(...dayRs);
        for (const r of dayRs) {
          if (r > 0) grossWinR += r;
          else grossLossR += Math.abs(r);
          equity += r;
          if (equity > peak) peak = equity;
          const dd = peak - equity;
          if (dd > maxDD) maxDD = dd;
          if (r < worstTradeR) worstTradeR = r;
        }
        if (day.tradeMFEs) {
          allMFEs.push(...day.tradeMFEs);
          for (const mfe of day.tradeMFEs) {
            if (mfe >= 1.0) mfe1R++;
            if (mfe >= 2.0) mfe2R++;
          }
        }
        if (day.tradeMAEs) allMAEs.push(...day.tradeMAEs);
        if (day.spreadRejects) totalSpreadRejects += day.spreadRejects;
      }

      const avgR = trades > 0 ? totalR / trades : 0;
      const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? Infinity : 0;
      const sortedRs = [...allRs].sort((a, b) => a - b);
      const medianR = sortedRs.length > 0 ? sortedRs[Math.floor(sortedRs.length / 2)] : 0;
      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const avgMFE = allMFEs.length > 0 ? allMFEs.reduce((a, b) => a + b, 0) / allMFEs.length : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;
      const tail3R = allRs.filter(r => r <= -3).length;

      return {
        trades, wins, losses: trades - wins,
        winRate: trades > 0 ? Number((wins / trades * 100).toFixed(1)) : 0,
        avgR: Number(avgR.toFixed(3)),
        medianR: Number(medianR.toFixed(3)),
        totalR: Number(totalR.toFixed(3)),
        profitFactor: Number(profitFactor.toFixed(3)),
        maxDrawdownR: Number(maxDD.toFixed(2)),
        daysWithTrades,
        tradesPerDay: Number((trades / results.length).toFixed(2)),
        mfeMedian: Number(medianMFE.toFixed(3)),
        mfeAvg: Number(avgMFE.toFixed(3)),
        mfe1RPct: trades > 0 ? Number((mfe1R / trades * 100).toFixed(1)) : 0,
        mfe2RPct: trades > 0 ? Number((mfe2R / trades * 100).toFixed(1)) : 0,
        maeMedian: Number(medianMAE.toFixed(3)),
        spreadRejects: totalSpreadRejects,
        worstTradeR: Number(worstTradeR.toFixed(3)),
        tail3RCount: tail3R,
      };
    };

    try {
      const { batchScanForGappers } = await import("./strategy/batchGapScanner");

      const gapCfg = { ...(userGapScanConfig ?? {}), useFullMarket: true };
      if (baseScConfig.minPrice) gapCfg.minPrice = gapCfg.minPrice ?? baseScConfig.minPrice;
      if (baseScConfig.maxPrice) gapCfg.maxPrice = gapCfg.maxPrice ?? baseScConfig.maxPrice;

      const combos: Array<{
        label: string;
        minGapPct: number;
        minPremarketVolume: number;
        trailOffsetR: number;
      }> = [];

      for (const gap of gapThresholds) {
        for (const preVol of premarketVolFloors) {
          for (const trail of trailOffsets) {
            combos.push({
              label: `gap${(gap*100).toFixed(0)}%_preVol${(preVol/1000).toFixed(0)}K_trail${trail}R`,
              minGapPct: gap,
              minPremarketVolume: preVol,
              trailOffsetR: trail,
            });
          }
        }
      }

      const sharedBarsCache: BarsCache = new Map();

      const runWindowForCombo = async (
        combo: typeof combos[0],
        windowDates: string[],
        batchGapResults: Map<string, { qualifiers: any[], scannedCount: number, dataReturnedCount: number, qualifiedCount: number }>,
      ) => {
        const scConfig = {
          ...baseScConfig,
          minGapPct: combo.minGapPct,
          minPremarketVolume: combo.minPremarketVolume,
          trailOffsetR: combo.trailOffsetR,
          trailActivationR: combo.trailOffsetR < 1.0 ? combo.trailOffsetR + 0.5 : combo.trailOffsetR + 0.25,
        };

        const results: any[] = [];
        for (const date of windowDates) {
          try {
            const dayGap = batchGapResults.get(date);
            let tickersForDay: string[] = [];
            let scanStats: any = undefined;

            if (dayGap) {
              tickersForDay = dayGap.qualifiers
                .filter((q: any) => {
                  const absGap = Math.abs(q.gapPct);
                  return q.gapDirection === "LONG" && absGap >= combo.minGapPct;
                })
                .map((q: any) => q.ticker);
              scanStats = {
                scannedCount: dayGap.scannedCount,
                dataReturnedCount: dayGap.dataReturnedCount,
                qualifiedCount: dayGap.qualifiedCount,
                longCount: tickersForDay.length,
                scanTimeMs: 0,
              };
            }

            if (tickersForDay.length === 0) {
              results.push({ date, trades: 0, tradeRs: [] });
              continue;
            }

            const result = await runSmallCapMomentumSimulation(
              `wf-${combo.label}-${date}-${Date.now()}`,
              date, userId, storage, tickersForDay,
              {
                dryRun: true,
                smallCapConfig: scConfig,
                pullbackConfig: basePbConfig,
                barsCache: sharedBarsCache,
              },
            );
            if (scanStats) (result as any).dynamicScannerStats = scanStats;
            results.push({ date, ...(result as any) });
          } catch (err: any) {
            results.push({ date, error: err?.message ?? String(err), trades: 0, tradeRs: [] });
          }
        }
        return aggregateResults(results);
      };

      const minGapForBatch = Math.min(...gapThresholds);
      gapCfg.minGapPct = minGapForBatch;

      const batchResult = await batchScanForGappers(allDates[0], allDates[allDates.length - 1], gapCfg);
      const batchGapResults = new Map<string, { qualifiers: any[], scannedCount: number, dataReturnedCount: number, qualifiedCount: number }>();
      batchResult.dailyResults.forEach((dr, date) => {
        batchGapResults.set(date, {
          qualifiers: dr.qualifiers,
          scannedCount: dr.scannedCount,
          dataReturnedCount: dr.dataReturnedCount,
          qualifiedCount: dr.qualifiedCount,
        });
      });

      const devResults: Array<{ combo: typeof combos[0]; metrics: ReturnType<typeof aggregateResults> }> = [];

      for (const combo of combos) {
        const metrics = await runWindowForCombo(combo, devDates, batchGapResults);
        devResults.push({ combo, metrics });
      }

      devResults.sort((a, b) => b.metrics.avgR - a.metrics.avgR);

      const bestDev = devResults[0];
      const testMetrics = await runWindowForCombo(bestDev.combo, testDates, batchGapResults);

      const passCriteria = {
        avgR_ge_0: testMetrics.avgR >= 0,
        pf_ge_1_1: testMetrics.profitFactor >= 1.1,
        mfe2R_ge_15pct: testMetrics.mfe2RPct >= 15,
        no_catastrophic_tails: testMetrics.tail3RCount <= 1,
      };
      const passCount = Object.values(passCriteria).filter(Boolean).length;
      const verdict = passCount === 4 ? "PASS" : passCount >= 3 ? "MARGINAL_PASS" : "FAIL";

      res.json({
        strategy: "Small-Cap Momentum Walk-Forward Phase B",
        devWindow: { start: devStartDate, end: devEndDate, days: devDates.length },
        testWindow: { start: testStartDate, end: testEndDate, days: testDates.length },
        parameterGrid: {
          gapThresholds: gapThresholds.map((g: number) => `${(g * 100).toFixed(0)}%`),
          premarketVolFloors: premarketVolFloors.map((v: number) => `${(v / 1000).toFixed(0)}K`),
          trailOffsets: trailOffsets.map((t: number) => `${t}R`),
          totalCombos: combos.length,
        },
        devSweep: devResults.map(d => ({
          label: d.combo.label,
          params: {
            gapPct: d.combo.minGapPct,
            premarketVol: d.combo.minPremarketVolume,
            trailOffsetR: d.combo.trailOffsetR,
          },
          ...d.metrics,
        })),
        bestDevConfig: {
          label: bestDev.combo.label,
          params: {
            gapPct: bestDev.combo.minGapPct,
            premarketVol: bestDev.combo.minPremarketVolume,
            trailOffsetR: bestDev.combo.trailOffsetR,
          },
          devMetrics: bestDev.metrics,
        },
        testResults: testMetrics,
        passCriteria,
        verdict,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/internal/volatility-cluster-test", async (req, res) => {
    const userId = getSharedUserId() ?? "internal";
    const {
      startDate,
      endDate,
      clusterConfig: userClusterConfig,
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate required" });
    }

    const frozenConfig = {
      ...DEFAULT_SMALLCAP_CONFIG,
      minGapPct: 0.06,
      minPremarketVolume: 1000000,
      trailOffsetR: 0.75,
      trailActivationR: 1.25,
      maxSpreadPct: 0.015,
      minDollarVolume: 2000000,
    };
    const basePbConfig = DEFAULT_PULLBACK_CONFIG;

    try {
      const { batchComputeClusterActivation } = await import("./strategy/volatilityClusterFilter");
      const { batchScanForGappers } = await import("./strategy/batchGapScanner");

      const clusterResult = await batchComputeClusterActivation(
        startDate, endDate, userClusterConfig ?? {}
      );

      const scanDates = buildScanDatesRange(startDate, endDate);

      const gapCfg = { useFullMarket: true, minPrice: frozenConfig.minPrice, maxPrice: frozenConfig.maxPrice, minGapPct: frozenConfig.minGapPct };
      const batchResult = await batchScanForGappers(scanDates[0], scanDates[scanDates.length - 1], gapCfg);
      const batchGapResults = new Map<string, { qualifiers: any[] }>();
      batchResult.dailyResults.forEach((dr, date) => {
        batchGapResults.set(date, { qualifiers: dr.qualifiers });
      });

      const sharedBarsCache: BarsCache = new Map();
      const dayResults: Array<{
        date: string;
        regimeActive: boolean;
        gapCount: number;
        percentAboveVWAP: number;
        percentMakingHOD: number;
        breadthUniverseSize: number;
        trades: number;
        tradeRs: number[];
        dayR: number;
        tradeTickers: string[];
        tradeMFEs: number[];
        tradeMAEs: number[];
        tradeGapPcts: number[];
      }> = [];

      for (const date of scanDates) {
        const cluster = clusterResult.dailyResults.get(date);
        const regimeActive = cluster?.regimeActive ?? false;
        const gapCount = cluster?.gapCount ?? 0;
        const percentAboveVWAP = cluster?.percentAboveVWAP ?? 0;
        const percentMakingHOD = cluster?.percentMakingHOD ?? 0;
        const breadthUniverseSize = cluster?.breadthUniverseSize ?? 0;
        const vcs = cluster?.vcs ?? 0;
        const gapDensityScore = cluster?.gapDensityScore ?? 0;
        const breadthScore = cluster?.breadthScore ?? 0;
        const expansionScore = cluster?.expansionScore ?? 0;
        const spyRangeRatio = cluster?.spyRangeRatio ?? 0;
        const percentExpanded = cluster?.percentExpanded ?? 0;

        try {
          const dayGap = batchGapResults.get(date);
          let tickersForDay: string[] = [];
          if (dayGap) {
            tickersForDay = dayGap.qualifiers
              .filter((q: any) => q.gapDirection === "LONG" && Math.abs(q.gapPct) >= frozenConfig.minGapPct)
              .map((q: any) => q.ticker);
          }

          if (tickersForDay.length === 0) {
            dayResults.push({ 
              date, regimeActive, gapCount, percentAboveVWAP, percentMakingHOD, breadthUniverseSize, 
              vcs, gapDensityScore, breadthScore, expansionScore, spyRangeRatio, percentExpanded,
              trades: 0, tradeRs: [], dayR: 0, tradeTickers: [], tradeMFEs: [], tradeMAEs: [], tradeGapPcts: [] 
            });
            continue;
          }

          const result = await runSmallCapMomentumSimulation(
            `cluster-${date}-${Date.now()}`,
            date, userId, storage, tickersForDay,
            { dryRun: true, smallCapConfig: frozenConfig, pullbackConfig: basePbConfig, barsCache: sharedBarsCache },
          );
          const r = result as any;
          const tRs = r.tradeRs as number[] ?? [];
          const dR = tRs.reduce((a: number, b: number) => a + b, 0);

          dayResults.push({
            date, regimeActive, gapCount, percentAboveVWAP, percentMakingHOD, breadthUniverseSize,
            vcs, gapDensityScore, breadthScore, expansionScore, spyRangeRatio, percentExpanded,
            trades: tRs.length, tradeRs: tRs, dayR: dR,
            tradeTickers: r.tradeTickers ?? [],
            tradeMFEs: r.tradeMFEs ?? [],
            tradeMAEs: r.tradeMAEs ?? [],
            tradeGapPcts: r.tradeGapPcts ?? [],
          });
        } catch (err: any) {
          dayResults.push({ 
            date, regimeActive, gapCount, percentAboveVWAP, percentMakingHOD, breadthUniverseSize, 
            vcs, gapDensityScore, breadthScore, expansionScore, spyRangeRatio, percentExpanded,
            trades: 0, tradeRs: [], dayR: 0, tradeTickers: [], tradeMFEs: [], tradeMAEs: [], tradeGapPcts: [] 
          });
        }
      }

      const calculateStats = (logs: any[]) => {
        const trades = logs.reduce((sum, d) => sum + d.trades, 0);
        const totalR = logs.reduce((sum, d) => sum + d.dayR, 0);
        
        const allRs: number[] = [];
        const allDetails: any[] = [];
        logs.forEach(d => {
          for (let i = 0; i < d.trades; i++) {
            allRs.push(d.tradeRs[i]);
            allDetails.push({
              ticker: d.tradeTickers[i],
              date: d.date,
              r: d.tradeRs[i],
              mfe: d.tradeMFEs[i],
              gapPct: d.tradeGapPcts[i]
            });
          }
        });

        const wins = allRs.filter(r => r > 0).length;
        const losses = allRs.filter(r => r <= 0).length;
        const grossWinR = allRs.filter(r => r > 0).reduce((a, b) => a + b, 0);
        const grossLossR = allRs.filter(r => r < 0).reduce((a, b) => a + Math.abs(b), 0);
        const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : Infinity;
        const avgR = trades > 0 ? totalR / trades : 0;
        
        const sortedRs = [...allRs].sort((a,b) => a-b);
        const medianR = sortedRs.length > 0 ? sortedRs[Math.floor(sortedRs.length/2)] : 0;
        const mfe2RPct = trades > 0 ? (allDetails.filter(t => t.mfe >= 2.0).length / trades) * 100 : 0;

        const rDistribution: Record<string, number> = {
          "< -2R": 0, "-2R to -1.5R": 0, "-1.5R to -1R": 0, "-1R to -0.5R": 0,
          "-0.5R to 0": 0, "0 to 0.5R": 0, "0.5R to 1R": 0, "1R to 1.5R": 0,
          "1.5R to 2R": 0, "2R to 3R": 0, "> 3R": 0,
        };
        allRs.forEach(r => {
          if (r < -2) rDistribution["< -2R"]++;
          else if (r < -1.5) rDistribution["-2R to -1.5R"]++;
          else if (r < -1) rDistribution["-1.5R to -1R"]++;
          else if (r < -0.5) rDistribution["-1R to -0.5R"]++;
          else if (r < 0) rDistribution["-0.5R to 0"]++;
          else if (r < 0.5) rDistribution["0 to 0.5R"]++;
          else if (r < 1) rDistribution["0.5R to 1R"]++;
          else if (r < 1.5) rDistribution["1R to 1.5R"]++;
          else if (r < 2) rDistribution["1.5R to 2R"]++;
          else if (r < 3) rDistribution["2R to 3R"]++;
          else rDistribution["> 3R"]++;
        });

        const topWinners = [...allDetails].sort((a,b) => b.r - a.r).slice(0, 5);
        const topLosers = [...allDetails].sort((a,b) => a.r - b.r).slice(0, 5);

        return {
          tradingDays: logs.length,
          daysWithTrades: logs.filter(d => d.trades > 0).length,
          trades,
          wins,
          losses,
          winRate: trades > 0 ? (wins / trades) * 100 : 0,
          avgR,
          medianR,
          totalR,
          profitFactor,
          tradesPerDay: logs.length > 0 ? trades / logs.length : 0,
          mfe2RPct,
          rDistribution,
          topWinners,
          topLosers
        };
      };

      const activeLogs = dayResults.filter(d => d.regimeActive);
      const offLogs = dayResults.filter(d => !d.regimeActive);

      const dailyClusterLog = dayResults.map(res => ({
        date: res.date,
        regimeActive: res.regimeActive,
        vcs: res.vcs,
        gapDensityScore: res.gapDensityScore,
        breadthScore: res.breadthScore,
        expansionScore: res.expansionScore,
        spyRangeRatio: res.spyRangeRatio,
        gapCount: res.gapCount,
        vwapPct: Number((res.percentAboveVWAP * 100).toFixed(1)),
        hodPct: Number((res.percentMakingHOD * 100).toFixed(1)),
        percentExpanded: Number((res.percentExpanded * 100).toFixed(1)),
        breadthN: res.breadthUniverseSize,
        trades: res.trades,
        dayR: Number(res.dayR.toFixed(3))
      }));

      res.json({
        strategy: "Volatility Cluster Activation Test (VCS)",
        window: { start: startDate, end: endDate, tradingDays: scanDates.length },
        clusterSummary: {
          activeDays: activeLogs.length,
          offDays: offLogs.length,
          activationRate: activeLogs.length / scanDates.length,
        },
        regimeActiveMetrics: calculateStats(activeLogs),
        regimeOffMetrics: calculateStats(offLogs),
        unfilteredMetrics: calculateStats(dayResults),
        dailyLog: dailyClusterLog,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/internal/smallcap-extended-oos", async (req, res) => {
    const userId = getSharedUserId() ?? "internal";
    const {
      startDate,
      endDate,
      gapScanConfig: userGapScanConfig,
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate required" });
    }

    const frozenConfig = {
      ...DEFAULT_SMALLCAP_CONFIG,
      minGapPct: 0.06,
      minPremarketVolume: 1000000,
      trailOffsetR: 0.75,
      trailActivationR: 1.25,
      maxSpreadPct: 0.015,
      minDollarVolume: 2000000,
    };

    const basePbConfig = DEFAULT_PULLBACK_CONFIG;
    const scanDates = buildScanDatesRange(startDate, endDate);

    try {
      const { batchScanForGappers } = await import("./strategy/batchGapScanner");

      const gapCfg = { ...(userGapScanConfig ?? {}), useFullMarket: true };
      if (frozenConfig.minPrice) gapCfg.minPrice = gapCfg.minPrice ?? frozenConfig.minPrice;
      if (frozenConfig.maxPrice) gapCfg.maxPrice = gapCfg.maxPrice ?? frozenConfig.maxPrice;
      gapCfg.minGapPct = frozenConfig.minGapPct;

      const batchResult = await batchScanForGappers(scanDates[0], scanDates[scanDates.length - 1], gapCfg);
      const batchGapResults = new Map<string, { qualifiers: any[], scannedCount: number, dataReturnedCount: number, qualifiedCount: number }>();
      batchResult.dailyResults.forEach((dr, date) => {
        batchGapResults.set(date, {
          qualifiers: dr.qualifiers,
          scannedCount: dr.scannedCount,
          dataReturnedCount: dr.dataReturnedCount,
          qualifiedCount: dr.qualifiedCount,
        });
      });

      const sharedBarsCache: BarsCache = new Map();
      const dayResults: any[] = [];

      const allTradeDetails: Array<{
        date: string;
        ticker: string;
        r: number;
        mfe: number;
        mae: number;
        gapPct: number;
      }> = [];

      for (const date of scanDates) {
        try {
          const dayGap = batchGapResults.get(date);
          let tickersForDay: string[] = [];

          if (dayGap) {
            tickersForDay = dayGap.qualifiers
              .filter((q: any) => q.gapDirection === "LONG" && Math.abs(q.gapPct) >= frozenConfig.minGapPct)
              .map((q: any) => q.ticker);
          }

          if (tickersForDay.length === 0) {
            dayResults.push({ date, trades: 0, tradeRs: [], dayR: 0 });
            continue;
          }

          const result = await runSmallCapMomentumSimulation(
            `oos-${date}-${Date.now()}`,
            date, userId, storage, tickersForDay,
            {
              dryRun: true,
              smallCapConfig: frozenConfig,
              pullbackConfig: basePbConfig,
              barsCache: sharedBarsCache,
            },
          );
          const r = result as any;
          const dayRs = r.tradeRs as number[] ?? [];
          const dayR = dayRs.reduce((a: number, b: number) => a + b, 0);
          dayResults.push({ date, ...r, dayR });

          const tickers = r.tradeTickers ?? [];
          const mfes = r.tradeMFEs ?? [];
          const maes = r.tradeMAEs ?? [];
          const gapPcts = r.tradeGapPcts ?? [];
          for (let i = 0; i < dayRs.length; i++) {
            allTradeDetails.push({
              date,
              ticker: tickers[i] ?? "UNK",
              r: dayRs[i],
              mfe: mfes[i] ?? 0,
              mae: maes[i] ?? 0,
              gapPct: gapPcts[i] ?? 0,
            });
          }
        } catch (err: any) {
          dayResults.push({ date, error: err?.message, trades: 0, tradeRs: [], dayR: 0 });
        }
      }

      const allRs = allTradeDetails.map(t => t.r);
      const trades = allRs.length;
      const wins = allRs.filter(r => r > 0).length;
      const totalR = allRs.reduce((a, b) => a + b, 0);
      const avgR = trades > 0 ? totalR / trades : 0;
      const grossWinR = allRs.filter(r => r > 0).reduce((a, b) => a + b, 0);
      const grossLossR = allRs.filter(r => r < 0).reduce((a, b) => a + Math.abs(b), 0);
      const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? Infinity : 0;
      const sortedRs = [...allRs].sort((a, b) => a - b);
      const medianR = sortedRs.length > 0 ? sortedRs[Math.floor(sortedRs.length / 2)] : 0;

      let maxDD = 0, equity = 0, peak = 0;
      for (const r of allRs) {
        equity += r;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDD) maxDD = dd;
      }

      const allMFEs = allTradeDetails.map(t => t.mfe);
      const allMAEs = allTradeDetails.map(t => t.mae);
      const mfe1R = allMFEs.filter(m => m >= 1.0).length;
      const mfe2R = allMFEs.filter(m => m >= 2.0).length;
      const sortedMFE = [...allMFEs].sort((a, b) => a - b);
      const medianMFE = sortedMFE.length > 0 ? sortedMFE[Math.floor(sortedMFE.length / 2)] : 0;
      const avgMFE = allMFEs.length > 0 ? allMFEs.reduce((a, b) => a + b, 0) / allMFEs.length : 0;
      const sortedMAE = [...allMAEs].sort((a, b) => a - b);
      const medianMAE = sortedMAE.length > 0 ? sortedMAE[Math.floor(sortedMAE.length / 2)] : 0;
      const worstTradeR = sortedRs.length > 0 ? sortedRs[0] : 0;
      const tail3RCount = allRs.filter(r => r <= -3).length;
      const daysWithTrades = dayResults.filter(d => (d.trades ?? 0) > 0).length;
      const spreadRejects = dayResults.reduce((a, d) => a + (d.spreadRejects ?? 0), 0);

      const rDistribution: Record<string, number> = {
        "< -2R": 0, "-2R to -1.5R": 0, "-1.5R to -1R": 0, "-1R to -0.5R": 0,
        "-0.5R to 0": 0, "0 to 0.5R": 0, "0.5R to 1R": 0, "1R to 1.5R": 0,
        "1.5R to 2R": 0, "2R to 3R": 0, "> 3R": 0,
      };
      for (const r of allRs) {
        if (r < -2) rDistribution["< -2R"]++;
        else if (r < -1.5) rDistribution["-2R to -1.5R"]++;
        else if (r < -1) rDistribution["-1.5R to -1R"]++;
        else if (r < -0.5) rDistribution["-1R to -0.5R"]++;
        else if (r < 0) rDistribution["-0.5R to 0"]++;
        else if (r < 0.5) rDistribution["0 to 0.5R"]++;
        else if (r < 1) rDistribution["0.5R to 1R"]++;
        else if (r < 1.5) rDistribution["1R to 1.5R"]++;
        else if (r < 2) rDistribution["1.5R to 2R"]++;
        else if (r < 3) rDistribution["2R to 3R"]++;
        else rDistribution["> 3R"]++;
      }

      const sorted = [...allTradeDetails].sort((a, b) => b.r - a.r);
      const topWinners = sorted.slice(0, 5).map(t => ({
        ticker: t.ticker, date: t.date, r: Number(t.r.toFixed(3)),
        mfe: Number(t.mfe.toFixed(3)), gapPct: Number((t.gapPct * 100).toFixed(1)),
      }));
      const topLosers = sorted.slice(-5).reverse().map(t => ({
        ticker: t.ticker, date: t.date, r: Number(t.r.toFixed(3)),
        mfe: Number(t.mfe.toFixed(3)), mae: Number(t.mae.toFixed(3)),
        gapPct: Number((t.gapPct * 100).toFixed(1)),
      }));

      const dailyPnL: Record<string, number> = {};
      for (const d of dayResults) {
        if (d.date) dailyPnL[d.date] = Number((d.dayR ?? 0).toFixed(3));
      }
      const dailyRValues = Object.values(dailyPnL).filter(v => v !== 0);
      const positiveDays = dailyRValues.filter(v => v > 0).length;
      const negativeDays = dailyRValues.filter(v => v < 0).length;
      const bestDay = dailyRValues.length > 0 ? Math.max(...dailyRValues) : 0;
      const worstDay = dailyRValues.length > 0 ? Math.min(...dailyRValues) : 0;
      const top3DaysR = [...dailyRValues].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
      const pctFromTop3Days = totalR !== 0 ? top3DaysR / totalR * 100 : 0;

      const gapSizeDist: Record<string, { trades: number; avgR: number; winRate: number; totalR: number }> = {
        "6-8%": { trades: 0, avgR: 0, winRate: 0, totalR: 0 },
        "8-10%": { trades: 0, avgR: 0, winRate: 0, totalR: 0 },
        "10-15%": { trades: 0, avgR: 0, winRate: 0, totalR: 0 },
        "15-20%": { trades: 0, avgR: 0, winRate: 0, totalR: 0 },
        "20%+": { trades: 0, avgR: 0, winRate: 0, totalR: 0 },
      };
      const gapBucketWins: Record<string, number> = { "6-8%": 0, "8-10%": 0, "10-15%": 0, "15-20%": 0, "20%+": 0 };
      for (const t of allTradeDetails) {
        const gp = t.gapPct * 100;
        let bucket: string;
        if (gp < 8) bucket = "6-8%";
        else if (gp < 10) bucket = "8-10%";
        else if (gp < 15) bucket = "10-15%";
        else if (gp < 20) bucket = "15-20%";
        else bucket = "20%+";
        gapSizeDist[bucket].trades++;
        gapSizeDist[bucket].totalR += t.r;
        if (t.r > 0) gapBucketWins[bucket]++;
      }
      for (const key of Object.keys(gapSizeDist)) {
        const b = gapSizeDist[key];
        b.avgR = b.trades > 0 ? Number((b.totalR / b.trades).toFixed(3)) : 0;
        b.winRate = b.trades > 0 ? Number((gapBucketWins[key] / b.trades * 100).toFixed(1)) : 0;
        b.totalR = Number(b.totalR.toFixed(3));
      }

      const passCriteria = {
        avgR_ge_0_15: avgR >= 0.15,
        pf_ge_1_3: profitFactor >= 1.3,
        mfe2R_ge_20pct: trades > 0 && (mfe2R / trades * 100) >= 20,
        no_regime_collapse: worstDay > -5 && tail3RCount <= Math.max(1, Math.floor(trades * 0.03)),
      };
      const passCount = Object.values(passCriteria).filter(Boolean).length;
      const verdict = passCount === 4 ? "PAPER_READY" : passCount >= 3 ? "MARGINAL" : "NOT_READY";

      res.json({
        strategy: "Small-Cap Momentum Extended OOS",
        frozenConfig: {
          minGapPct: frozenConfig.minGapPct,
          minPremarketVolume: frozenConfig.minPremarketVolume,
          trailOffsetR: frozenConfig.trailOffsetR,
          trailActivationR: frozenConfig.trailActivationR,
        },
        window: { start: startDate, end: endDate, tradingDays: scanDates.length },
        coreMetrics: {
          trades, wins, losses: trades - wins,
          winRate: trades > 0 ? Number((wins / trades * 100).toFixed(1)) : 0,
          avgR: Number(avgR.toFixed(3)),
          medianR: Number(medianR.toFixed(3)),
          totalR: Number(totalR.toFixed(3)),
          profitFactor: Number(profitFactor.toFixed(3)),
          maxDrawdownR: Number(maxDD.toFixed(2)),
          daysWithTrades,
          tradesPerDay: Number((trades / scanDates.length).toFixed(2)),
          mfeMedian: Number(medianMFE.toFixed(3)),
          mfeAvg: Number(avgMFE.toFixed(3)),
          mfe1RPct: trades > 0 ? Number((mfe1R / trades * 100).toFixed(1)) : 0,
          mfe2RPct: trades > 0 ? Number((mfe2R / trades * 100).toFixed(1)) : 0,
          maeMedian: Number(medianMAE.toFixed(3)),
          worstTradeR: Number(worstTradeR.toFixed(3)),
          tail3RCount,
          spreadRejects,
        },
        diagnostics: {
          rDistribution,
          topWinners,
          topLosers,
          dailyClustering: {
            positiveDays,
            negativeDays,
            zeroDays: scanDates.length - positiveDays - negativeDays,
            bestDayR: Number(bestDay.toFixed(3)),
            worstDayR: Number(worstDay.toFixed(3)),
            top3DaysR: Number(top3DaysR.toFixed(3)),
            pctPnLFromTop3Days: Number(pctFromTop3Days.toFixed(1)),
            dailyPnL,
          },
          gapSizeBreakdown: gapSizeDist,
        },
        passCriteria,
        verdict,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start simulated market data feed
  startSimulatedDataFeed(broadcast, storage);

  return httpServer;
}
