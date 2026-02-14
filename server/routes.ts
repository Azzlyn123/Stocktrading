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
import { runHistoricalSimulation, runReversionSimulation, getActiveSimulations, cancelSimulation, startAutoRun, getAutoRunStatus, cancelAutoRun, runCostSensitivity, runWalkForwardEvaluation, getWalkForwardStatus, cancelWalkForward } from "./historicalSimulator";

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
      const result = await runCostSensitivity(req.params.id, user.id, storage);
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

  // Start simulated market data feed
  startSimulatedDataFeed(broadcast, storage);

  return httpServer;
}
