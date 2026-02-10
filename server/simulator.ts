import type { IStorage } from "./storage";
import { log } from "./index";

interface SimulatedTicker {
  ticker: string;
  basePrice: number;
  volatility: number;
  trend: number;
}

const SIMULATED_TICKERS: SimulatedTicker[] = [
  { ticker: "AAPL", basePrice: 195.0, volatility: 0.008, trend: 0.0002 },
  { ticker: "MSFT", basePrice: 420.0, volatility: 0.007, trend: 0.0003 },
  { ticker: "NVDA", basePrice: 875.0, volatility: 0.015, trend: 0.0005 },
  { ticker: "AMZN", basePrice: 185.0, volatility: 0.009, trend: 0.0002 },
  { ticker: "GOOGL", basePrice: 155.0, volatility: 0.008, trend: 0.0001 },
  { ticker: "META", basePrice: 505.0, volatility: 0.012, trend: 0.0004 },
  { ticker: "TSLA", basePrice: 245.0, volatility: 0.02, trend: -0.0001 },
  { ticker: "SPY", basePrice: 510.0, volatility: 0.004, trend: 0.0001 },
  { ticker: "QQQ", basePrice: 440.0, volatility: 0.005, trend: 0.0002 },
  { ticker: "AMD", basePrice: 175.0, volatility: 0.014, trend: 0.0003 },
  { ticker: "JPM", basePrice: 195.0, volatility: 0.006, trend: 0.0001 },
  { ticker: "V", basePrice: 280.0, volatility: 0.005, trend: 0.0002 },
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
  barCount: number;
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
    barCount: 0,
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
  state.volume += Math.floor(Math.random() * 10000 + 1000);
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

function findResistance(candles: Candle[], lookback: number): number | null {
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

  return rejectionCount >= 2 ? highestHigh : null;
}

function checkBreakoutSignal(
  state: PriceState,
  _ticker: SimulatedTicker,
  config: { breakoutBuffer: number; volumeMultiplier: number }
): {
  isBreakout: boolean;
  volumeConfirmed: boolean;
  atrExpansion: boolean;
} {
  if (!state.resistanceLevel || state.bars5m.length < 20) {
    return { isBreakout: false, volumeConfirmed: false, atrExpansion: false };
  }

  const lastCandle = state.bars5m[state.bars5m.length - 1];
  const buffer = state.resistanceLevel * (config.breakoutBuffer / 100);
  const isBreakout = lastCandle.close > state.resistanceLevel + buffer;

  const volumes = state.bars5m.slice(-21, -1).map((c) => c.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeConfirmed = lastCandle.volume > avgVol * config.volumeMultiplier;

  const atr = calculateATR(state.bars5m, 14);
  const atrs = state.bars5m.slice(-20).map((_, i) => {
    const slice = state.bars5m.slice(0, state.bars5m.length - 20 + i + 1);
    return calculateATR(slice, 14);
  });
  const avgAtr = atrs.length > 0 ? atrs.reduce((a, b) => a + b, 0) / atrs.length : atr;
  const atrExpansion = atr > avgAtr;

  return { isBreakout, volumeConfirmed, atrExpansion };
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

let activeUserIds: Set<string> = new Set();

export function registerUser(userId: string) {
  activeUserIds.add(userId);
}

export function unregisterUser(userId: string) {
  activeUserIds.delete(userId);
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
    priceStates.set(ticker.ticker, state);
  }

  let tickCount = 0;

  setInterval(async () => {
    tickCount++;
    const priceUpdates: any[] = [];

    for (const tickerConfig of SIMULATED_TICKERS) {
      const state = priceStates.get(tickerConfig.ticker);
      if (!state) continue;

      simulatePriceMove(state, tickerConfig);

      priceUpdates.push({
        ticker: state.ticker,
        price: Number(state.price.toFixed(2)),
        change: Number(((state.price - tickerConfig.basePrice) / tickerConfig.basePrice * 100).toFixed(2)),
        volume: state.volume,
      });

      if (tickCount % 10 === 0) {
        const candle = create5mCandle(state);

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
        if (resistance) state.resistanceLevel = resistance;

        const trendOk = check1HTrend(state.bars1h);

        if (state.signalState === "IDLE" && state.resistanceLevel) {
          const { isBreakout, volumeConfirmed, atrExpansion } = checkBreakoutSignal(
            state,
            tickerConfig,
            { breakoutBuffer: 0.1, volumeMultiplier: 1.5 }
          );

          if (isBreakout && trendOk) {
            state.signalState = "BREAKOUT";
            state.breakoutDetected = true;

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
              notes: `Breakout above $${state.resistanceLevel.toFixed(2)} with ${volumeConfirmed ? "confirmed" : "unconfirmed"} volume`,
            };

            broadcast("signal_update", signalData);

            for (const userId of activeUserIds) {
              try {
                await storage.createSignal({ userId, ...signalData });
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "SETUP",
                  title: "Breakout Detected",
                  message: `${state.ticker} broke above $${state.resistanceLevel.toFixed(2)} resistance. ${volumeConfirmed ? "Volume confirmed." : "Watching volume."} ${atrExpansion ? "ATR expanding." : ""}`,
                  priority: "high",
                  isRead: false,
                });
              } catch (e) {}
            }
          }
        }

        if (state.signalState === "BREAKOUT" && state.resistanceLevel) {
          const retestZone = state.resistanceLevel * 1.0015;
          if (state.price <= retestZone && state.price >= state.resistanceLevel * 0.9985) {
            state.signalState = "RETEST";

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
                  message: `${state.ticker} pulling back to $${state.resistanceLevel.toFixed(2)} breakout level.`,
                  priority: "medium",
                  isRead: false,
                });
              } catch (e) {}
            }
          }
        }

        if (state.signalState === "RETEST" && state.resistanceLevel) {
          const lastC = state.bars5m[state.bars5m.length - 1];
          if (lastC.close > lastC.open && lastC.close > state.resistanceLevel) {
            state.signalState = "TRIGGERED";
            state.retestComplete = true;

            const stopPrice = Number((state.low * 0.9995).toFixed(2));
            const risk = state.price - stopPrice;
            const target1 = Number((state.price + risk).toFixed(2));
            const target2 = Number((state.price + risk * 2.5).toFixed(2));
            const entryPrice = Number(state.price.toFixed(2));

            const triggerData = {
              ticker: state.ticker,
              state: "TRIGGERED" as const,
              resistanceLevel: Number(state.resistanceLevel.toFixed(2)),
              entryPrice,
              stopPrice,
              target1,
              target2,
              riskReward: 2.5,
              currentPrice: entryPrice,
              trendConfirmed: true,
              volumeConfirmed: true,
              atrExpansion: true,
              candlePattern: lastC.close > lastC.open && (lastC.close - lastC.open) > (lastC.high - lastC.low) * 0.6 ? "Bullish Engulfing" : "Green Candle",
              timeframe: "5m",
              notes: `Trigger confirmed at $${entryPrice} after clean retest. Stop $${stopPrice}, T1 $${target1}, T2 $${target2}.`,
            };

            broadcast("signal_update", triggerData);

            for (const userId of activeUserIds) {
              try {
                await storage.createSignal({ userId, ...triggerData });
                await storage.createAlert({
                  userId,
                  ticker: state.ticker,
                  type: "TRIGGER",
                  title: `Entry Signal - ${triggerData.candlePattern}`,
                  message: `${state.ticker} triggered at $${entryPrice}. Stop $${stopPrice}, T1 $${target1}, T2 $${target2}. R:R 2.5`,
                  priority: "high",
                  isRead: false,
                });
              } catch (e) {}
            }

            setTimeout(() => {
              state.signalState = "IDLE";
              state.breakoutDetected = false;
              state.retestComplete = false;
              state.resistanceLevel = null;
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
    broadcast("market_status", { isOpen, time: est.toISOString() });
  }, 30000);

  log("Simulated market data feed started", "simulator");
}
