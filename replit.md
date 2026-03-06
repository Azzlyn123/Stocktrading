# BreakoutIQ - Intraday Trading Alert Platform

## Overview
BreakoutIQ is a full-stack trading alert application for US equities and ETFs, designed to identify and capitalize on intraday momentum breakout and retest strategies. It integrates multi-timeframe analysis, advanced universe filtering, market regime detection, and a sophisticated scoring system for risk-managed position sizing. The platform aims to provide comprehensive tools for trade management, post-trade analysis, and strategy learning, with ambitions to expand into diverse market opportunities.

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace

## Current Strategy Version
**v7.2** (active) — Tier A only + 15-min stop-tighten:
- Entry: Tier A only (volRatio ≥1.8, atrRatio ≥1.2), all sessions allowed
- Exit: T1 at +0.4R/70% sell, stop tightens to entry-0.05R at 15min if MFE < 0.10R (no market exit); time_stop otherwise
- v7.0 baseline (25 trades): +0.053R expectancy, 40% WR — confirmed positive expectancy

**v7.1** (ready, not active) — Tier A + Power Session only:
- Entry: Tier A only AND minutesSinceOpen > 240 (power session gate)
- Activate when ≥50 v7.2 trades exist for clean A/B comparison

**v7.0** (baseline) — Tier A only, all sessions:
- 25 trades completed: +0.053R expectancy, 40% WR, zero impulse exits

**Key infrastructure added (v7.2 session)**:
- `stopTightenAt15min` flag in TieredStrategyConfig
- `checkEntryGate()` pure function in `server/strategy/entryGate.ts` (Vitest-tested, 9 tests pass)
- `market_context` JSONB enriched with `volRatio`, `atrRatio`, `minutesSinceOpen`, `tier` on every trade
- `GET /api/simulations/report?version=X` endpoint with full breakdown (exits, sessions, tiers)
- Vitest installed; config at `vitest.config.ts`; tests at `server/strategy/__tests__/`

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
-   **Alpaca API**: Provides live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
-   **PostgreSQL**: Primary relational database.
-   **WebSocket**: Used for real-time price updates and market status notifications.
-   **Passport-local**: Handles user authentication.
-   **Wouter**: Manages frontend routing.
-   **TanStack React Query**: Manages asynchronous state on the frontend.
-   **Recharts**: Utilized for data visualization and charting on the frontend.