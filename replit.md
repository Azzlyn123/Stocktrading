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
-   **UI/UX**: Dashboard, scanner, watchlist, signals feed, trades log, and settings with a default dark theme.

## Strategy Validation Results

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

## External Dependencies
-   **Alpaca API**: Live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
-   **PostgreSQL**: Relational database.
-   **WebSocket**: Real-time price updates and market status notifications.
-   **Passport-local**: User authentication.
-   **Wouter**: Frontend routing.
-   **TanStack React Query**: Frontend asynchronous state management.
-   **Recharts**: Frontend data visualization and charting.