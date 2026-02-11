import { storage } from "./storage";
import { log } from "./index";

export async function seedDemoData(userId: string) {
  const existingWatchlist = await storage.getAllWatchlist();
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
      rvol: 2.1,
      atrValue: 3.45,
      rejectionCount: 3,
      score: 82,
      scoreTier: "full",
      marketRegime: "aligned",
      spyAligned: true,
      volatilityGatePassed: true,
      scoreBreakdown: { rvol: 16, trend: 12, breakoutVolume: 18, retestVolume: 0, spyAlignment: 15, atrExpansion: 10, catalyst: 0 },
      notes: "SETUP forming: Breakout above $870.50 (3 rej). Score 82/100 (full). RVOL 2.1x. Body 72%. Vol 2.3x. 15m bias 3/3. SPY aligned.",
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
      rvol: 1.8,
      atrValue: 1.12,
      rejectionCount: 2,
      score: 71,
      scoreTier: "half",
      marketRegime: "aligned",
      spyAligned: true,
      volatilityGatePassed: true,
      scoreBreakdown: { rvol: 14, trend: 10, breakoutVolume: 16, retestVolume: 10, spyAlignment: 15, atrExpansion: 0, catalyst: 0 },
      notes: "Retesting $194.20 level. Score 71/100 (half size). RVOL 1.8x. 15m bias 2/3.",
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
      rvol: 3.2,
      atrValue: 2.34,
      rejectionCount: 2,
      pnl: 199.5,
      pnlPercent: 0.4,
      score: 88,
      scoreTier: "full",
      marketRegime: "aligned",
      entryMode: "conservative",
      stopBasis: "retest_low",
      spyAligned: true,
      volatilityGatePassed: true,
      scoreBreakdown: { rvol: 20, trend: 15, breakoutVolume: 18, retestVolume: 12, spyAlignment: 15, atrExpansion: 8, catalyst: 0 },
      notes: "TRIGGER at $174.50 (Bullish Engulfing). Stop $172.90 (retest_low). T1 $176.10 (+1R, partial 50%). T2 $178.80 (+2.5R trail). Score 88/100. RVOL 3.2x. Size 100%. Entry: conservative.",
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
      title: "SETUP forming (Score 82)",
      message: "NVDA broke above $870.50 resistance (3 rej). Score 82/100 (full). RVOL 2.1x. 15m bias 3/3. SPY aligned.",
      priority: "high",
      isRead: false,
    },
    {
      ticker: "AAPL",
      type: "RETEST",
      title: "Retest in Progress",
      message: "AAPL pulling back to $194.20 breakout level. Score 71/100 (half size). RVOL 1.8x.",
      priority: "medium",
      isRead: false,
    },
    {
      ticker: "AMD",
      type: "TRIGGER",
      title: "TRIGGER hit - Score 88 (full) - Bullish Engulfing",
      message: "AMD triggered at $174.50. Stop $172.90 (retest_low). T1 $176.10. T2 $178.80. R:R 2.7. RVOL 3.2x. Conservative entry.",
      priority: "high",
      isRead: false,
    },
    {
      ticker: "SPY",
      type: "INFO",
      title: "Market Regime: Aligned",
      message: "SPY above VWAP, 5m EMA9 > EMA20. Trending conditions - full size allowed.",
      priority: "low",
      isRead: true,
    },
  ];

  for (const alert of alertConfigs) {
    await storage.createAlert({ userId, ...alert });
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const yesterdayDate = yesterday.toISOString().split("T")[0];
  const twoDaysAgoDate = twoDaysAgo.toISOString().split("T")[0];

  const amdTrade = await storage.createTrade({
    userId,
    ticker: "AMD",
    side: "long",
    entryPrice: 174.5,
    stopPrice: 172.9,
    originalStopPrice: 172.9,
    target1: 176.1,
    target2: 178.8,
    shares: 285,
    status: "open",
    dollarRisk: 456,
    score: 88,
    scoreTier: "full",
    entryMode: "conservative",
  });
  await storage.updateTrade(amdTrade.id, { enteredAt: yesterday });

  const msftTrade = await storage.createTrade({
    userId,
    ticker: "MSFT",
    side: "long",
    entryPrice: 418.2,
    exitPrice: 422.5,
    stopPrice: 418.2,
    originalStopPrice: 415.8,
    target1: 420.6,
    target2: 424.2,
    shares: 120,
    pnl: 516,
    pnlPercent: 1.03,
    rMultiple: 1.79,
    status: "closed",
    exitReason: "trailing_stop",
    isPartiallyExited: true,
    partialExitPrice: 420.6,
    partialExitShares: 60,
    stopMovedToBE: true,
    runnerShares: 60,
    score: 79,
    scoreTier: "half",
    entryMode: "conservative",
  });
  await storage.updateTrade(msftTrade.id, { enteredAt: twoDaysAgo, exitedAt: twoDaysAgo });

  const googlTrade = await storage.createTrade({
    userId,
    ticker: "GOOGL",
    side: "long",
    entryPrice: 154.8,
    exitPrice: 153.6,
    stopPrice: 153.5,
    originalStopPrice: 153.5,
    target1: 156.1,
    target2: 157.8,
    shares: 320,
    pnl: -384,
    pnlPercent: -0.77,
    rMultiple: -0.92,
    status: "closed",
    exitReason: "stop_loss",
    dollarRisk: 416,
    score: 72,
    scoreTier: "half",
    entryMode: "aggressive",
  });
  await storage.updateTrade(googlTrade.id, { enteredAt: yesterday, exitedAt: yesterday });

  await storage.createSummary({
    userId,
    date: twoDaysAgoDate,
    totalTrades: 1,
    winningTrades: 1,
    losingTrades: 0,
    winRate: 100,
    avgRMultiple: 1.79,
    totalPnl: 516,
    maxDrawdown: 0,
    ruleViolations: 0,
    ruleViolationDetails: [],
    accountBalance: 100516,
  });

  await storage.createSummary({
    userId,
    date: yesterdayDate,
    totalTrades: 1,
    winningTrades: 0,
    losingTrades: 1,
    winRate: 0,
    avgRMultiple: -0.92,
    totalPnl: -384,
    maxDrawdown: -384,
    ruleViolations: 0,
    ruleViolationDetails: [],
    accountBalance: 100132,
  });

  log(`Seeded demo data for user ${userId}`, "seed");
}
