import type { Candle } from "./types";

export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function lastEMA(values: number[], period: number): number {
  const ema = calculateEMA(values, period);
  return ema.length > 0 ? ema[ema.length - 1] : 0;
}

export function calculateATR(candles: Candle[], period: number): number {
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

export function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumulativeTPV += tp * c.volume;
    cumulativeVolume += c.volume;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

export function bodyPct(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  return Math.abs(candle.close - candle.open) / range;
}

export function candleRange(candle: Candle): number {
  return candle.high - candle.low;
}

export function avgVolume(candles: Candle[], count: number): number {
  const slice = candles.slice(-count);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

export function avgRange(candles: Candle[], count: number): number {
  const slice = candles.slice(-count);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + (c.high - c.low), 0) / slice.length;
}

export function isGreenCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

export function isRedCandle(candle: Candle): boolean {
  return candle.close < candle.open;
}

export function findResistance(
  candles: Candle[],
  lookback: number
): { level: number; rejections: number } | null {
  if (candles.length < lookback) return null;
  const recent = candles.slice(-lookback);
  const excludeRecent = 2;
  if (recent.length <= excludeRecent) return null;

  const priorBars = recent.slice(0, -excludeRecent);

  const highs = priorBars.map(c => c.high).sort((a, b) => b - a);
  const tolerance = 0.004;
  let bestLevel = 0;
  let bestCount = 0;

  for (let i = 0; i < Math.min(highs.length, 10); i++) {
    const candidate = highs[i];
    let touches = 0;
    for (const c of priorBars) {
      if (Math.abs(c.high - candidate) / candidate < tolerance && c.close < candidate) {
        touches++;
      }
    }
    if (touches > bestCount) {
      bestCount = touches;
      bestLevel = candidate;
    }
  }

  if (bestCount >= 2) {
    return { level: bestLevel, rejections: bestCount };
  }

  let highestHigh = 0;
  for (const c of priorBars) {
    if (c.high > highestHigh) highestHigh = c.high;
  }
  let rejectionCount = 0;
  for (const c of priorBars) {
    if (Math.abs(c.high - highestHigh) / highestHigh < tolerance && c.close < highestHigh) {
      rejectionCount++;
    }
  }

  return rejectionCount >= 2
    ? { level: highestHigh, rejections: rejectionCount }
    : null;
}

export function countVWAPCrosses(
  candles: Candle[],
  windowBars: number
): number {
  const slice = candles.slice(-windowBars);
  if (slice.length < 2) return 0;

  let crosses = 0;
  let runningVwap = calculateVWAP(slice.slice(0, 1));

  for (let i = 1; i < slice.length; i++) {
    const prevVwap = runningVwap;
    runningVwap = calculateVWAP(slice.slice(0, i + 1));
    const prevAbove = slice[i - 1].close > prevVwap;
    const currAbove = slice[i].close > runningVwap;
    if (prevAbove !== currAbove) crosses++;
  }

  return crosses;
}

export function dailyATRpct(candles: Candle[], period: number): number {
  const atr = calculateATR(candles, period);
  if (candles.length === 0) return 0;
  const lastClose = candles[candles.length - 1].close;
  return lastClose > 0 ? (atr / lastClose) * 100 : 0;
}

export function firstNMinutesRange(
  candles: Candle[],
  n: number,
  barMinutes: number
): number {
  const barsNeeded = Math.ceil(n / barMinutes);
  const slice = candles.slice(0, Math.min(barsNeeded, candles.length));
  if (slice.length === 0) return 0;
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  return high - low;
}

export function yesterdayRange(dailyCandles: Candle[]): number {
  if (dailyCandles.length === 0) return 0;
  const last = dailyCandles[dailyCandles.length - 1];
  return last.high - last.low;
}

export function detectCandlePattern(
  candle: Candle,
  prevCandle?: Candle
): string | null {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const isGreen = candle.close > candle.open;

  if (!isGreen) return null;

  if (range > 0 && body > range * 0.6) {
    if (prevCandle && prevCandle.close < prevCandle.open) {
      const prevBody = Math.abs(prevCandle.close - prevCandle.open);
      if (
        body > prevBody &&
        candle.close > prevCandle.open &&
        candle.open < prevCandle.close
      ) {
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
