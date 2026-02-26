# BreakoutIQ - Intraday Trading Alert Platform

## Overview
BreakoutIQ is a full-stack trading alert application for US equities and ETFs, focused on an intraday momentum breakout and retest strategy. It integrates multi-timeframe analysis, advanced universe filters, market regime detection, volatility gates, and a 0-100 scoring system for tiered position sizing. The platform supports diverse exit strategies, paper trading with real-time data, and a learning system for post-trade analysis. Its primary goal is to provide an analytical tool for identifying and capitalizing on short-term market movements while effectively managing risk, with ambitions to expand into various market opportunities.

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace

## System Architecture
BreakoutIQ is built with a React 18 frontend (TypeScript, Vite, TailwindCSS, Shadcn UI), an Express.js (Node.js) backend, and a PostgreSQL database with Drizzle ORM. Authentication uses Passport-local with session-based methods, and real-time data/notifications are handled via WebSockets. The frontend employs Wouter for routing, TanStack React Query for state management, and Recharts for charting.

The backend features a modular strategy engine with pure TypeScript modules. A state machine manages trading signal lifecycles (IDLE -> BREAKOUT -> RETEST -> TRIGGERED -> MANAGED -> CLOSED). Key architectural components and features include:
-   **Enhanced Universe Filters**: Criteria for price, volume, spread, ATR, and RVOL.
-   **Multi-timeframe Analysis**: 15m higher timeframe bias (VWAP, EMA slopes) and 5m entry analysis.
-   **Breakout & Retest Qualification**: Specific rules for candle body, range, volume, resistance interaction, and pullback/volume contraction for entry.
-   **Market Regime Detection**: SPY trend, VWAP position, and chop detection.
-   **Volatility Gate**: Ensures sufficient market volatility.
-   **Scoring System**: A composite 0-100 score for various factors.
-   **Tiered Sizing**: Position sizing based on signal score and market conditions.
-   **Exit Management**: Partial exits, trailing stops, hard exits, and time stops.
-   **Risk Management**: Daily max loss, trade limits, and cooldown periods.
-   **Learning System**: Post-trade analysis, pattern classification, adaptive score penalties, and actionable insights.
-   **Historical Simulation Engine**: Replays past trading days for backtesting.
-   **Strategy Modules**: Includes a VWAP Reversion Strategy Module and infrastructure for developing additional strategies.
-   **Dynamic Market Scanning Infrastructure**: Efficiently scans entire equity markets (e.g., 11,210 symbols) using batch API calls and local gap computation for full-market backtesting.
-   **Trade Logging System**: Comprehensive per-trade audit trail capturing entry/exit timestamps, prices, stop-loss, targets, sizing, R-multiples, PnL, MFE/MAE, exit reasons, and strategy context. Integrated into breakout/retest and small-cap simulators.
-   **Strategy Versioning & Archive System**: Each simulation run is tagged with a `strategyVersion` (stored in `simulation_runs.strategy_version`). Users set their active version via `users.current_strategy_version` (default "v1"). Before resetting data, the Archive & Reset flow exports all runs/trades/lessons/summaries as a downloadable JSON bundle with a version label. The Core 6 Metrics Scorecard (`CoreMetricsPanel`) aggregates win rate, avg win R, avg loss R, expectancy R/trade, max drawdown R, and trades/day from DB trades filtered by version.
-   **Rules-Freeze Guardrail**: Once a strategy version has recorded trades, the `PATCH /api/settings` endpoint blocks changes to strategy-parameter fields (returns 409 with `RULES_FROZEN` code). Users must Archive & Reset to a new version before modifying rules. The Settings page shows a frozen indicator banner and badge when active. Only `currentStrategyVersion` changes pass through without the freeze check.
-   **Sample-Size Confidence Badge**: A 4-tier visual badge on the CoreMetricsPanel: Low (<20 trades, red), Building (20-49, amber), Minimum (50-99, green), Full (100+, bold green). Progress bar and tier markers show advancement toward statistical reliability.
-   **Key endpoints**: `POST /api/simulations/archive` (export data with label), `GET /api/simulations/core-metrics?version=v2` (compute 6 metrics), `GET /api/internal/trade-log` and `/trade-log/csv` (in-memory session trade log).
-   **UI/UX**: Dashboard, scanner, watchlist, signals feed, trades log, and settings with a default dark theme.

## Strategy Validation Results

### v1 Strategy Performance (Baseline)
- **Total Trades**: 381 (Full Tier)
- **Win Rate**: 12.3%
- **Expectancy**: -0.34R
- **Avg Winner**: +0.436R / **Avg Loser**: -0.453R
- **Core Issues**: Negative edge (avg winner < avg loser), heavy bleed from premature 15m "stall" exits, high EOD decay on non-expansion days.

### v2 Strategy Configuration (Tightened Confirmation)
- **Version Label**: `v2`
- **Volume Contraction**: Tightened from 0.8x to 0.5x of breakout volume.
- **Momentum Stall**: Extended from 15m to 45m to allow trades room to breathe.
- **Default Time Stop**: Extended to 45m.
- **Status**: 100-day auto-run triggered for user `Hbg`.

### Small-Cap Momentum: First Pullback After HOD Break — EXTENDED OOS COMPLETE
- **Frozen Config**: gap ≥ 6%, premarket vol ≥ 1M, trail at 0.75R, activation at 1.25R, spread ≤ 1.5%, min dollar vol $2M
- **Phase B Walk-Forward**: PASSED (Feb 3-14: 13 trades, +0.553R, 69.2% WR, PF 2.53) — uses walk-forward sweep with combo-specific universe
- **Extended OOS Endpoint**: `/api/internal/smallcap-extended-oos` with enhanced diagnostics — uses dynamic gap scanner (full-market scan, different candidate pool yields different trade counts)
- **Extended OOS Results (all non-dev windows combined)**:
  - Jun-Jul 2025: 44 days, 8 trades, 25% WR, -0.619R avgR, PF 0.20
  - Aug-Oct 2025: 66 days, 21 trades, 38.1% WR, -0.333R avgR, PF 0.52
  - Feb 3-14 2026: 9 days, 23 trades, 65.2% WR, +0.445R avgR, PF 2.21
  - **Combined: 119 days, 52 trades, -0.033R avgR, -1.7R totalR**
- **Critical Diagnostics**:
  - **Trade frequency extremely regime-dependent**: 0.26/day pre-dev vs 2.6/day Feb (crypto/momentum surge)
  - **Daily clustering**: 168.8% of Feb PnL from top 3 days; Feb 6 alone = +16R
  - **R Distribution (Feb)**: 7 trades in -1.5R to -1R bucket, 4 in 1.5R-2R, binary outcome pattern
  - **Gap size analysis**: 6-8% gaps positive (0.37R avg), 10%+ gaps negative (-0.65R avg)
  - **Pre-dev OOS negative**: Jun-Oct combined -12R across 29 trades
- **Paper Trading Criteria** (avgR ≥ 0.15, PF ≥ 1.3, ≥20% 2R MFE, no regime collapse):
  - **NOT MET**: Combined avgR -0.033 fails threshold; edge concentrated in Feb regime only
  - **Verdict: NOT_READY for paper trading**
- **Key files**: `server/strategy/batchGapScanner.ts`, `server/strategy/dynamicGapScanner.ts`, `server/strategy/smallCapScanner.ts`, `server/strategy/pullbackDetector.ts`, `server/historicalSimulator.ts`

### Volatility Cluster Score (VCS) System — IN PROGRESS
- **Module**: `server/strategy/volatilityClusterFilter.ts`
- **Endpoint**: `/api/internal/volatility-cluster-test`
- **VCS Formula**: Composite 0-1 score = GapDensity(25%) + Breadth/VWAP%(35%) + Expansion(25%) + SPY_Range(15%)
  - Gap Density: min(gapCount/30, 1.0) — stocks with gap ≥4%, RVOL ≥1.5, open > prior high
  - Breadth: % of universe above VWAP in first hour (scaled 0-1)
  - Expansion: % of universe with first-hour range > 0.75 * ATR (scaled 0-1)
  - SPY Range: min(SPY daily range / 20-day ATR / 2.0, 1.0)
- **Default Config**: gapCountThreshold=6, minPrice=$10, minAvgDollarVol=$50M, vcsThreshold=0.35
- **Bug Fixes Applied**:
  - Expansion: Changed from upside-only (>1.5*ATR, broken) to first-hour range (>0.75*ATR, realistic 19-59% range)
  - SPY: Moved calculation outside gapCount threshold block; forced SPY into universe (ETF not in equity list)
  - Chunk size: Dynamic sizing `floor(9500/daySpan)` to prevent Alpaca API 10k bar limit truncation on long date ranges
- **Results with VCS 0.35 threshold (all components working)**:
  - Feb 3-14 2026: 9 days, 7 ON/2 OFF (78% activation) — ON: 21T, 67% WR, +0.524 avgR, +11.0R, 2.53 PF; OFF: 0T
  - Jun-Jul 2025: 44 days, 5 ON/39 OFF (11% activation) — 0T both groups (pipeline mismatch with extended OOS)
  - Aug-Oct 2025: 66 days, ~3-22 ON (varies with universe cache) — 0T both groups (pipeline mismatch)
- **Known Issue**: Cluster test endpoint's batchGapScanner finds different candidates than dynamicGapScanner used in extended OOS, resulting in 0 trades for Jun-Oct. This is a pipeline alignment issue, not a VCS issue.
- **VCS Component Distributions**:
  - Feb: VCS 0.32-0.54, SPY range 0.13-0.40, expansion 0.20-0.56 (hot regime, low SPY vol)
  - Aug-Oct: VCS 0.00-0.51, SPY range 0.00-4.48, expansion 0.01-0.65 (variable, SPY more volatile)
  - Jun-Jul: VCS 0.03-0.47, SPY range 0.18-2.12 (moderate)
- **Next Steps**: Align cluster test pipeline with extended OOS scanner to validate VCS filtering on actual trade data

## External Dependencies
-   **Alpaca API**: Live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
-   **PostgreSQL**: Relational database.
-   **WebSocket**: Real-time price updates and market status notifications.
-   **Passport-local**: User authentication.
-   **Wouter**: Frontend routing.
-   **TanStack React Query**: Frontend asynchronous state management.
-   **Recharts**: Frontend data visualization and charting.
