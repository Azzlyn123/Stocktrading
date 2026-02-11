import type { StrategyConfig } from "./types";

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  universe: {
    minPrice: 10,
    minAvgDollarVolume: 100_000_000,
    maxSpreadPct: 0.05,
    minDailyATRpct: 1.2,
    minRVOL: 1.5,
    rvolCutoffMinutes: 15,
  },
  higherTimeframe: {
    requiredConfirmations: 2,
  },
  breakout: {
    minBodyPct: 0.60,
    minVolumeMultiplier: 1.8,
    minRangeMultiplier: 1.2,
    bufferPct: 0.10,
  },
  retest: {
    maxPullbackPct: 50,
    tolerancePct: 0.15,
    entryMode: "conservative",
  },
  marketRegime: {
    maxVwapCrosses: 3,
    vwapCrossWindowMinutes: 20,
    chopSizeReduction: 0.50,
  },
  volatilityGate: {
    firstRangeMinPct: 70,
    atrExpansionMultiplier: 1.3,
  },
  scoring: {
    rvolThreshold: 2.0,
    breakoutVolumeThreshold: 2.0,
    fullSizeMin: 80,
    halfSizeMin: 65,
  },
  exits: {
    partialAtR: 1.0,
    partialPct: 50,
    useEMA9Trail: true,
    usePriorLowTrail: true,
    hardExitRedCandles: 2,
  },
  risk: {
    perTradeRiskPct: 0.5,
    maxPositionPct: 20,
    maxDailyLossPct: 2,
    maxLosingTrades: 3,
    cooldownMinutes: 15,
    timeStopMinutes: 30,
    timeStopR: 0.5,
  },
  riskMode: "balanced",
  powerSetupEnabled: true,
};

export function buildConfigFromUser(user: any): StrategyConfig {
  return {
    universe: {
      minPrice: user.minPrice ?? 10,
      minAvgDollarVolume: user.minDollarVolume ?? 100_000_000,
      maxSpreadPct: user.maxSpreadPct ?? 0.05,
      minDailyATRpct: user.minDailyATRpct ?? 1.2,
      minRVOL: user.minRVOL ?? 1.5,
      rvolCutoffMinutes: user.rvolCutoffMinutes ?? 15,
    },
    higherTimeframe: {
      requiredConfirmations: user.htfConfirmations ?? 2,
    },
    breakout: {
      minBodyPct: user.breakoutMinBodyPct ?? 0.60,
      minVolumeMultiplier: user.volumeMultiplier ?? 1.8,
      minRangeMultiplier: user.breakoutMinRangeMultiplier ?? 1.2,
      bufferPct: user.breakoutBuffer ?? 0.10,
    },
    retest: {
      maxPullbackPct: user.retestMaxPullbackPct ?? 50,
      tolerancePct: user.retestBuffer ?? 0.15,
      entryMode: user.entryMode ?? "conservative",
    },
    marketRegime: {
      maxVwapCrosses: user.maxVwapCrosses ?? 3,
      vwapCrossWindowMinutes: user.vwapCrossWindowMin ?? 20,
      chopSizeReduction: user.chopSizeReduction ?? 0.50,
    },
    volatilityGate: {
      firstRangeMinPct: user.volGateFirstRangePct ?? 70,
      atrExpansionMultiplier: user.volGateAtrMultiplier ?? 1.3,
    },
    scoring: {
      rvolThreshold: user.scoreRvolThreshold ?? 2.0,
      breakoutVolumeThreshold: user.scoreBreakoutVolThreshold ?? 2.0,
      fullSizeMin: user.scoreFullSizeMin ?? 80,
      halfSizeMin: user.scoreHalfSizeMin ?? 65,
    },
    riskMode: (user.riskMode as "conservative" | "balanced" | "aggressive") ?? "balanced",
    powerSetupEnabled: user.powerSetupEnabled ?? true,
    exits: {
      partialAtR: user.partialExitR ?? 1.0,
      partialPct: user.partialExitPct ?? 50,
      useEMA9Trail: true,
      usePriorLowTrail: true,
      hardExitRedCandles: 2,
    },
    risk: {
      perTradeRiskPct: user.perTradeRiskPct ?? 0.5,
      maxPositionPct: user.maxPositionPct ?? 20,
      maxDailyLossPct: user.maxDailyLossPct ?? 2,
      maxLosingTrades: user.maxLosingTrades ?? 3,
      cooldownMinutes: user.cooldownMinutes ?? 15,
      timeStopMinutes: user.timeStopMinutes ?? 30,
      timeStopR: user.timeStopR ?? 0.5,
    },
  };
}
