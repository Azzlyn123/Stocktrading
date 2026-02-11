export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface StrategyConfig {
  universe: {
    minPrice: number;
    minAvgDollarVolume: number;
    maxSpreadPct: number;
    minDailyATRpct: number;
    minRVOL: number;
    rvolCutoffMinutes: number;
  };
  higherTimeframe: {
    requiredConfirmations: number;
  };
  breakout: {
    minBodyPct: number;
    minVolumeMultiplier: number;
    minRangeMultiplier: number;
    bufferPct: number;
  };
  retest: {
    maxPullbackPct: number;
    tolerancePct: number;
    entryMode: "conservative" | "aggressive";
  };
  marketRegime: {
    maxVwapCrosses: number;
    vwapCrossWindowMinutes: number;
    chopSizeReduction: number;
  };
  volatilityGate: {
    firstRangeMinPct: number;
    atrExpansionMultiplier: number;
  };
  scoring: {
    rvolThreshold: number;
    breakoutVolumeThreshold: number;
    fullSizeMin: number;
    halfSizeMin: number;
  };
  exits: {
    partialAtR: number;
    partialPct: number;
    useEMA9Trail: boolean;
    usePriorLowTrail: boolean;
    hardExitRedCandles: number;
  };
  risk: {
    perTradeRiskPct: number;
    maxPositionPct: number;
    maxDailyLossPct: number;
    maxLosingTrades: number;
    cooldownMinutes: number;
    timeStopMinutes: number;
    timeStopR: number;
  };
  riskMode: "conservative" | "balanced" | "aggressive";
  powerSetupEnabled: boolean;
}

export interface UniverseFilterResult {
  passes: boolean;
  reasons: string[];
  metrics: {
    price: number;
    avgDollarVolume: number;
    spreadPct: number;
    dailyATRpct: number;
    rvol: number;
  };
}

export interface HigherTimeframeBiasResult {
  aligned: boolean;
  confirmations: number;
  details: {
    aboveVWAP: boolean;
    ema9AboveEma20: boolean;
    breakingDayHigh: boolean;
  };
}

export interface BreakoutQualification {
  qualified: boolean;
  reasons: string[];
  metrics: {
    bodyPct: number;
    volumeMultiplier: number;
    rangeMultiplier: number;
    closedAboveResistance: boolean;
  };
}

export interface RetestResult {
  valid: boolean;
  entryPrice: number | null;
  stopPrice: number | null;
  reasons: string[];
  metrics: {
    pullbackPct: number;
    holdsLevel: boolean;
    volumeContracting: boolean;
    expandingBelowLevel: boolean;
  };
}

export interface MarketRegimeResult {
  aligned: boolean;
  chopping: boolean;
  sizeMultiplier: number;
  reasons: string[];
  metrics: {
    spyAboveVwap: boolean;
    spyTrendAligned: boolean;
    vwapCrossCount: number;
  };
}

export interface VolatilityGateResult {
  passes: boolean;
  reasons: string[];
  metrics: {
    firstRangePctOfYesterday: number;
    intradayATRvsBaseline: number;
  };
}

export interface ScoreResult {
  score: number;
  tier: "full" | "half" | "pass";
  sizeMultiplier: number;
  breakdown: {
    rvol: number;
    trend: number;
    breakoutVolume: number;
    retestVolume: number;
    spyAlignment: number;
    atrExpansion: number;
    catalyst: number;
  };
}

export interface ExitDecision {
  shouldExit: boolean;
  exitType: "partial" | "trailing_stop" | "hard_exit" | "time_stop" | "target" | null;
  exitPrice: number | null;
  reason: string;
  partialShares: number | null;
  newStopPrice: number | null;
}

export interface SignalDecision {
  action: "none" | "setup" | "trigger" | "manage" | "exit";
  ticker: string;
  score: ScoreResult | null;
  universe: UniverseFilterResult | null;
  bias: HigherTimeframeBiasResult | null;
  breakout: BreakoutQualification | null;
  retest: RetestResult | null;
  regime: MarketRegimeResult | null;
  volatility: VolatilityGateResult | null;
  exit: ExitDecision | null;
  entryPrice: number | null;
  stopPrice: number | null;
  target1: number | null;
  target2: number | null;
  shares: number | null;
  notes: string;
  isPowerSetup: boolean;
  relStrengthVsSpy: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  closedAt: Date | null;
}
