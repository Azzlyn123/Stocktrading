import type { StrategyConfig, ScoreResult, HigherTimeframeBiasResult, MarketRegimeResult, BreakoutQualification } from "./types";

export function computeScore(
  rvol: number,
  bias: HigherTimeframeBiasResult,
  breakoutVolMult: number,
  retestVolumeContracting: boolean,
  regime: MarketRegimeResult,
  atrExpanding: boolean,
  hasCatalyst: boolean,
  config: StrategyConfig["scoring"],
  isPowerSetup: boolean = false
): ScoreResult {
  let rvolPoints = 0;
  if (rvol >= config.rvolThreshold) rvolPoints = 20;
  else if (rvol >= 1.5) rvolPoints = 10;

  const trendPoints = bias.aligned ? 15 : 0;

  let breakoutVolumePoints = 0;
  if (breakoutVolMult >= config.breakoutVolumeThreshold) breakoutVolumePoints = 20;
  else if (breakoutVolMult >= 1.5) breakoutVolumePoints = 10;

  const retestVolumePoints = retestVolumeContracting ? 15 : 0;

  const spyPoints = regime.aligned ? 15 : 0;

  const atrPoints = atrExpanding ? 10 : 0;

  const catalystPoints = hasCatalyst ? 5 : 0;

  let score =
    rvolPoints +
    trendPoints +
    breakoutVolumePoints +
    retestVolumePoints +
    spyPoints +
    atrPoints +
    catalystPoints;

  if (isPowerSetup) score = Math.min(100, score + 10);

  let tier: "full" | "half" | "pass";
  let sizeMultiplier: number;
  if (score >= config.fullSizeMin) {
    tier = "full";
    sizeMultiplier = isPowerSetup ? 1.25 : 1.0;
  } else if (score >= config.halfSizeMin) {
    tier = "half";
    sizeMultiplier = 0.5;
  } else {
    tier = "pass";
    sizeMultiplier = 0;
  }

  return {
    score,
    tier,
    sizeMultiplier,
    breakdown: {
      rvol: rvolPoints,
      trend: trendPoints,
      breakoutVolume: breakoutVolumePoints,
      retestVolume: retestVolumePoints,
      spyAlignment: spyPoints,
      atrExpansion: atrPoints,
      catalyst: catalystPoints,
    },
  };
}
