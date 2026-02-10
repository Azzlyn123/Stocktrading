import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import passport from "passport";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { insertUserSchema, settingsUpdateSchema } from "@shared/schema";
import type { User } from "@shared/schema";
import { startSimulatedDataFeed, registerUser, unregisterUser } from "./simulator";
import { seedDemoData } from "./seed";

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

  // Watchlist
  app.get("/api/watchlist", requireAuth, async (req, res) => {
    const items = await storage.getWatchlist(req.user!.id);
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
    await storage.removeWatchlistItem(req.params.id, req.user!.id);
    res.json({ ok: true });
  });

  // Signals
  app.get("/api/signals", requireAuth, async (req, res) => {
    const items = await storage.getSignals(req.user!.id);
    res.json(items);
  });

  // Alerts
  app.get("/api/alerts", requireAuth, async (req, res) => {
    const items = await storage.getAlerts(req.user!.id);
    res.json(items);
  });

  app.post("/api/alerts/mark-read", requireAuth, async (req, res) => {
    await storage.markAlertsRead(req.user!.id);
    res.json({ ok: true });
  });

  // Paper Trades
  app.get("/api/trades", requireAuth, async (req, res) => {
    const items = await storage.getTrades(req.user!.id);
    res.json(items);
  });

  // Daily Summaries
  app.get("/api/summaries", requireAuth, async (req, res) => {
    const items = await storage.getSummaries(req.user!.id);
    res.json(items);
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

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  function broadcast(type: string, data: any) {
    const msg = JSON.stringify({ type, data });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // Start simulated market data feed
  startSimulatedDataFeed(broadcast, storage);

  return httpServer;
}
