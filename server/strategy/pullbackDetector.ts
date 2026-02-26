import { type Candle } from "./types";

export interface PullbackSignal {
  triggered: boolean;
  hodPrice: number;
  hodBarIndex: number;
  pullbackLow: number;
  pullbackLowIndex: number;
  rebreakBarIndex: number;
  entryPrice: number;
  stopPrice: number;
  riskPerShare: number;
  pullbackBars: number;
  pullbackDepthPct: number;
  volumeContraction: boolean;
}

export interface PullbackConfig {
  minPullbackBars: number;
  maxPullbackBars: number;
  minPullbackPct: number;
  maxPullbackPct: number;
  volumeContractionRequired: boolean;
  stopBufferPct: number;
  minRiskPct: number;
  maxRiskPct: number;
}

export const DEFAULT_PULLBACK_CONFIG: PullbackConfig = {
  minPullbackBars: 2,
  maxPullbackBars: 10,
  minPullbackPct: 0.01,
  maxPullbackPct: 0.50,
  volumeContractionRequired: false,
  stopBufferPct: 0.002,
  minRiskPct: 0.005,
  maxRiskPct: 0.05,
};

export interface HODState {
  hodPrice: number;
  hodBarIndex: number;
  hodBroken: boolean;
  pullbackStarted: boolean;
  pullbackLow: number;
  pullbackLowIndex: number;
  pullbackBarCount: number;
  avgBreakoutVolume: number;
  pullbackVolumes: number[];
  signalFired: boolean;
}

export function initHODState(): HODState {
  return {
    hodPrice: 0,
    hodBarIndex: -1,
    hodBroken: false,
    pullbackStarted: false,
    pullbackLow: Infinity,
    pullbackLowIndex: -1,
    pullbackBarCount: 0,
    avgBreakoutVolume: 0,
    pullbackVolumes: [],
    signalFired: false,
  };
}

export function updateHODState(
  state: HODState,
  bar: Candle,
  barIndex: number,
  openPrice: number,
  recentBars: Candle[],
): HODState {
  const s = { ...state, pullbackVolumes: [...state.pullbackVolumes] };

  if (s.signalFired) return s;

  if (!s.hodBroken) {
    if (bar.high > s.hodPrice) {
      s.hodPrice = bar.high;
      s.hodBarIndex = barIndex;
    }

    if (bar.high > openPrice && barIndex > 0 && s.hodPrice > openPrice) {
      const priorHigh = Math.max(...recentBars.slice(0, -1).map(b => b.high));
      if (bar.high > priorHigh && priorHigh > 0) {
        s.hodBroken = true;
        s.hodPrice = bar.high;
        s.hodBarIndex = barIndex;
        const breakoutBars = recentBars.slice(-3);
        s.avgBreakoutVolume = breakoutBars.reduce((sum, b) => sum + b.volume, 0) / breakoutBars.length;
      }
    }
    return s;
  }

  if (!s.pullbackStarted) {
    if (bar.close < s.hodPrice) {
      s.pullbackStarted = true;
      s.pullbackLow = bar.low;
      s.pullbackLowIndex = barIndex;
      s.pullbackBarCount = 1;
      s.pullbackVolumes = [bar.volume];
    } else {
      if (bar.high > s.hodPrice) {
        s.hodPrice = bar.high;
        s.hodBarIndex = barIndex;
      }
    }
    return s;
  }

  if (bar.low < s.pullbackLow) {
    s.pullbackLow = bar.low;
    s.pullbackLowIndex = barIndex;
  }
  s.pullbackBarCount++;
  s.pullbackVolumes.push(bar.volume);

  return s;
}

export function checkPullbackRebreak(
  state: HODState,
  bar: Candle,
  barIndex: number,
  config: PullbackConfig,
): PullbackSignal | null {
  if (state.signalFired) return null;
  if (!state.hodBroken || !state.pullbackStarted) return null;
  if (state.pullbackBarCount < config.minPullbackBars) return null;
  if (state.pullbackBarCount > config.maxPullbackBars) return null;

  const pullbackDepth = state.hodPrice > 0
    ? (state.hodPrice - state.pullbackLow) / state.hodPrice
    : 0;

  if (pullbackDepth < config.minPullbackPct || pullbackDepth > config.maxPullbackPct) return null;

  const rebreaks = bar.high > state.hodPrice;
  if (!rebreaks) return null;

  let volumeContraction = true;
  if (config.volumeContractionRequired && state.avgBreakoutVolume > 0) {
    const avgPullbackVol = state.pullbackVolumes.length > 0
      ? state.pullbackVolumes.reduce((s, v) => s + v, 0) / state.pullbackVolumes.length
      : 0;
    volumeContraction = avgPullbackVol < state.avgBreakoutVolume * 0.5;
  }

  if (config.volumeContractionRequired && !volumeContraction) return null;

  const entryPrice = state.hodPrice;
  const stopBuffer = entryPrice * config.stopBufferPct;
  const stopPrice = state.pullbackLow - stopBuffer;
  const riskPerShare = entryPrice - stopPrice;
  const riskPct = riskPerShare / entryPrice;

  if (riskPct < config.minRiskPct || riskPct > config.maxRiskPct) return null;

  return {
    triggered: true,
    hodPrice: state.hodPrice,
    hodBarIndex: state.hodBarIndex,
    pullbackLow: state.pullbackLow,
    pullbackLowIndex: state.pullbackLowIndex,
    rebreakBarIndex: barIndex,
    entryPrice,
    stopPrice,
    riskPerShare,
    pullbackBars: state.pullbackBarCount,
    pullbackDepthPct: pullbackDepth,
    volumeContraction,
  };
}
