import type { StrategyConfig, TieredStrategyConfig, TradeTier } from "./types";

export const DEFAULT_TIERED_CONFIG: TieredStrategyConfig = {
  filters: {
    minPrice: 10,
    minDollarVolume: 50_000_000,
    maxSpreadPct: 0.10,
    blacklist: [],
  },
  sessions: {
    open: ["09:35", "11:00"],
    mid: ["11:00", "13:30"],
    power: ["13:30", "15:55"],
  },
  marketFilter: {
    marketSymbol: "SPY",
    tierABypass: true,
    requireAboveVWAPForLong: true,
    requireBelowVWAPForShort: true,
  },
  strategy: {
    timeframe: "5m",
    volumeLookback: 20,
    atrLen: 14,
    atrMaLen: 20,
    minBreakoutClosePct: 0.0005,
    minBodyPct: 0.50,
  },
  tiers: {
    A: {
      volumeRatioMin: 1.5,
      atrRatioMin: 1.1,
      tolerancePct: 0.005,
      maxClosesAgainstLevel: 2,
      retestTimeoutCandles: 8,
      riskPct: 0.01,
      stopBufferPct: 0.002,
    },
    B: {
      volumeRatioMin: 1.2,
      atrRatioMin: 1.0,
      tolerancePct: 0.006,
      maxClosesAgainstLevel: 3,
      retestTimeoutCandles: 10,
      riskPct: 0.005,
      stopBufferPct: 0.003,
    },
    C: {
      volumeRatioMin: 1.0,
      atrRatioMin: 0.0,
      tolerancePct: 0.008,
      maxClosesAgainstLevel: 3,
      retestTimeoutCandles: 12,
      riskPct: 0.0025,
      stopBufferPct: 0.004,
    },
  },
  exits: {
    partialAtR: 1.0,
    partialPct: 50,
    finalTargetR: 2.0,
    moveStopToBE: true,
    useEMA9Trail: true,
    usePriorLowTrail: true,
    hardExitRedCandles: 2,
  },
  daily: {
    maxLosingTrades: 3,
    maxDailyLossR: -3.0,
  },
  risk: {
    maxPositionPct: 10,
    timeStopMinutes: 30,
    timeStopR: 0.5,
    cooldownMinutes: 15,
  },
};

/** @deprecated Use DEFAULT_TIERED_CONFIG instead. Kept for backward compatibility. */
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

/** @deprecated Use buildTieredConfigFromUser instead. */
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

export function buildTieredConfigFromUser(user: any): TieredStrategyConfig {
  const base = DEFAULT_TIERED_CONFIG;
  return {
    filters: {
      minPrice: user.minPrice ?? base.filters.minPrice,
      minDollarVolume: user.minDollarVolume ?? base.filters.minDollarVolume,
      maxSpreadPct: user.maxSpreadPct ?? base.filters.maxSpreadPct,
      blacklist: user.blacklist ?? base.filters.blacklist,
    },
    sessions: {
      open: user.sessionOpen ?? base.sessions.open,
      mid: user.sessionMid ?? base.sessions.mid,
      power: user.sessionPower ?? base.sessions.power,
    },
    marketFilter: {
      marketSymbol: user.marketSymbol ?? base.marketFilter.marketSymbol,
      tierABypass: user.tierABypass ?? base.marketFilter.tierABypass,
      requireAboveVWAPForLong: user.requireAboveVWAPForLong ?? base.marketFilter.requireAboveVWAPForLong,
      requireBelowVWAPForShort: user.requireBelowVWAPForShort ?? base.marketFilter.requireBelowVWAPForShort,
    },
    strategy: {
      timeframe: user.timeframe ?? base.strategy.timeframe,
      volumeLookback: user.volumeLookback ?? base.strategy.volumeLookback,
      atrLen: user.atrLen ?? base.strategy.atrLen,
      atrMaLen: user.atrMaLen ?? base.strategy.atrMaLen,
      minBreakoutClosePct: user.minBreakoutClosePct ?? base.strategy.minBreakoutClosePct,
      minBodyPct: user.minBodyPct ?? base.strategy.minBodyPct,
    },
    tiers: {
      A: {
        volumeRatioMin: user.tierA_volumeRatioMin ?? base.tiers.A.volumeRatioMin,
        atrRatioMin: user.tierA_atrRatioMin ?? base.tiers.A.atrRatioMin,
        tolerancePct: user.tierA_tolerancePct ?? base.tiers.A.tolerancePct,
        maxClosesAgainstLevel: user.tierA_maxClosesAgainstLevel ?? base.tiers.A.maxClosesAgainstLevel,
        retestTimeoutCandles: user.tierA_retestTimeoutCandles ?? base.tiers.A.retestTimeoutCandles,
        riskPct: user.tierA_riskPct ?? base.tiers.A.riskPct,
        stopBufferPct: user.tierA_stopBufferPct ?? base.tiers.A.stopBufferPct,
      },
      B: {
        volumeRatioMin: user.tierB_volumeRatioMin ?? base.tiers.B.volumeRatioMin,
        atrRatioMin: user.tierB_atrRatioMin ?? base.tiers.B.atrRatioMin,
        tolerancePct: user.tierB_tolerancePct ?? base.tiers.B.tolerancePct,
        maxClosesAgainstLevel: user.tierB_maxClosesAgainstLevel ?? base.tiers.B.maxClosesAgainstLevel,
        retestTimeoutCandles: user.tierB_retestTimeoutCandles ?? base.tiers.B.retestTimeoutCandles,
        riskPct: user.tierB_riskPct ?? base.tiers.B.riskPct,
        stopBufferPct: user.tierB_stopBufferPct ?? base.tiers.B.stopBufferPct,
      },
      C: {
        volumeRatioMin: user.tierC_volumeRatioMin ?? base.tiers.C.volumeRatioMin,
        atrRatioMin: user.tierC_atrRatioMin ?? base.tiers.C.atrRatioMin,
        tolerancePct: user.tierC_tolerancePct ?? base.tiers.C.tolerancePct,
        maxClosesAgainstLevel: user.tierC_maxClosesAgainstLevel ?? base.tiers.C.maxClosesAgainstLevel,
        retestTimeoutCandles: user.tierC_retestTimeoutCandles ?? base.tiers.C.retestTimeoutCandles,
        riskPct: user.tierC_riskPct ?? base.tiers.C.riskPct,
        stopBufferPct: user.tierC_stopBufferPct ?? base.tiers.C.stopBufferPct,
      },
    },
    exits: {
      partialAtR: user.partialAtR ?? base.exits.partialAtR,
      partialPct: user.partialPct ?? base.exits.partialPct,
      finalTargetR: user.finalTargetR ?? base.exits.finalTargetR,
      moveStopToBE: user.moveStopToBE ?? base.exits.moveStopToBE,
      useEMA9Trail: user.useEMA9Trail ?? base.exits.useEMA9Trail,
      usePriorLowTrail: user.usePriorLowTrail ?? base.exits.usePriorLowTrail,
      hardExitRedCandles: user.hardExitRedCandles ?? base.exits.hardExitRedCandles,
    },
    daily: {
      maxLosingTrades: user.maxLosingTrades ?? base.daily.maxLosingTrades,
      maxDailyLossR: user.maxDailyLossR ?? base.daily.maxDailyLossR,
    },
    risk: {
      maxPositionPct: user.maxPositionPct ?? base.risk.maxPositionPct,
      timeStopMinutes: user.timeStopMinutes ?? base.risk.timeStopMinutes,
      timeStopR: user.timeStopR ?? base.risk.timeStopR,
      cooldownMinutes: user.cooldownMinutes ?? base.risk.cooldownMinutes,
    },
  };
}

export function tieredToLegacy(config: TieredStrategyConfig, tier: TradeTier): StrategyConfig {
  const tierConfig = config.tiers[tier];
  return {
    universe: {
      minPrice: config.filters.minPrice,
      minAvgDollarVolume: config.filters.minDollarVolume,
      maxSpreadPct: config.filters.maxSpreadPct,
      minDailyATRpct: 1.2,
      minRVOL: tierConfig.volumeRatioMin,
      rvolCutoffMinutes: 15,
    },
    higherTimeframe: {
      requiredConfirmations: 2,
    },
    breakout: {
      minBodyPct: config.strategy.minBodyPct,
      minVolumeMultiplier: tierConfig.volumeRatioMin,
      minRangeMultiplier: tierConfig.atrRatioMin,
      bufferPct: tierConfig.stopBufferPct,
    },
    retest: {
      maxPullbackPct: 50,
      tolerancePct: tierConfig.tolerancePct,
      entryMode: "conservative",
    },
    marketRegime: {
      maxVwapCrosses: 3,
      vwapCrossWindowMinutes: 20,
      chopSizeReduction: 0.50,
    },
    volatilityGate: {
      firstRangeMinPct: 70,
      atrExpansionMultiplier: tierConfig.atrRatioMin || 1.0,
    },
    scoring: {
      rvolThreshold: 2.0,
      breakoutVolumeThreshold: 2.0,
      fullSizeMin: 80,
      halfSizeMin: 65,
    },
    exits: {
      partialAtR: config.exits.partialAtR,
      partialPct: config.exits.partialPct,
      useEMA9Trail: config.exits.useEMA9Trail,
      usePriorLowTrail: config.exits.usePriorLowTrail,
      hardExitRedCandles: config.exits.hardExitRedCandles,
    },
    risk: {
      perTradeRiskPct: tierConfig.riskPct * 100,
      maxPositionPct: config.risk.maxPositionPct,
      maxDailyLossPct: Math.abs(config.daily.maxDailyLossR),
      maxLosingTrades: config.daily.maxLosingTrades,
      cooldownMinutes: config.risk.cooldownMinutes,
      timeStopMinutes: config.risk.timeStopMinutes,
      timeStopR: config.risk.timeStopR,
    },
    riskMode: tier === "A" ? "aggressive" : tier === "B" ? "balanced" : "conservative",
    powerSetupEnabled: true,
  };
}

export function selectTier(volRatio: number, atrRatio: number, config: TieredStrategyConfig): TradeTier | null {
  const tiers: TradeTier[] = ["A", "B", "C"];
  for (const tier of tiers) {
    const tc = config.tiers[tier];
    if (volRatio >= tc.volumeRatioMin && atrRatio >= tc.atrRatioMin) {
      return tier;
    }
  }
  return null;
}
