# BreakoutIQ - Intraday Trading Alert Platform

## Overview
BreakoutIQ is a full-stack trading alert application for US equities and ETFs, designed to identify and capitalize on intraday momentum breakout and retest strategies. It integrates multi-timeframe analysis, advanced universe filtering, market regime detection, and a sophisticated scoring system for risk-managed position sizing. The platform aims to provide comprehensive tools for trade management, post-trade analysis, and strategy learning, with ambitions to expand into diverse market opportunities.

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace

## Current Strategy Version
**v7.2** (active — new baseline) — Tier A only + 15-min stop-tighten:
- Entry: Tier A only (volRatio ≥1.8, atrRatio ≥1.2), all sessions allowed
- Exit: T1 at +0.4R/70% sell, stop tightens to entry-0.05R at 15min if MFE < 0.10R (no market exit); time_stop otherwise
- **FROZEN. Do not modify rules.**
- n=54 results: +0.164R expectancy, 38.9% WR, avg loss -0.201R, avg win +0.736R, runners 46% at 0.863R avg MFE
- Time-stop rate collapsed v7.0→v7.2: 56% → 18.5%; avg time-stop R flipped -0.137R → +0.085R
- Checkpoints: 75 trades → 100 trades → 150 trades

**v7.1** (ready, not yet active) — Tier A + Power Session only (NO stop-tighten):
- Entry: Tier A only AND minutesSinceOpen > 240 (power session gate)
- Activate by DB update: `current_strategy_version = 'v7.1'` — code is fully implemented
- Purpose: isolate whether session filtering adds edge independently
- Run AFTER v7.2 reaches 100 trades

**v7.3** (future, do not build yet) — v7.2 + power-session gate combined:
- Only justified if v7.1 also demonstrates independent edge
- Do not build until both v7.1 and v7.2 individual tests are conclusive

**v7.0** (retired baseline):
- 25 trades: +0.053R expectancy, 40% WR — used to validate v7.2; no longer primary reference

**Key infrastructure**:
- `stopTightenAt15min` flag in TieredStrategyConfig; `stopTightenApplied: boolean` on activeTrade (records to market_context JSONB)
- `checkEntryGate()` pure function in `server/strategy/entryGate.ts` (Vitest-tested, 9 tests pass)
- `checkTieredExitRules()` stop-tighten branch (Vitest-tested, 7 tests pass); 16 total passing
- `market_context` JSONB enriched with `volRatio`, `atrRatio`, `minutesSinceOpen`, `tier`, `stopTightenApplied` on every trade
- `GET /api/simulations/report?version=X` endpoint — returns exits, tightenedCohort, sessions, tiers, runnerCount, avgRunnerMfe
- Vitest at `vitest.config.ts`; tests at `server/strategy/__tests__/`

## System Architecture
BreakoutIQ is built with a React 18 frontend (TypeScript, Vite, TailwindCSS, Shadcn UI), an Express.js (Node.js) backend, and a PostgreSQL database with Drizzle ORM. Authentication uses Passport-local with session-based methods, and real-time data/notifications are handled via WebSockets. The frontend utilizes Wouter for routing, TanStack React Query for state management, and Recharts for charting.

The backend features a modular strategy engine with pure TypeScript modules and a state machine for managing trading signal lifecycles. Key architectural components and features include:
-   **Enhanced Universe Filters**: Criteria based on price, volume, spread, ATR, and RVOL.
-   **Multi-timeframe Analysis**: Incorporates 15-minute higher timeframe bias and 5-minute entry analysis.
-   **Breakout & Retest Qualification**: Specific rules for candle body, range, volume, and resistance interaction.
-   **Market Regime Detection**: Utilizes SPY trend, VWAP position, and chop detection.
-   **Volatility Gate**: Ensures sufficient market volatility for trade consideration.
-   **Scoring System**: A composite 0-100 score for various factors influencing trade quality.
-   **Tiered Sizing**: Position sizing dynamically adjusted based on signal score and market conditions.
-   **Exit Management**: Supports partial exits, trailing stops, hard exits, and time-based stops.
-   **Risk Management**: Includes daily max loss, trade limits, and cooldown periods.
-   **Learning System**: Facilitates post-trade analysis, pattern classification, adaptive score penalties, and actionable insights.
-   **Historical Simulation Engine**: Enables backtesting by replaying past trading days.
-   **Strategy Modules**: Infrastructure for developing and integrating various trading strategies, such as VWAP Reversion.
-   **Dynamic Market Scanning Infrastructure**: Efficiently scans entire equity markets for potential trade setups.
-   **Trade Logging System**: Comprehensive audit trail for each trade, capturing essential metrics and context.
-   **Strategy Versioning & Archive System**: Allows users to manage and archive different strategy versions, with associated performance metrics.
-   **Rules-Freeze Guardrail**: Prevents modification of active strategy parameters to maintain data integrity for a given version.
-   **Sample-Size Confidence Badge**: Visual indicator for the statistical reliability of strategy performance metrics based on trade count.
-   **Volatility Cluster Score (VCS) System**: A composite 0-1 score evaluating market volatility based on gap density, market breadth, expansion, and SPY range.
-   **UI/UX**: Features a dashboard, scanner, watchlist, signals feed, trades log, and settings, all with a default dark theme.

## External Dependencies
-   **Alpaca API**: Provides live bars, snapshots, WebSocket data streams, market clock, and historical bar data (live feed + recent intraday history).
-   **Polygon.io API** (paid Starter plan): Historical intraday and daily bar data for simulation beyond Alpaca's free-tier limit. Routed via `server/polygon.ts`. Activated when `POLYGON_API_KEY` env var is set. Rate: `POLYGON_RATE_MS` env var (default 13000ms for free tier; set to 300 for paid plan). Key infrastructure: `usePolygon()` gate in `alpaca.ts`; all four fetch functions delegate to Polygon equivalents transparently.
-   **PostgreSQL**: Primary relational database.
-   **WebSocket**: Used for real-time price updates and market status notifications.
-   **Passport-local**: Handles user authentication.
-   **Wouter**: Manages frontend routing.
-   **TanStack React Query**: Manages asynchronous state on the frontend.
-   **Recharts**: Utilized for data visualization and charting on the frontend.