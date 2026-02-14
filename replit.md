# BreakoutIQ - Intraday Trading Alert Platform

## Overview
BreakoutIQ is a full-stack trading alert application designed for US equities and ETFs, implementing a modular momentum breakout and retest intraday strategy. It incorporates multi-timeframe analysis, advanced universe filters, market regime detection, volatility expansion gates, and a sophisticated 0-100 scoring system for tiered position sizing. The platform supports various exit strategies, paper trading with real-time data, and a learning system for post-trade analysis and adaptive insights. Its core purpose is to provide an analytical tool for intraday trading, with ambitions to identify and capitalize on short-term market movements while managing risk.

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace

## System Architecture
BreakoutIQ is built with a React 18 frontend (TypeScript, Vite, TailwindCSS, Shadcn UI), an Express.js (Node.js) backend, and a PostgreSQL database utilizing Drizzle ORM. Authentication is handled by Passport-local with session-based methods. Real-time data and signal notifications are managed via WebSockets. The frontend uses Wouter for routing, TanStack React Query for state management, and Recharts for charting.

The backend features a modular strategy engine composed of pure TypeScript modules for high testability. A state machine manages the lifecycle of trading signals (IDLE -> BREAKOUT -> RETEST -> TRIGGERED -> MANAGED -> CLOSED). Key architectural decisions include:
- **Enhanced Universe Filters**: Strict criteria for price, volume, spread, ATR, and RVOL.
- **Multi-timeframe Analysis**: 15m higher timeframe bias (VWAP, EMA slopes, premarket high) and 5m entry analysis.
- **Breakout Qualification**: Specific criteria for candle body, range, volume, and resistance interaction.
- **Retest Rules**: Defined pullback and volume contraction rules for entry.
- **Market Regime Detection**: SPY trend, VWAP position, and chop detection.
- **Volatility Gate**: Ensures sufficient market volatility for trade consideration.
- **Scoring System**: A composite 0-100 score with detailed breakdown for various factors.
- **Tiered Sizing**: Position sizing adjusted based on signal score and market conditions.
- **Exit Management**: Comprehensive exit strategies including partial exits, trailing stops, hard exits, and time stops.
- **Risk Management**: Daily max loss, trade limits, and cooldown periods.
- **Learning System**: Post-trade analysis, pattern classification, adaptive score penalties, and actionable insights.
- **Historical Simulation Engine**: Capable of replaying past trading days to backtest strategy performance.
- **UI/UX**: Features a comprehensive dashboard, scanner, watchlist, signals feed, trades log, and settings page, all designed with a default dark theme and toggle functionality.

## External Dependencies
- **Alpaca API**: Used for live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
- **PostgreSQL**: Relational database for storing all application data.
- **WebSocket**: For real-time price updates and market status notifications.
- **Passport-local**: For session-based user authentication.
- **Wouter**: Frontend routing library.
- **TanStack React Query**: For asynchronous state management in the frontend.
- **Recharts**: For data visualization and charting in the frontend.