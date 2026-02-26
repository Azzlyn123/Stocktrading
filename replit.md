# BreakoutIQ - Intraday Trading Alert Platform

## Overview
BreakoutIQ is a full-stack trading alert application for US equities and ETFs, designed to identify and capitalize on intraday momentum breakout and retest strategies. It integrates multi-timeframe analysis, advanced universe filtering, market regime detection, and a sophisticated scoring system for risk-managed position sizing. The platform aims to provide comprehensive tools for trade management, post-trade analysis, and strategy learning, with ambitions to expand into diverse market opportunities.

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace

## Current Strategy Version
**v6** (active) — High-conviction entry + win-rate-biased exits:
- Entry: minScore=85, Tier A/B only (hard SPY alignment gate), breakout candle quality (close ≥75% of bar range + volume expansion vs prior bar)
- Exit: T1 at +0.5R/70% sell, stop moves to BE+0.05R after T1, 30% runner trails EMA9 or prior candle low, early failure exit (below EMA9 with no T1 progress)
- v5 baseline: 571 trades, -0.292R expectancy, 15.4% WR

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