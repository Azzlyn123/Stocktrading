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
- **VWAP Reversion Strategy Module**: Alternative strategy that fades overextended moves from VWAP, with configurable parameters.
- **UI/UX**: Features a comprehensive dashboard, scanner, watchlist, signals feed, trades log, and settings page, all designed with a default dark theme and toggle functionality.

## Strategy Backtesting Results (Feb 2026)

### Breakout + Retest Strategy (3-Month Test)
- **Result: NO EDGE** - 108 trades, -0.309R expectancy, 12% win rate
- Median MFE +0.05R shows trades stall/revert rather than expand
- Confirmed across all market regimes and sessions

### VWAP Reversion Strategy (9-Day Validation, Feb 3-13 2026)
- **Result: NO EDGE** - All configurations show negative expectancy
- Tickers tested: AAPL, MSFT, NVDA, TSLA, META
- Best config (3.0 ATR deviation, 3+ exhaustion signals, 1 trade/ticker max): 7 trades, 28.6% WR, -0.253R avg
- More aggressive configs (1.5-2.5 ATR): 27-79 trades, 16-25% WR, -0.55 to -0.73R avg
- Stricter filters improve R but don't achieve positive expectancy
- Average winner (~1.0R) approximately equals average loser (~-1.0R), no payoff ratio edge

### Opening Range Failure (ORF) Strategy (9-Day Validation, Feb 3-13 2026)
- **Result: NO EDGE** - All configurations show negative expectancy
- Tickers tested: AAPL, MSFT, NVDA, TSLA, META with SPY divergence filter
- Default config (0.25% break, 3-bar fail window, 2R target, vol confirmation): 26 trades, 19.2% WR, -0.504R avg
- Reduced target (1.5R, trail at 1.0R, max 2/ticker): 27 trades, 25.9% WR, -0.367R avg
- Relaxed config (0.3% break, 5-bar fail, no vol req): 30 trades, 26.7% WR, -0.355R avg
- **Critical finding**: Average winner (~0.9R) still approximately equals average loser (~0.83R) — the 2R target is NOT reached; trades exit via time/trailing stops before achieving target R
- ORF strategy files: `server/strategy/orfDetector.ts`, endpoints: `/api/simulations/orf`, `/api/internal/orf-validate`

### Key Findings
- **Three strategies tested, zero edge found**: Momentum breakout (-0.309R), VWAP reversion (-0.253R), and Opening Range Failure (-0.504R) all produce negative expectancy on mega-cap tickers
- Fundamental issue across all strategies: winners (~1R) ≈ losers (~1R), no payoff ratio advantage regardless of target setting
- Fill modeling with realistic slippage, spread, and commissions is critical - many "paper edges" disappear
- The platform infrastructure (simulation engine, fill modeling, regime detection) is production-grade and reusable for testing other strategies

## External Dependencies
- **Alpaca API**: Used for live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
- **PostgreSQL**: Relational database for storing all application data.
- **WebSocket**: For real-time price updates and market status notifications.
- **Passport-local**: For session-based user authentication.
- **Wouter**: Frontend routing library.
- **TanStack React Query**: For asynchronous state management in the frontend.
- **Recharts**: For data visualization and charting in the frontend.
