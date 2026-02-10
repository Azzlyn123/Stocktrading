import type { IStorage } from "./storage";
import { log } from "./index";

interface SimulatedTicker {
  ticker: string;
  name: string;
  sector: string;
  basePrice: number;
  volatility: number;
  trend: number;
  avgDailyVolume: number;
}

const SIMULATED_TICKERS: SimulatedTicker[] = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology", basePrice: 195.0, volatility: 0.008, trend: 0.0002, avgDailyVolume: 55000000 },
  { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology", basePrice: 420.0, volatility: 0.007, trend: 0.0003, avgDailyVolume: 22000000 },
  { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Technology", basePrice: 875.0, volatility: 0.015, trend: 0.0005, avgDailyVolume: 45000000 },
  { ticker: "AMZN", name: "Amazon.com Inc.", sector: "Consumer", basePrice: 185.0, volatility: 0.009, trend: 0.0002, avgDailyVolume: 38000000 },
  { ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology", basePrice: 155.0, volatility: 0.008, trend: 0.0001, avgDailyVolume: 25000000 },
  { ticker: "META", name: "Meta Platforms", sector: "Technology", basePrice: 505.0, volatility: 0.012, trend: 0.0004, avgDailyVolume: 18000000 },
  { ticker: "TSLA", name: "Tesla Inc.", sector: "Consumer", basePrice: 245.0, volatility: 0.02, trend: -0.0001, avgDailyVolume: 95000000 },
  { ticker: "SPY", name: "S&P 500 ETF", sector: "ETF", basePrice: 510.0, volatility: 0.004, trend: 0.0001, avgDailyVolume: 75000000 },
  { ticker: "QQQ", name: "Nasdaq-100 ETF", sector: "ETF", basePrice: 440.0, volatility: 0.005, trend: 0.0002, avgDailyVolume: 40000000 },
  { ticker: "AMD", name: "AMD Inc.", sector: "Technology", basePrice: 175.0, volatility: 0.014, trend: 0.0003, avgDailyVolume: 48000000 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Finance", basePrice: 195.0, volatility: 0.006, trend: 0.0001, avgDailyVolume: 10000000 },
  { ticker: "V", name: "Visa Inc.", sector: "Finance", basePrice: 280.0, volatility: 0.005, trend: 0.0002, avgDailyVolume: 7000000 },
  { ticker: "NFLX", name: "Netflix Inc.", sector: "Technology", basePrice: 620.0, volatility: 0.013, trend: 0.0003, avgDailyVolume: 5500000 },
  { ticker: "CRM", name: "Salesforce Inc.", sector: "Technology", basePrice: 265.0, volatility: 0.01, trend: 0.0002, avgDailyVolume: 6000000 },
  { ticker: "AVGO", name: "Broadcom Inc.", sector: "Technology", basePrice: 1350.0, volatility: 0.012, trend: 0.0004, avgDailyVolume: 3200000 },
  { ticker: "LLY", name: "Eli Lilly", sector: "Healthcare", basePrice: 780.0, volatility: 0.009, trend: 0.0003, avgDailyVolume: 3000000 },
];

interface PriceState {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  bars5m: Candle[];
  bars1h: Candle[];
  signalState: "IDLE" | "BREAKOUT" | "RETEST" | "TRIGGERED";
  resistanceLevel: number | null;
  breakoutDetected: boolean;
  retestComplete: boolean;
  retestSwingLow: number | null;
  barCount: number;
  dayVolume: number;
  changePct: number;
  rvol: number;
  atr14: number;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

const priceStates = new Map<string, PriceState>();

function initializePriceState(ticker: SimulatedTicker): PriceState {
  const variance = (Math.random() - 0.5) * ticker.basePrice * 0.02;
  const price = ticker.basePrice + variance;
  return {
    ticker: ticker.ticker,
    price,
    open: price,
    high: price,
    low: price,
    volume: Math.floor(Math.random() * 500000 + 100000),
    bars5m: [],
    bars1h: [],
    signalState: "IDLE",
    resistanceLevel: null,
    breakoutDetected: false,
    retestComplete: false,
    retestSwingLow: null,
    barCount: 0,
    dayVolume: Math.floor(Math.random() * 5000000 + 1000000),
    changePct: 0,
    rvol: 1.0,
    atr14: 0,
  };
}

function simulatePriceMove(state: PriceState, ticker: SimulatedTicker): void {
  const drift = ticker.trend;
  const vol = ticker.volatility;
  const rand = (Math.random() - 0.5) * 2;
  const change = state.price * (drift + vol * rand);
  state.price = Math.max(state.price + change, 1);
  state.high = Math.max(state.high, state.price);
  state.low = Math.min(state.low, state.price);
  const tickVol = Math.floor(Math.random() * 10000 + 1000);
  state.volume += tickVol;
  state.dayVolume += tickVol;
  state.changePct = ((state.price - ticker.basePrice) / ticker.basePrice) * 100;
  const expectedVolSoFar = ticker.avgDailyVolume * 0.3;
  state.rvol = expectedVolSoFar > 0 ? state.dayVolume / expectedVolSoFar : 1;
}

function create5mCandle(state: PriceState): Candle {
  const candle: Candle = {
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.price,
    volume: state.volume,
    timestamp: Date.now(),
  };
  state.bars5m.push(candle);
  if (state.bars5m.length > 100) state.bars5m.shift();
  state.open = state.price;
  state.high = state.price;
  state.low = state.price;
  state.volume = Math.floor(Math.random() * 50000 + 10000);
  state.barCount++;
  return candle;
}

function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calculateATR(candles: Candle[], period: number): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function findResistance(candles: Candle[], lookback: number): { level: number; rejections: number } | null {
  if (candles.length < lookback) return null;
  const recent = candles.slice(-lookback);
  let highestHigh = 0;
  let rejectionCount = 0;

  for (const c of recent) {
    if (c.high > highestHigh) highestHigh = c.high;
  }

  for (const c of recent) {
    if (Math.abs(c.high - highestHigh) / highestHigh < 0.003 && c.close < highestHigh) {
      rejectionCount++;
    }
  }

  return rejectionCount >= 2 ? { level: highestHigh, rejections: rejectionCount } : null;
}

function checkBreakoutSignal(
  state: PriceState,
  _ticker: SimulatedTicker,
  config: { breakoutBuffer: number; volumeMultiplier: number }
): {
  isBreakout: boolean;
  volumeConfirmed: boolean;
  atrExpansion: boolean;
  rvol: number;
  atrValue: number;
} {
  if (!state.resistanceLevel || state.bars5m.length < 20) {
    return { isBreakout: false, volumeConfirmed: false, atrExpansion: false, rvol: 0, atrValue: 0 };
  }

  const lastCandle = state.bars5m[state.bars5m.length - 1];
  const buffer = state.resistanceLevel * (config.breakoutBuffer / 100);
  const isBreakout = lastCandle.close > state.resistanceLevel + buffer;

  const volumes = state.bars5m.slice(-21, -1).map((c) => c.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeConfirmed = lastCandle.volume > avgVol * config.volumeMultiplier;
  const rvol = avgVol > 0 ? lastCandle.volume / avgVol : 1;

  const atr = calculateATR(state.bars5m, 14);
  const atrs = state.bars5m.slice(-20).map((_, i) => {
    const slice = state.bars5m.slice(0, state.bars5m.length - 20 + i + 1);
    return calculateATR(slice, 14);
  });
  const avgAtr = atrs.length > 0 ? atrs.reduce((a, b) => a + b, 0) / atrs.length : atr;
  const atrExpansion = atr > avgAtr;

  return { isBreakout, volumeConfirmed, atrExpansion, rvol, atrValue: atr };
}

function check1HTrend(bars1h: Candle[]): boolean {
  if (bars1h.length < 11) return true;
  const closes = bars1h.map((c) => c.close);
  const ema50 = calculateEMA(closes, Math.min(50, closes.length));
  const currentEma = ema50[ema50.length - 1];
  const pastEma = ema50[Math.max(0, ema50.length - 10)];
  const priceAboveEma = closes[closes.length - 1] > currentEma;
  const slopePositive = currentEma > pastEma;
  return priceAboveEma && slopePositive;
}

function isLunchChop(): boolean {
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const totalMin = est.getHours() * 60 + est.getMinutes();
  return totalMin >= 690 && totalMin < 810;
}

function isMarketHours(): boolean {
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const totalMin = est.getHours() * 60 + est.getMinutes();
  const day = est.getDay();
  return totalMin >= 570 && totalMin < 960 && day >= 1 && day <= 5;
}

function detectCandlePattern(candle: Candle, prevCandle?: Candle): string | null {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const isGreen = candle.close > candle.open;

  if (!isGreen) return null;

  if (range > 0 && body > range * 0.6) {
    if (prevCandle && prevCandle.close < prevCandle.open) {
      const prevBody = Math.abs(prevCandle.close - prevCandle.open);
      if (body > prevBody && candle.close > prevCandle.open && candle.open < prevCandle.close) {
        return "Bullish Engulfing";
      }
    }
  }

  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  if (lowerWick > body * 2 && upperWick < body * 0.5 && range > 0) {
    return "Hammer";
  }

  if (isGreen && body > range * 0.5) {
    return "Green Candle";
  }

  return null;
}

let activeUserIds: Set<string> = new Set();

export function registerUser(userId: string) {
  activeUserIds.add(userId);
}

export function unregisterUser(userId: string) {
  activeUserIds.delete(userId);
}

export interface ScannerItem {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  volume: number;
  avgDailyVolume: number;
  dollarVolume: number;
  rvol: number;
  atr14: number;
  signalState: string;
  resistanceLevel: number | null;
  passesFilters: boolean;
  trend1H: boolean;
}

export function getScannerData(filters: {
  minPrice: number;
  minAvgVolume: number;
  minDollarVolume: number;
}): ScannerItem[] {
  const items: ScannerItem[] = [];

  for (const tickerConfig of SIMULATED_TICKERS) {
    const state = priceStates.get(tickerConfig.ticker);
    if (!state) continue;

    const dollarVolume = state.price * tickerConfig.avgDailyVolume;
    const passesFilters =
      state.price >= filters.minPrice &&
      tickerConfig.avgDailyVolume >= filters.minAvgVolume &&
      dollarVolume >= filters.minDollarVolume;

    items.push({
      ticker: state.ticker,
      name: tickerConfig.name,
      sector: tickerConfig.sector,
      price: Number(state.price.toFixed(2)),
      changePct: Number(state.changePct.toFixed(2)),
      volume: state.dayVolume,
      avgDailyVolume: tickerConfig.avgDailyVolume,
      dollarVolume: Number(dollarVolume.toFixed(0)),
      rvol: Number(state.rvol.toFixed(2)),
      atr14: Number(state.atr14.toFixed(2)),
      signalState: state.signalState,
      resistanceLevel: state.resistanceLevel ? Number(state.resistanceLevel.toFixed(2)) : null,
      passesFilters,
      trend1H: check1HTrend(state.bars1h),
    });
  }

  return items.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

export function startSimulatedDataFeed(
  broadcast: (type: string, data: any) => void,
  storage: IStorage
) {
  for (const ticker of SIMULATED_TICKERS) {
    const state = initializePriceState(ticker);
    for (let i = 0; i < 50; i++) {
      simulatePriceMove(state, ticker);
      if (i % 5 === 4) create5mCandle(state);
    }
    state.atr14 = calculateATR(state.bars5m, 14);
    priceStates.set(ticker.ticker, state);
  }

  let tickCount = 0;

  setInterval(async () => {
    tickCount++;
    const priceUpdates: any[] = [];
    const lunchChop = isLunchChop();

    for (const tickerConfig of SIMULATED_TICKERS) {
      const state = priceStates.get(tickerConfig.ticker);
      if (!state) continue;

      simulatePriceMove(state, tickerConfig);

      priceUpdates.push({
        ticker: state.ticker,
        price: Number(state.price.toFixed(2)),
        change: Number(state.changePct.toFixed(2)),
        volume: state.dayVolume,
        rvol: Number(state.rvol.toFixed(2)),
      });

      if (tickCount % 10 === 0) {
        const candle = create5mCandle(state);
        state.atr14 = calculateATR(state.bars5m, 14);

        if (state.barCount % 12 === 0) {
          state.bars1h.push({
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            timestamp: candle.timestamp,
          });
          if (state.bars1h.length > 60) state.bars1h.shift();
        }

        const resistance = findResistance(state.bars5m, 48);
        if (resistance) {
          state.resistanceLevel = resistance.level;
        }

        const trendOk = check1HTrend(state.bars1h);

        if (state.signalState === "IDLE" && state.resistanceLevel && !lunchChop) {
          const { isBreakout, volumeConfirmed, atrExpansion, rvol, atrValue } = checkBreakoutSignal(
            state,
            tickerConfig,
            { breakoutBuffer: 0.1, volumeMultiplier: 1.5 }
          );

          if (isBreakout && trendOk) {
            state.signalState = "BREAKOUT";
            state.breakoutDetected = true;

            const rejections = resistance?.rejections ?? 2;

            const signalData = {
              ticker: state.ticker,
              state: "BREAKOUT" as const,
              resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
              currentPrice: Number(state.price.toFixed(2)),
              breakoutPrice: Number(state.price.toFixed(2)),
              breakoutVolume: candle.volume,
              trendConfirmed: trendOk,
              volumeConfirmed,
              atrExpansion,
              timeframe: "5m",
              rvol: Number(rvol.toFixed(2)),
              atrValue: Number(atrValue.toFixed(4)),
              rejectionCount: rejections,
              notes: `SETUP forming: Breakout above $${state.resistanceLevel.toFixed(2)} (${rejections} rejections). RVOL ${rvol.toFixed(1)}x. ${volumeConfirmed ? "Volume confirmed." : "Volume watching."} ${atrExpansion ? "ATR expanding." : ""} 1H trend ${trendOk ? "confirmed" : "unconfirmed"}.`,
            };

            broadcast("signal_update", signalData);

            for (const userId of activeUserIds) {
              try {
                await storage.createSignal({ userId, ...signalData });
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "SETUP",
                  title: "SETUP forming",
                  message: `${state.ticker} broke above $${state.resistanceLevel.toFixed(2)} resistance (${rejections} rejections). RVOL ${rvol.toFixed(1)}x. ${volumeConfirmed ? "Volume confirmed." : "Watching volume."} ${atrExpansion ? "ATR expanding." : ""}`,
                  priority: "high",
                  isRead: false,
                });
              } catch (e) {}
            }
          }
        }

        if (state.signalState === "BREAKOUT" && state.resistanceLevel) {
          const tolerance = state.resistanceLevel * 0.0015;
          if (Math.abs(state.price - state.resistanceLevel) <= tolerance) {
            state.signalState = "RETEST";
            state.retestSwingLow = state.low;

            broadcast("signal_update", {
              ticker: state.ticker,
              state: "RETEST",
              resistanceLevel: state.resistanceLevel,
              price: state.price,
            });

            for (const userId of activeUserIds) {
              try {
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "RETEST",
                  title: "Retest in Progress",
                  message: `${state.ticker} pulling back to $${state.resistanceLevel.toFixed(2)} breakout level within 0.15% tolerance.`,
                  priority: "medium",
                  isRead: false,
                });
              } catch (e) {}
            }
          }

          if (state.price < state.resistanceLevel * (1 - 0.0015)) {
            state.signalState = "IDLE";
            state.breakoutDetected = false;
            state.resistanceLevel = null;
          }
        }

        if (state.signalState === "RETEST" && state.resistanceLevel) {
          if (state.low < (state.retestSwingLow ?? state.low)) {
            state.retestSwingLow = state.low;
          }

          if (state.price < state.resistanceLevel * (1 - 0.0015)) {
            state.signalState = "IDLE";
            state.breakoutDetected = false;
            state.retestComplete = false;
            state.resistanceLevel = null;
            state.retestSwingLow = null;
          }

          const lastC = state.bars5m[state.bars5m.length - 1];
          const prevC = state.bars5m.length >= 2 ? state.bars5m[state.bars5m.length - 2] : undefined;
          const isGreen = lastC.close > lastC.open && lastC.close > state.resistanceLevel;

          if (isGreen && !lunchChop) {
            state.signalState = "TRIGGERED";
            state.retestComplete = true;

            const swingLow = state.retestSwingLow ?? state.low;
            const stopBuffer = swingLow * 0.0005;
            const stopPrice = Number((swingLow - stopBuffer).toFixed(2));
            const entryPrice = Number(state.price.toFixed(2));
            const risk = entryPrice - stopPrice;
            const target1 = Number((entryPrice + risk).toFixed(2));
            const target2 = Number((entryPrice + risk * 2.5).toFixed(2));
            const riskReward = risk > 0 ? (entryPrice + risk * 2.5 - entryPrice) / risk : 0;

            const pattern = detectCandlePattern(lastC, prevC);
            const atr = calculateATR(state.bars5m, 14);

            const { rvol } = checkBreakoutSignal(state, tickerConfig, { breakoutBuffer: 0.1, volumeMultiplier: 1.5 });

            const triggerData = {
              ticker: state.ticker,
              state: "TRIGGERED" as const,
              resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
              entryPrice,
              stopPrice,
              target1,
              target2,
              riskReward: Number(riskReward.toFixed(2)),
              currentPrice: entryPrice,
              trendConfirmed: true,
              volumeConfirmed: true,
              atrExpansion: true,
              candlePattern: pattern || "Green Candle",
              timeframe: "5m",
              rvol: Number(rvol.toFixed(2)),
              atrValue: Number(atr.toFixed(4)),
              notes: `TRIGGER hit at $${entryPrice}${pattern ? ` (${pattern})` : ""}. Stop $${stopPrice} (below retest swing low). T1 $${target1} (+1R, partial 50%). T2 $${target2} (+2.5R runner w/ ATR trail). RVOL ${rvol.toFixed(1)}x.`,
            };

            broadcast("signal_update", triggerData);

            for (const userId of activeUserIds) {
              try {
                const signal = await storage.createSignal({ userId, ...triggerData });

                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "TRIGGER",
                  title: `TRIGGER hit${pattern ? ` - ${pattern}` : ""}`,
                  message: `${state.ticker} triggered at $${entryPrice}. Stop $${stopPrice} (retest swing low). T1 $${target1} (+1R, partial 50%). T2 $${target2} (+2.5R). R:R ${riskReward.toFixed(1)}. RVOL ${rvol.toFixed(1)}x.`,
                  priority: "high",
                  isRead: false,
                  signalId: signal.id,
                });

                const user = await storage.getUser(userId);
                if (user && user.paperMode) {
                  const accountSize = user.accountSize ?? 100000;
                  const riskPct = (user.perTradeRiskPct ?? 0.5) / 100;
                  const dollarRisk = accountSize * riskPct;
                  let shares = risk > 0 ? Math.floor(dollarRisk / risk) : 0;
                  const maxPositionValue = accountSize * ((user.maxPositionPct ?? 20) / 100);
                  if (shares * entryPrice > maxPositionValue) {
                    shares = Math.floor(maxPositionValue / entryPrice);
                  }
                  if (shares > 0) {
                    const timeStopMinutes = user.timeStopMinutes ?? 30;
                    const timeStopAt = new Date(Date.now() + timeStopMinutes * 60 * 1000);
                    await storage.createTrade({
                      userId,
                      signalId: signal.id,
                      ticker: state.ticker,
                      side: "long",
                      entryPrice,
                      stopPrice,
                      originalStopPrice: stopPrice,
                      target1,
                      target2,
                      shares,
                      status: "open",
                      dollarRisk: Number((shares * risk).toFixed(2)),
                      timeStopAt: timeStopAt,
                    });
                  }
                }
              } catch (e) {}
            }

            setTimeout(() => {
              state.signalState = "IDLE";
              state.breakoutDetected = false;
              state.retestComplete = false;
              state.resistanceLevel = null;
              state.retestSwingLow = null;
            }, 120000);
          }
        }
      }
    }

    broadcast("price_update", priceUpdates);
  }, 2000);

  setInterval(() => {
    const now = new Date();
    const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hours = est.getHours();
    const minutes = est.getMinutes();
    const totalMin = hours * 60 + minutes;
    const day = est.getDay();
    const isOpen = totalMin >= 570 && totalMin < 960 && day >= 1 && day <= 5;
    const isLunch = totalMin >= 690 && totalMin < 810;
    broadcast("market_status", { isOpen, isLunchChop: isLunch, time: est.toISOString() });
  }, 30000);

  log("Simulated market data feed started", "simulator");
}
