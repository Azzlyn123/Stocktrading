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
- ORF strategy files: `server/strategy/orfDetector.ts`, endpoints: `/api/simulations/orf`, `/api/internal/orf-validate`, `/api/internal/orf-walkforward`

### ORF v2 Walk-Forward Validation (Dec 2025 - Feb 2026)
- **Result: NO EDGE** - Confirmed with 3-month walk-forward (42-day dev, 9-day test)
- ORF v2 enhancements: quality gates (minOR_ATR=0.25), partial exits at 1R w/ BE+0.02R buffer, VWAP touch modes, RS filter, 15-ticker universe, 1.35R runner target
- **Dev Window (Dec 2025 - Jan 2026)**: 52 trades, 30.8% WR, -0.313R avg, PF 0.361, max DD 16.27R
  - Avg MFE: 0.436R (median 0.297R), Avg MAE: -0.704R, hit 1R: 17.3%, hit target: 1.9%
  - Slippage cost: 0.0044R, scratch-after-partial: 3.8%
- **Test Window (Feb 2026)**: 13 trades, 7.7% WR, -0.670R avg, PF 0.048, max DD 8.71R
  - Avg MFE: 0.172R (median 0.041R), Avg MAE: -0.705R, hit 1R: 7.7%, hit target: 0.0%
- **Walk-Forward Degradation: -114%** — test window significantly worse than dev
- **Regime breakdown**: Neutral regime worst (-0.216R dev, -0.810R test); trending regime also negative (-0.409R dev, -0.506R test)
- **Per-symbol**: NVDA highest trade count (19 dev), all symbols negative avgR; no symbol shows edge
- **Structural diagnosis**: Median MFE 0.297R (dev) / 0.041R (test) confirms trades rarely extend beyond entry noise; MAE ~0.7R shows rapid adverse moves
- **Conclusion**: ORF failure move trades in mega-caps are structurally negative — the "failure" bounce is too weak and too brief to overcome friction costs

### Key Findings
- **Five strategy variants tested, zero edge found**: Momentum breakout (-0.309R), VWAP reversion (-0.253R), ORF v1 (-0.504R), ORF v2 walk-forward (-0.313R dev / -0.670R test), Gap continuation (-0.323R Variant A / -0.472R Variant B) all produce negative expectancy on mega-cap tickers
- Fundamental issue across all strategies: winners (~0.5-1R) ≈ losers (~0.7-1R), no payoff ratio advantage regardless of target setting
- Walk-forward validation shows -114% degradation from dev to test, confirming no stable edge
- Fill modeling with realistic slippage, spread, and commissions is critical - many "paper edges" disappear
- The platform infrastructure (simulation engine, fill modeling, regime detection, walk-forward framework) is production-grade and reusable for testing other strategies

### RS Continuation (Institutional Flow) Strategy - PENDING VALIDATION
- **Concept**: Trade relative strength continuation — buy stocks holding above VWAP while SPY weakens, breaking HOD with sustained RS for >30 minutes
- **Logic**: Institutional accumulation detection — ride flow instead of fighting it
- **Entry Criteria**: RS > 0.1% over 30min lookback, positive RS slope, ticker > VWAP, SPY < SPY VWAP (optional filter), Break of HOD
- **Stop**: Below max(recent swing low, VWAP) minus 0.1*ATR buffer
- **Exits**: Partial at 1R (50% size, stop to BE+buffer), trail after 1.5R, time exit at EOD, 2R target
- **Files**: `server/strategy/rsDetector.ts`, simulation: `runRSContinuationSimulation` in `server/historicalSimulator.ts`
- **Endpoint**: `/api/internal/rs-validate` — runs dry-run backtest across dates with full diagnostics (per-trade MFE/MAE, regime/symbol splits)
- **Validation Results (Feb 2026)**:
  - Phase A (Feb 3-13): -0.277R avg, 0.5R median MFE (Improved organic extension vs ORF/VWAP)
  - V1 (Partial at 1R + 2R Target): -0.277R
  - V2 (Partial at 1R + No Target): -0.277R
  - V3 (No Partial + No Target): PENDING PHASE B
- **Default universe**: 15 mega-cap tickers (AAPL, MSFT, NVDA, TSLA, META, AMZN, GOOGL, AMD, NFLX, AVGO, JPM, COST, QQQ, CRM, ORCL)
- **Status**: Phase B Walk-forward validation in progress

### Overnight Gap + Continuation Strategy - NO EDGE
- **Concept**: Trade gap-driven imbalance — overnight gaps create liquidity voids that continuation can exploit before mean-reversion kicks in
- **Rationale**: Gaps break the mega-cap liquidity recycling loop by creating imbalance when liquidity is thin (overnight)
- **Entry Criteria**: Gap ≥1.5%, RVOL ≥1.5x (first bar vs avg), 30-min opening range breakout in gap direction, stop at opposite OR side
- **Variant A**: Hold to close (time exit at 375min/3:45 PM), trailing stop at 0.5R after 1.5R MFE
- **Variant B**: Multi-day hold (max 3 days), exit when daily close breaks prior day low (LONG) or high (SHORT)
- **Risk**: 0.5% of account per trade, max 1 trade per ticker per day
- **Files**: `server/strategy/gapDetector.ts` (pure functions), `runGapContinuationSimulation` in `server/historicalSimulator.ts`
- **Endpoint**: `/api/internal/gap-phase-a` — runs both variants with configurable dates and gap config via request body
- **Default universe**: 15 mega-cap tickers (AAPL, MSFT, NVDA, TSLA, META, AMZN, GOOGL, AMD, NFLX, AVGO, JPM, COST, QQQ, CRM, ORCL)
- **Phase A Results (Nov 2025 - Feb 2026, 70 trading days)**:
  - **Variant A (Hold to Close)**: 81 trades, 34.6% WR, -0.323R avgR, median MFE 0.277R, median MAE -0.666R
  - **Variant B (Multi-day Hold)**: 54 trades, 25.9% WR, -0.472R avgR, median MFE 0.250R, median MAE -0.740R
  - Multi-day hold degrades performance: -46% more negative avgR, -8.7pp lower WR
  - Only 9.9% of trades reach ≥1R MFE; 0% reach ≥2R
  - 51% of losses (41/81) stop before 0.3R MFE — gaps reverse quickly in mega-caps
  - TSLA only symbol with marginal positive avgR (+0.074R, 12 trades); NVDA worst (-0.721R, 15 trades)
- **Gap Threshold Sweep (Variant A)**:
  - 1.0%: 128 trades, 31.3% WR, -0.301R avgR (best avgR but still negative)
  - 1.25%: 67 trades, 23.9% WR, -0.401R avgR
  - 1.5%: 81 trades, 34.6% WR, -0.323R avgR (best WR and MFE)
  - 2.0%: 28 trades, 28.6% WR, -0.432R avgR (zero 1R+ opportunities)
  - No threshold achieves positive expectancy
- **Conclusion**: Gap continuation in mega-caps is structurally negative — opening range breakouts after gaps reverse too quickly; the liquidity void hypothesis does not produce tradeable edge with these entry/exit rules

## External Dependencies
- **Alpaca API**: Used for live bars, snapshots, WebSocket data streams, market clock, and historical bar data.
- **PostgreSQL**: Relational database for storing all application data.
- **WebSocket**: For real-time price updates and market status notifications.
- **Passport-local**: For session-based user authentication.
- **Wouter**: Frontend routing library.
- **TanStack React Query**: For asynchronous state management in the frontend.
- **Recharts**: For data visualization and charting in the frontend.
