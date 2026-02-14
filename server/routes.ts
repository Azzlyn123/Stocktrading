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
import { runHistoricalSimulation, runReversionSimulation, runORFSimulation, runRSContinuationSimulation, getActiveSimulations, cancelSimulation, startAutoRun, getAutoRunStatus, cancelAutoRun, runCostSensitivity, runWalkForwardEvaluation, getWalkForwardStatus, cancelWalkForward } from "./historicalSimulator";
import { DEFAULT_RS_CONFIG, type RSConfig } from "./strategy/rsDetector";

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

    const variant1Results = await runVariant({ noTarget: false });
    const variant2Results = await runVariant({ noTarget: true });

    const aggregate = (results: any[]) => {
      let trades = 0, wins = 0, totalR = 0;
      const allRs: number[] = [];
      const allMFEs: number[] = [];
      const allMAEs: number[] = [];
      const lossBuckets: Record<string, number> = {
        stopped_before_0.3R: 0,
        reversed_after_0.3R: 0,
        partial_then_scratch: 0,
        other: 0
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

    const variant1Results = await runVariant({ noTarget: false, noPartial: false });
    const variant2Results = await runVariant({ noTarget: true, noPartial: false });
    const variant3Results = await runVariant({ noTarget: true, noPartial: true });

    res.json({
      variant1: aggregate(variant1Results),
      variant2: aggregate(variant2Results),
      variant3: aggregate(variant3Results),
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

    res.json({
      v1, v2, v3,
      windows: { dev: devDates.length, test: testDates.length }
    });
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

  // Start simulated market data feed
  startSimulatedDataFeed(broadcast, storage);

  return httpServer;
}
