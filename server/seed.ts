import { storage } from "./storage";
import { log } from "./index";

export async function seedDemoData(userId: string) {
  const existingWatchlist = await storage.getWatchlist(userId);
  if (existingWatchlist.length > 0) return;

  const defaultTickers = [
    { ticker: "AAPL", name: "Apple Inc.", sector: "Technology" },
    { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
    { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Technology" },
    { ticker: "SPY", name: "S&P 500 ETF", sector: "ETF" },
    { ticker: "QQQ", name: "Nasdaq-100 ETF", sector: "ETF" },
    { ticker: "AMD", name: "AMD Inc.", sector: "Technology" },
  ];

  for (const t of defaultTickers) {
    await storage.addWatchlistItem({
      userId,
      ticker: t.ticker,
      name: t.name,
      sector: t.sector,
      isActive: true,
    });
  }

  const now = new Date();
  const signalConfigs = [
    {
      ticker: "NVDA",
      state: "BREAKOUT" as const,
      resistanceLevel: 870.5,
      breakoutPrice: 872.1,
      currentPrice: 875.3,
      trendConfirmed: true,
      volumeConfirmed: true,
      atrExpansion: true,
      notes: "Strong breakout above key 870 resistance with volume surge",
    },
    {
      ticker: "AAPL",
      state: "RETEST" as const,
      resistanceLevel: 194.2,
      breakoutPrice: 194.5,
      currentPrice: 194.3,
      trendConfirmed: true,
      volumeConfirmed: true,
      atrExpansion: false,
      notes: "Retesting breakout level at 194.20, watching for bullish confirmation",
    },
    {
      ticker: "AMD",
      state: "TRIGGERED" as const,
      resistanceLevel: 173.8,
      breakoutPrice: 174.0,
      entryPrice: 174.5,
      stopPrice: 172.9,
      target1: 176.1,
      target2: 178.8,
      currentPrice: 175.2,
      riskReward: 2.7,
      positionSize: 285,
      dollarRisk: 456,
      trendConfirmed: true,
      volumeConfirmed: true,
      atrExpansion: true,
      candlePattern: "Bullish Engulfing",
      pnl: 199.5,
      pnlPercent: 0.4,
      notes: "Entry confirmed after clean retest with engulfing candle",
    },
  ];

  for (const config of signalConfigs) {
    await storage.createSignal({
      userId,
      ...config,
      timeframe: "5m",
    });
  }

  const alertConfigs = [
    {
      ticker: "NVDA",
      type: "SETUP",
      title: "Breakout Detected",
      message: "NVDA broke above $870.50 resistance with 2.1x average volume. Watching for retest.",
      priority: "high",
      isRead: false,
    },
    {
      ticker: "AAPL",
      type: "RETEST",
      title: "Retest in Progress",
      message: "AAPL pulling back to $194.20 breakout level. 1H trend confirmed bullish.",
      priority: "medium",
      isRead: false,
    },
    {
      ticker: "AMD",
      type: "TRIGGER",
      title: "Entry Signal - Bullish Engulfing",
      message: "AMD triggered at $174.50 after clean retest. Stop $172.90, T1 $176.10, T2 $178.80. R:R 2.7",
      priority: "high",
      isRead: false,
    },
    {
      ticker: "SPY",
      type: "INFO",
      title: "Resistance Identified",
      message: "SPY showing resistance at $512.30 with 3 rejections in last 48 bars.",
      priority: "low",
      isRead: true,
    },
  ];

  for (const alert of alertConfigs) {
    await storage.createAlert({
      userId,
      ...alert,
    });
  }

  await storage.createTrade({
    userId,
    ticker: "AMD",
    side: "long",
    entryPrice: 174.5,
    stopPrice: 172.9,
    target1: 176.1,
    target2: 178.8,
    shares: 285,
    status: "open",
  });

  await storage.createTrade({
    userId,
    ticker: "MSFT",
    side: "long",
    entryPrice: 418.2,
    exitPrice: 422.5,
    stopPrice: 415.8,
    target1: 420.6,
    target2: 424.2,
    shares: 120,
    pnl: 516,
    pnlPercent: 1.03,
    rMultiple: 1.79,
    status: "closed",
    exitReason: "Target 1 partial + trailing stop",
  });

  await storage.createTrade({
    userId,
    ticker: "GOOGL",
    side: "long",
    entryPrice: 154.8,
    exitPrice: 153.6,
    stopPrice: 153.5,
    target1: 156.1,
    target2: 157.8,
    shares: 320,
    pnl: -384,
    pnlPercent: -0.77,
    rMultiple: -0.92,
    status: "closed",
    exitReason: "Stop loss hit",
  });

  const today = now.toISOString().split("T")[0];
  await storage.createSummary({
    userId,
    date: today,
    totalTrades: 2,
    winningTrades: 1,
    losingTrades: 1,
    winRate: 50,
    avgRMultiple: 0.44,
    totalPnl: 132,
    maxDrawdown: -384,
    ruleViolations: 0,
    accountBalance: 100132,
  });

  log(`Seeded demo data for user ${userId}`, "seed");
}
