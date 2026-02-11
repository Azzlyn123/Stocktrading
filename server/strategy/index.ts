export { DEFAULT_STRATEGY_CONFIG, DEFAULT_TIERED_CONFIG, buildConfigFromUser, buildTieredConfigFromUser, tieredToLegacy, selectTier } from "./config";
export type { StrategyConfig, TieredStrategyConfig, TierConfig, TradeTier, TradeDirection, SignalState } from "./types";
export type {
  Candle,
  UniverseFilterResult,
  HigherTimeframeBiasResult,
  BreakoutQualification,
  RetestResult,
  MarketRegimeResult,
  VolatilityGateResult,
  ScoreResult,
  ExitDecision,
  SignalDecision,
} from "./types";
export {
  calculateEMA,
  lastEMA,
  calculateATR,
  calculateVWAP,
  bodyPct,
  candleRange,
  avgVolume,
  avgRange,
  isGreenCandle,
  isRedCandle,
  findResistance,
  countVWAPCrosses,
  dailyATRpct,
  firstNMinutesRange,
  yesterdayRange,
  detectCandlePattern,
} from "./indicators";
export { checkUniverseFilter } from "./universeFilter";
export { checkHigherTimeframeBias } from "./higherTimeframeBias";
export { checkBreakoutQualification, checkTieredBreakout } from "./breakoutQualification";
export { checkRetestRules, checkTieredRetest } from "./retestRules";
export { checkMarketRegime } from "./marketRegime";
export { checkVolatilityGate } from "./volatilityGate";
export { computeScore } from "./scoring";
export { checkExitRules, checkTieredExitRules } from "./exits";
