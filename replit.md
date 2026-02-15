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

## External Dependencies
-   **Alpaca API**: Live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
-   **PostgreSQL**: Relational database.
-   **WebSocket**: Real-time price updates and market status notifications.
-   **Passport-local**: User authentication.
-   **Wouter**: Frontend routing.
-   **TanStack React Query**: Frontend asynchronous state management.
-   **Recharts**: Frontend data visualization and charting.