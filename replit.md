# BreakoutIQ - Intraday Trading Alert Platform

## Overview
Full-stack trading alert application implementing a modular momentum Breakout + Retest intraday strategy for US equities and ETFs. Features multi-timeframe analysis (15m bias filter, 5m entries), enhanced universe filters (price ≥$10, $vol ≥$100M, spread ≤0.05%, ATR ≥1.2%, RVOL ≥1.5), market regime detection with SPY alignment, volatility expansion gates, and a 0-100 scoring system with tiered position sizing (full/half/pass). Includes partial exits at +1R, EMA9/prior-low trailing stops, 2 red candle exits, time stops, and paper trading simulation with WebSocket real-time data.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Shadcn UI
- **Backend**: Express.js + Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Passport-local with session-based auth
- **Real-time**: WebSocket for price updates and signal notifications
- **Routing**: Wouter
- **State**: TanStack React Query
- **Charts**: Recharts

## Project Structure
```
client/src/
  App.tsx              - Main app with auth guard, sidebar layout, routing
  pages/
    auth-page.tsx      - Login/Register page
    dashboard.tsx      - Main dashboard with stats, equity curve, alerts, rule violations
    scanner.tsx        - Scanner with score, spread%, ATR%, RVOL, 15m bias, SPY regime
    watchlist.tsx      - Ticker watchlist management
    signals.tsx        - Signal feed with scoring, market regime, entry mode, score breakdown
    trades.tsx         - Paper trades with score tier, entry mode, enhanced exit labels
    settings.tsx       - Full config: risk, universe, breakout quality, market regime, scoring
    learning.tsx       - Learning insights: loss/win patterns, tier/session stats, recommendations, recent lessons
    backtester.tsx     - Historical simulation: date picker, run controls, progress tracking, results display
  components/
    app-sidebar.tsx    - Sidebar navigation
    theme-provider.tsx - Dark/light mode
    theme-toggle.tsx   - Theme toggle button
  hooks/
    use-auth.ts        - Auth hook
    use-websocket.ts   - WebSocket connection hook

server/
  index.ts             - Express server entry
  routes.ts            - API routes + WebSocket + scanner endpoint
  auth.ts              - Passport config
  storage.ts           - Database CRUD operations
  db.ts                - Drizzle database connection
  simulator.ts         - Orchestrator: per-ticker state, 15m bars, SPY context, scoring, exit management
  seed.ts              - Demo data seeding with scoring fields
  alpaca.ts            - Alpaca API: live bars, snapshots, WebSocket stream, market clock, historical date bars
  historicalSimulator.ts - Historical simulation engine: replays past trading days through strategy pipeline
  strategy/
    index.ts           - Barrel export for all strategy modules
    config.ts          - DEFAULT_STRATEGY_CONFIG with all sub-configs
    types.ts           - Candle, StrategyConfig, result types
    indicators.ts      - Pure functions: EMA, SMA, ATR, VWAP, bodyPct, avgVolume, avgRange, findResistance, detectCandlePattern
    universeFilter.ts  - Price, $volume, spread, ATR%, RVOL gate
    higherTimeframeBias.ts - 15m: VWAP, EMA9/20, day high break, premarket high
    breakoutQualification.ts - Body ≥60%, range ≥1.2x avg, volume ≥1.8x, close above resistance
    retestRules.ts     - Pullback ≤50%, volume contraction, holding support, entry/stop calc
    marketRegime.ts    - SPY 5m trend, VWAP position, chop detection (>3 crosses in 20min)
    volatilityGate.ts  - First 30m range ≥70% prev day, 5m ATR ≥1.3x baseline
    scoring.ts         - 0-100 composite: RVOL(20) + trend(15) + BO vol(20) + retest vol(15) + SPY(15) + ATR(10) + catalyst(5)
    exits.ts           - Partial +1R, trailing (EMA9/prior low), 2 red candles, time stop, stop loss, target
    learning.ts        - Post-trade analysis engine: classifies wins/losses, tags patterns, computes learning penalties, generates adaptive insights

shared/
  schema.ts            - Drizzle schema + Zod validation + settingsUpdateSchema
```

## Key Features
- **Modular Strategy Engine**: 8 pure TypeScript modules in server/strategy/
- **State Machine**: IDLE -> BREAKOUT -> RETEST -> TRIGGERED -> MANAGED -> CLOSED
- **Enhanced Universe Filters**: Price ≥$10, $Volume ≥$100M, Spread ≤0.05%, ATR ≥1.2%, RVOL ≥1.5
- **15m Higher Timeframe Bias**: VWAP, EMA9/20 slope, day high break, premarket high (need 2/3)
- **Breakout Qualification**: Body ≥60% range, range ≥1.2x avg, volume ≥1.8x, close above resistance
- **Retest Rules**: Pullback ≤50% of breakout candle, volume contraction, conservative/aggressive entry
- **Market Regime**: SPY 5m EMA9 > EMA20 + above VWAP, chop = >3 VWAP crosses in 20min
- **Volatility Gate**: First 30m range ≥70% prev day range, 5m ATR ≥1.3x daily baseline
- **Scoring System**: 0-100 with breakdown (RVOL 20, trend 15, BO vol 20, retest vol 15, SPY 15, ATR 10, catalyst 5)
- **Tiered Sizing**: ≥80 full, 65-79 half, <65 pass. Choppy regime reduces 50%
- **Exit Management**: Partial 50% at +1R, stop to BE, trail by EMA9 or prior 5m low, hard exit on 2 red candles with increasing volume
- **Time Stop**: Exit if not +0.5R within 30 minutes
- **Risk Management**: Daily -2% max loss, 3 losing trades stop, 15-min cooldown
- **Lunch Chop Filter**: 11:30-13:30 ET
- **Learning System**: Post-trade analysis classifies wins/losses, tags 18 pattern types, computes adaptive score penalties
- **Learning Penalties**: Pre-entry score deduction based on ticker loss rate, tier performance, recurring patterns, loss streaks (capped -40pts)
- **Adaptive Insights**: Tier/session win rates, top loss/win patterns with suggestions, actionable recommendations
- **Paper Trading**: Simulated $100k account with P&L tracking
- **Real-time Data**: WebSocket streaming simulated price updates
- **Dark Mode**: Default dark theme with toggle

## Database Schema
- users (risk settings + enhanced strategy: spread, ATR%, RVOL, breakout quality, entry mode, regime, scoring thresholds)
- watchlist_items
- signals (state machine + score, scoreTier, marketRegime, entryMode, stopBasis, spyAligned, volatilityGatePassed, scoreBreakdown JSONB)
- alerts
- paper_trades (+ score, scoreTier, entryMode, enhanced exit reasons)
- daily_summaries (ruleViolations, ruleViolationDetails, accountBalance)
- trade_lessons (tradeId, ticker, tier, outcomeCategory, exitReason, lessonTags[], lessonDetail, entryConditions JSONB, marketContext JSONB, scoreAtEntry, patternHash, durationMinutes)

## API Endpoints
- POST /api/register, /api/login, /api/logout
- GET /api/user
- PATCH /api/settings (validates via settingsUpdateSchema with all new fields)
- GET/POST/DELETE /api/watchlist
- GET /api/signals
- GET /api/scanner (returns filtered/passing tickers with score, spread, ATR%, RVOL, SPY regime)
- GET/POST /api/alerts, POST /api/alerts/mark-read
- GET /api/trades
- GET /api/summaries
- GET /api/lessons (raw lesson records)
- GET /api/lessons/insights (lessons + computed insights: topLossPatterns, topWinPatterns, tierStats, sessionStats, recommendations)
- WS /ws - Real-time price updates + market_status (isOpen, isLunchChop, spyAligned, spyChopping)

## Important Notes
- **Shared Data Model**: All trading data (signals, trades, alerts, watchlist, summaries, scanner) is shared across ALL users. The simulator runs as a single shared instance using the first registered user's settings. Auth is still per-user for login purposes.
- Schema changes done via SQL ALTER statements to avoid session table drops
- Strategy modules are pure functions for testability (no side effects, no database access)
- Simulator orchestrates strategy modules and handles DB persistence via sharedUserId (first registered user)
- settingsUpdateSchema validates all settings fields including new enhanced strategy params
- buildConfigFromUser in strategy/index.ts maps user settings to StrategyConfig
- Storage has both per-user methods (getSignals, getTrades, etc.) and global methods (getAllSignals, getAllTrades, etc.) - routes use global methods

## Recent Changes (Feb 13, 2026)
- **Production-Grade Friction Model**: Complete rewrite of fill/cost modeling
  - `applyFrictionAndRound`: tick rounding (round against yourself), dynamic slippage, short-side support
  - `roundToTick`: long entry rounds up, long exit rounds down; short inverted (always adverse)
  - Dynamic slippage: `slippageBps = baseBps + k*(ATR/price)*10000`, clamped [baseBps, 50bps], slippageK=0.25
  - SIM_CONFIG: baseSlippageBps=5, halfSpreadBps=3, slippageK=0.25, tickSize=0.01, commissionPerShare=0.005, minCommission=1.0
- **Gap-Through Exit Fills**: `rawExitFillLong` function with gap-aware OHLC logic
  - STOP gaps through (barOpen <= stopLevel): fill at bar.open (worse price)
  - TARGET gaps past (barOpen >= targetLevel): fill at target (conservative, no gap gift)
  - MARKET/EOD: fill at bar.open
- **Ambiguous Bar Handling**: When both stop AND target crossed in same 5m bar
  - Long: barLow <= stop AND barHigh >= target → assume stop hit first (conservative)
  - Documented, deterministic, prevents unrealistic "both hit" wins
- **Pending Exit Mechanism**: Close-based exits (time_stop, hard_exit) defer fill to next bar open
  - `activeTrade.pendingExit` field stores decision, fills at next bar's open
  - Intrabar exits (stop_loss, target, partial) still fill immediately with gap-aware logic
  - EOD: if pendingExit exists when session ends, fills at session close (documented)
- **Execution Timing Contract**:
  - Intrabar exits (STOP/TARGET): fill same bar with gap-aware OHLC rules
  - Close-based decisions (TIME_STOP/HARD_EXIT): fill next bar open via pendingExit
  - Entry: fills at retest bar close (documented assumption - requires fast execution in live)
  - EOD close: fills at session close (documented)
- **Cost Sensitivity Analysis**: POST /api/simulations/:id/cost-sensitivity
  - Re-runs completed sim with 9 cost combos (slippage 0/5/10 x spread 1/3/5 bps)
  - Uses isDryRun mode (no DB writes) + preloadedBars (no re-fetching API data)
  - CostOverrides passed as args, global SIM_CONFIG never mutated
  - Returns grid: trades, winRate, expectancyR, profitFactor, maxDrawdown, netPnl, grossPnl, totalCosts, isBaseline
- **Cost Sensitivity UI**: Button on completed RunCards in backtester page
  - 3x3 grid with green/red coloring based on edge survival (expectancyR > 0)
  - Baseline combo highlighted with ring, legend for edge survives/breaks down
- **Previous Changes (Feb 12, 2026)**:
  - Walk-forward lesson isolation: learning penalty only uses lessons from dates BEFORE current simulation date
  - Commission model: $0.005/share with $1 minimum, deducted from P&L (entry + exit)
- **Benchmark Comparison**: Each simulation run calculates and stores:
  - Buy & hold: $10k per ticker, open→close for the day
  - EMA baseline: 5/20 EMA crossover strategy for comparison
- **Advanced Metrics**: Stored per simulation run in JSONB:
  - Expectancy (avg R-multiple), profit factor, max drawdown, Sharpe ratio (annualized)
  - Avg slippage per trade, avg commission per trade, total R
- **Performance Breakdown**: Win/loss/P&L tracked by regime (trending/choppy/neutral), session (open/mid/power), and tier (A/B/C)
- **Skipped Setups**: Trades skipped by learning penalty stored with context (ticker, score, penalty, reason)
- **Enhanced Backtester UI**: Shows benchmarks (bot vs buy&hold vs EMA), cost breakdown (gross→slippage→commission→net), advanced metrics, expandable regime/session/tier breakdown, skipped setup count
- **Schema additions**: simulation_runs table has grossPnl, totalCommission, totalSlippageCost (real), benchmarks, metrics, breakdown, skippedSetups (JSONB)
- **Fixed findResistance**: Excludes most recent 2 bars from resistance calculation, searches for consolidation levels with 2+ touches at same price zone instead of tracking highest high (which made breakouts impossible)
- **Improved RVOL scoring**: 5-tier granular scoring (5/10/14/18/20 pts) instead of binary 5/10 to prevent artificially low scores
- **Score partial credit**: Non-aligned trend gives 8pts (not 0), non-aligned regime gives 8pts (not 0), producing more realistic base scores
- **Learning penalty cap**: Capped at 20pts in historical simulator to prevent runaway filtering of all trade setups
- **SIP data feed**: Switched from IEX to SIP feed for 35x more volume data accuracy
- **Multi-day RVOL baseline**: fetchMultiDayDailyBars fetches 20-day daily bars for accurate RVOL/ATR calculations

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace
