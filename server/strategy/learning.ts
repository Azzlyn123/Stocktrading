import type { PaperTrade, Signal, InsertTradeLesson } from "@shared/schema";
import * as crypto from "crypto";

export type LessonTag =
  | "weak_volume_breakout"
  | "against_spy_trend"
  | "lunch_chop_entry"
  | "resistance_too_close"
  | "atr_contraction"
  | "failed_retest"
  | "low_score_entry"
  | "no_trend_confirmation"
  | "stop_too_tight"
  | "time_stop_no_momentum"
  | "structure_break"
  | "strong_volume_breakout"
  | "trend_aligned_entry"
  | "clean_retest"
  | "high_score_setup"
  | "tier_a_winner"
  | "quick_target_hit"
  | "oversized_for_tier";

interface TradeContext {
  trade: PaperTrade;
  signal: Signal | null;
  spyAligned: boolean;
  isLunchChop: boolean;
  session: string;
}

export function analyzeClosedTrade(ctx: TradeContext): InsertTradeLesson {
  const { trade, signal } = ctx;
  const tags: LessonTag[] = [];
  const details: string[] = [];

  const pnl = trade.pnl ?? 0;
  const rMult = trade.realizedR ?? 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const isBE = Math.abs(pnl) < 1;

  let outcomeCategory: string;
  if (trade.exitReason === "sanity_check") {
    outcomeCategory = "sanity_fail";
  } else if (isBE) {
    outcomeCategory = "breakeven";
  } else if (isWin) {
    outcomeCategory = "win";
  } else {
    outcomeCategory = "loss";
  }

  if (isLoss || outcomeCategory === "sanity_fail") {
    const scoreBreakdown = signal?.scoreBreakdown as any;
    if (scoreBreakdown) {
      if ((scoreBreakdown.breakoutVolume ?? 0) < 10) {
        tags.push("weak_volume_breakout");
        details.push("Breakout volume score was low - weak conviction on the breakout candle.");
      }
    }

    if (!ctx.spyAligned) {
      tags.push("against_spy_trend");
      details.push("Entered against the prevailing SPY trend - market headwind contributed to failure.");
    }

    if (ctx.isLunchChop) {
      tags.push("lunch_chop_entry");
      details.push("Entered during lunch chop (11:30-13:30 ET) - low volume period prone to false breakouts.");
    }

    const score = trade.score ?? signal?.score ?? 0;
    if (score < 50) {
      tags.push("low_score_entry");
      details.push(`Entry score was only ${score}/100 - below quality threshold for reliable setups.`);
    }

    if (signal && !signal.trendConfirmed) {
      tags.push("no_trend_confirmation");
      details.push("Higher timeframe trend was not confirmed at entry - swimming against the current.");
    }

    if (trade.exitReason === "time_stop") {
      tags.push("time_stop_no_momentum");
      details.push("Hit time stop without reaching +0.5R - no follow-through momentum after breakout.");
    }

    if (trade.exitReason === "hard_exit") {
      tags.push("structure_break");
      details.push("Exited on structure break (red candles with volume or swing low break) - sellers took control.");
    }

    if (trade.exitReason === "stop_loss" || trade.exitReason === "trailing_stop") {
      const riskPerShare = Math.abs(trade.entryPrice - (trade.originalStopPrice ?? trade.stopPrice));
      const entryToResistance = signal?.resistanceLevel ? Math.abs(signal.resistanceLevel - trade.entryPrice) : null;
      if (entryToResistance !== null && riskPerShare > 0) {
        const roomToResistanceR = entryToResistance / riskPerShare;
        if (roomToResistanceR < 1.5) {
          tags.push("resistance_too_close");
          details.push(`Only ${roomToResistanceR.toFixed(1)}R room to resistance - not enough upside potential.`);
        }
      }

      if (riskPerShare > 0 && trade.entryPrice > 0) {
        const stopPct = (riskPerShare / trade.entryPrice) * 100;
        if (stopPct < 0.05) {
          tags.push("stop_too_tight");
          details.push(`Stop was only ${stopPct.toFixed(3)}% from entry - normal noise triggered the stop.`);
        }
      }
    }

    if (trade.exitReason === "sanity_check") {
      details.push("Price data anomaly detected - trade closed at breakeven due to unreliable pricing.");
    }

    if ((trade.tier === "C" || trade.scoreTier === "C") && isLoss) {
      tags.push("oversized_for_tier");
      details.push("Tier C trade lost - lower quality setups have inherently higher failure rates.");
    }
  }

  if (isWin) {
    const scoreBreakdown = signal?.scoreBreakdown as any;
    if (scoreBreakdown && (scoreBreakdown.breakoutVolume ?? 0) >= 15) {
      tags.push("strong_volume_breakout");
      details.push("Strong breakout volume confirmed buyer conviction.");
    }

    if (ctx.spyAligned) {
      tags.push("trend_aligned_entry");
      details.push("Entry was aligned with SPY trend - market tailwind supported the move.");
    }

    if (signal && signal.trendConfirmed) {
      details.push("Higher timeframe trend confirmed - aligns with broader market direction.");
    }

    const score = trade.score ?? signal?.score ?? 0;
    if (score >= 70) {
      tags.push("high_score_setup");
      details.push(`High quality setup with score ${score}/100.`);
    }

    if (trade.tier === "A" || trade.scoreTier === "A") {
      tags.push("tier_a_winner");
      details.push("Tier A setup delivered as expected - highest conviction setups have best win rates.");
    }

    if (trade.exitReason === "target") {
      tags.push("quick_target_hit");
      details.push("Reached full target - strong momentum carried through.");
    }
  }

  if (tags.length === 0) {
    if (isLoss) {
      tags.push("failed_retest");
      details.push("Retest setup failed without a clear single cause - review price action at entry.");
    } else {
      tags.push("clean_retest");
      details.push("Clean retest setup that worked as intended.");
    }
  }

  const entryConditions: Record<string, any> = {
    score: trade.score ?? signal?.score,
    tier: trade.tier ?? signal?.tier,
    scoreTier: trade.scoreTier ?? signal?.scoreTier,
    entryMode: trade.entryMode ?? signal?.entryMode,
    trendConfirmed: signal?.trendConfirmed ?? false,
    volumeConfirmed: signal?.volumeConfirmed ?? false,
    rvol: signal?.rvol,
    atrValue: signal?.atrValue,
    isPowerSetup: trade.isPowerSetup ?? signal?.isPowerSetup ?? false,
    relStrengthVsSpy: signal?.relStrengthVsSpy,
    resistanceLevel: signal?.resistanceLevel,
    breakoutPrice: signal?.breakoutPrice,
    breakoutVolume: signal?.breakoutVolume,
  };

  const marketContext: Record<string, any> = {
    spyAligned: ctx.spyAligned,
    isLunchChop: ctx.isLunchChop,
    session: ctx.session,
    marketRegime: signal?.marketRegime,
  };

  const hashInput = [
    trade.ticker,
    trade.tier ?? signal?.tier ?? "unknown",
    outcomeCategory,
    ctx.spyAligned ? "spy_yes" : "spy_no",
    ctx.session,
    trade.exitReason ?? "unknown",
    ...tags.sort(),
  ].join("|");
  const patternHash = crypto.createHash("md5").update(hashInput).digest("hex").slice(0, 12);

  let durationMinutes: number | null = null;
  if (trade.enteredAt && trade.exitedAt) {
    durationMinutes = Math.floor(
      (new Date(trade.exitedAt).getTime() - new Date(trade.enteredAt).getTime()) / 60000
    );
  }

  return {
    tradeId: trade.id,
    signalId: trade.signalId ?? signal?.id ?? null,
    ticker: trade.ticker,
    tier: trade.tier ?? signal?.tier ?? null,
    direction: trade.direction ?? "LONG",
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice ?? null,
    pnl: trade.pnl ?? 0,
    rMultiple: trade.realizedR ?? 0,
    outcomeCategory,
    exitReason: trade.exitReason ?? null,
    lessonTags: tags as string[],
    lessonDetail: details.join(" | "),
    entryConditions,
    marketContext,
    scoreAtEntry: trade.score ?? signal?.score ?? null,
    scoreBreakdown: signal?.scoreBreakdown ?? null,
    durationMinutes,
    patternHash,
  };
}

export function computeLearningPenalty(
  lessons: Array<{
    ticker: string;
    tier: string | null;
    outcomeCategory: string;
    lessonTags: string[] | null;
    marketContext: any;
    pnl: number | null;
    scoreAtEntry: number | null;
  }>,
  ticker: string,
  tier: string,
  spyAligned: boolean,
  session: string
): { penalty: number; reasons: string[] } {
  if (lessons.length === 0) return { penalty: 0, reasons: [] };

  let penalty = 0;
  const reasons: string[] = [];

  const tickerLessons = lessons.filter(l => l.ticker === ticker);
  if (tickerLessons.length >= 3) {
    const tickerLosses = tickerLessons.filter(l => l.outcomeCategory === "loss" || l.outcomeCategory === "sanity_fail");
    const tickerLossRate = tickerLosses.length / tickerLessons.length;
    if (tickerLossRate >= 0.7) {
      penalty += 15;
      reasons.push(`${ticker} has ${Math.round(tickerLossRate * 100)}% loss rate (${tickerLosses.length}/${tickerLessons.length} trades)`);
    } else if (tickerLossRate >= 0.5) {
      penalty += 8;
      reasons.push(`${ticker} has ${Math.round(tickerLossRate * 100)}% loss rate`);
    }
  }

  const tierLessons = lessons.filter(l => l.tier === tier);
  if (tierLessons.length >= 5) {
    const tierLosses = tierLessons.filter(l => l.outcomeCategory === "loss");
    const tierLossRate = tierLosses.length / tierLessons.length;
    if (tierLossRate >= 0.65) {
      penalty += 10;
      reasons.push(`Tier ${tier} has ${Math.round(tierLossRate * 100)}% loss rate across ${tierLessons.length} trades`);
    }
  }

  const recentLosses = lessons
    .filter(l => l.outcomeCategory === "loss" || l.outcomeCategory === "sanity_fail")
    .slice(0, 20);

  const tagCounts: Record<string, number> = {};
  for (const loss of recentLosses) {
    for (const tag of (loss.lessonTags ?? [])) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  if ((tagCounts["against_spy_trend"] ?? 0) >= 3 && !spyAligned) {
    penalty += 12;
    reasons.push(`${tagCounts["against_spy_trend"]} recent losses from trading against SPY trend`);
  }

  if ((tagCounts["lunch_chop_entry"] ?? 0) >= 2 && session === "mid") {
    penalty += 10;
    reasons.push(`${tagCounts["lunch_chop_entry"]} recent losses during lunch chop`);
  }

  if ((tagCounts["weak_volume_breakout"] ?? 0) >= 3) {
    penalty += 8;
    reasons.push(`${tagCounts["weak_volume_breakout"]} recent losses from weak volume breakouts`);
  }

  if ((tagCounts["time_stop_no_momentum"] ?? 0) >= 3) {
    penalty += 6;
    reasons.push(`${tagCounts["time_stop_no_momentum"]} recent trades hit time stop - momentum issue`);
  }

  if ((tagCounts["low_score_entry"] ?? 0) >= 3) {
    penalty += 8;
    reasons.push(`${tagCounts["low_score_entry"]} recent losses from low-score entries`);
  }

  const recentOutcomes = lessons.slice(0, 10).map(l => l.outcomeCategory);
  let streak = 0;
  for (const oc of recentOutcomes) {
    if (oc === "loss" || oc === "sanity_fail") streak++;
    else break;
  }
  if (streak >= 5) {
    penalty += 15;
    reasons.push(`${streak} consecutive losses - system is in a losing streak`);
  } else if (streak >= 3) {
    penalty += 8;
    reasons.push(`${streak} consecutive losses`);
  }

  return { penalty: Math.min(penalty, 40), reasons };
}

export function generateAdaptiveInsights(
  lessons: Array<{
    ticker: string;
    tier: string | null;
    outcomeCategory: string;
    lessonTags: string[] | null;
    marketContext: any;
    pnl: number | null;
    scoreAtEntry: number | null;
    exitReason: string | null;
    durationMinutes: number | null;
    rMultiple: number | null;
  }>
): {
  topLossPatterns: Array<{ tag: string; count: number; avgLoss: number; suggestion: string }>;
  topWinPatterns: Array<{ tag: string; count: number; avgWin: number }>;
  tierStats: Record<string, { wins: number; losses: number; winRate: number; avgR: number }>;
  sessionStats: Record<string, { wins: number; losses: number; winRate: number }>;
  recommendations: string[];
} {
  const losses = lessons.filter(l => l.outcomeCategory === "loss" || l.outcomeCategory === "sanity_fail");
  const wins = lessons.filter(l => l.outcomeCategory === "win");

  const lossTagMap: Record<string, { count: number; totalPnl: number }> = {};
  for (const loss of losses) {
    for (const tag of (loss.lessonTags ?? [])) {
      if (!lossTagMap[tag]) lossTagMap[tag] = { count: 0, totalPnl: 0 };
      lossTagMap[tag].count++;
      lossTagMap[tag].totalPnl += loss.pnl ?? 0;
    }
  }

  const tagSuggestions: Record<string, string> = {
    weak_volume_breakout: "Consider raising minimum volume multiplier for breakout qualification.",
    against_spy_trend: "Avoid entries when SPY is misaligned, or reduce position size significantly.",
    lunch_chop_entry: "Enable/tighten lunch chop filter to avoid entries between 11:30-13:30.",
    resistance_too_close: "Require at least 2R room to next resistance before entering.",
    low_score_entry: "Consider raising minimum score threshold for entries.",
    no_trend_confirmation: "Require higher timeframe trend confirmation before entering.",
    time_stop_no_momentum: "Review time stop settings or require stronger momentum at entry.",
    stop_too_tight: "Widen stops slightly to avoid being shaken out by normal price noise.",
    structure_break: "Consider tighter trailing stops or faster partial exits to lock in gains.",
    failed_retest: "Review retest tolerance and pullback requirements.",
    oversized_for_tier: "Reduce position size for Tier C setups or skip them entirely.",
  };

  const topLossPatterns = Object.entries(lossTagMap)
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      avgLoss: data.count > 0 ? data.totalPnl / data.count : 0,
      suggestion: tagSuggestions[tag] ?? "Review these setups for common failure patterns.",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const winTagMap: Record<string, { count: number; totalPnl: number }> = {};
  for (const win of wins) {
    for (const tag of (win.lessonTags ?? [])) {
      if (!winTagMap[tag]) winTagMap[tag] = { count: 0, totalPnl: 0 };
      winTagMap[tag].count++;
      winTagMap[tag].totalPnl += win.pnl ?? 0;
    }
  }
  const topWinPatterns = Object.entries(winTagMap)
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      avgWin: data.count > 0 ? data.totalPnl / data.count : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const tierStats: Record<string, { wins: number; losses: number; winRate: number; avgR: number }> = {};
  for (const tier of ["A", "B", "C"]) {
    const tierLessons = lessons.filter(l => l.tier === tier);
    const tw = tierLessons.filter(l => l.outcomeCategory === "win").length;
    const tl = tierLessons.filter(l => l.outcomeCategory === "loss").length;
    const total = tw + tl;
    const avgR = tierLessons.length > 0
      ? tierLessons.reduce((sum, l) => sum + (l.rMultiple ?? 0), 0) / tierLessons.length
      : 0;
    tierStats[tier] = {
      wins: tw,
      losses: tl,
      winRate: total > 0 ? (tw / total) * 100 : 0,
      avgR: Number(avgR.toFixed(2)),
    };
  }

  const sessionStats: Record<string, { wins: number; losses: number; winRate: number }> = {};
  for (const sess of ["open", "mid", "power"]) {
    const sessLessons = lessons.filter(l => (l.marketContext as any)?.session === sess);
    const sw = sessLessons.filter(l => l.outcomeCategory === "win").length;
    const sl = sessLessons.filter(l => l.outcomeCategory === "loss").length;
    const total = sw + sl;
    sessionStats[sess] = {
      wins: sw,
      losses: sl,
      winRate: total > 0 ? (sw / total) * 100 : 0,
    };
  }

  const recommendations: string[] = [];
  if (topLossPatterns.length > 0 && topLossPatterns[0].count >= 3) {
    recommendations.push(topLossPatterns[0].suggestion);
  }

  const overallWinRate = lessons.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0;
  if (overallWinRate < 40 && lessons.length >= 10) {
    recommendations.push("Overall win rate is below 40%. Consider being more selective - only take Tier A and B setups.");
  }

  for (const [tier, stats] of Object.entries(tierStats)) {
    if (stats.wins + stats.losses >= 5 && stats.winRate < 30) {
      recommendations.push(`Tier ${tier} win rate is only ${stats.winRate.toFixed(0)}%. Consider skipping Tier ${tier} setups.`);
    }
  }

  for (const [sess, stats] of Object.entries(sessionStats)) {
    if (stats.wins + stats.losses >= 5 && stats.winRate < 30) {
      recommendations.push(`${sess.charAt(0).toUpperCase() + sess.slice(1)} session win rate is ${stats.winRate.toFixed(0)}%. Reduce trading in this window.`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("Not enough data yet to generate specific recommendations. Keep collecting trades.");
  }

  return { topLossPatterns, topWinPatterns, tierStats, sessionStats, recommendations };
}
