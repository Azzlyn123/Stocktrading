export { DEFAULT_STRATEGY_CONFIG, buildConfigFromUser } from "./config";
export type { StrategyConfig } from "./types";
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
export { checkBreakoutQualification } from "./breakoutQualification";
export { checkRetestRules } from "./retestRules";
export { checkMarketRegime } from "./marketRegime";
export { checkVolatilityGate } from "./volatilityGate";
export { computeScore } from "./scoring";
export { checkExitRules } from "./exits";
