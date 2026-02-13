// src/utils/price.ts

export const DEFAULT_TICK = 0.01;

/**
 * Rounds a price to the nearest tick (default: $0.01 for US equities).
 * Uses scaling math to avoid floating-point precision drift.
 */
export function roundToTick(price: number, tick: number = DEFAULT_TICK): number {
  if (!Number.isFinite(price)) {
    throw new Error(`roundToTick received invalid price: ${price}`);
  }

  const scale = Math.round(1 / tick); // for 0.01 => 100
  return Math.round(price * scale) / scale;
}

/**
 * Forces price to exactly 2 decimal places.
 */
export function roundTo2(price: number): number {
  return Number(price.toFixed(2));
}

/**
 * Normalizes a price:
 * 1. Rounds to tick grid
 * 2. Forces 2 decimals
 */
export function normalizePrice(price: number, tick: number = DEFAULT_TICK): number {
  return roundTo2(roundToTick(price, tick));
}
