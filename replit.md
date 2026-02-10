# BreakoutIQ - Intraday Trading Alert Platform

## Overview
Full-stack trading alert application implementing a Breakout + Retest intraday strategy for US equities and ETFs. Generates "SETUP forming" and "TRIGGER hit" alerts with multi-timeframe analysis (1H trend filter, 5m entries). Paper trading mode with simulated market data. Hard universe filters (price ≥$15, volume ≥2M, $volume ≥$50M), lunch chop filter (11:30-13:30 ET), and comprehensive trade management (partial exits, trailing stops, time stops).

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
    scanner.tsx        - In-play movers scanner with hard filters
    watchlist.tsx       - Ticker watchlist management
    signals.tsx        - Signal feed with state machine, RVOL, candle patterns
    trades.tsx         - Paper trade tracking with partial exits, trailing stops
    settings.tsx       - Risk params, universe filters, trade management config
  components/
    app-sidebar.tsx    - Sidebar navigation (Dashboard, Scanner, Watchlist, Signals, Trade Plans, Settings)
    theme-provider.tsx - Dark/light mode
    theme-toggle.tsx   - Theme toggle button
  hooks/
    use-auth.ts        - Auth hook
    use-websocket.ts   - WebSocket connection hook

server/
  index.ts             - Express server entry
  routes.ts            - API routes + WebSocket setup + scanner endpoint
  auth.ts              - Passport config
  storage.ts           - Database CRUD operations
  db.ts                - Drizzle database connection
  simulator.ts         - Strategy engine: lunch chop, RVOL, candle patterns, position sizing, partial exits, trailing stops, time stops, daily risk enforcement
  seed.ts              - Demo data seeding with new schema fields

shared/
  schema.ts            - Drizzle schema + Zod validation + settingsUpdateSchema
```

## Key Features
- **Strategy Engine**: Breakout + Retest detection with state machine (IDLE -> BREAKOUT -> RETEST -> TRIGGERED -> MANAGED -> CLOSED)
- **Hard Universe Filters**: Price ≥$15, Avg Volume ≥2M, Dollar Volume ≥$50M
- **Lunch Chop Filter**: No new setups/entries 11:30-13:30 ET, manage open positions only
- **RVOL Tracking**: Relative volume vs expected volume at time of day
- **Candle Pattern Detection**: Bullish Engulfing, Hammer, Green Candle
- **Position Sizing**: shares = risk / (entry - stop), capped by maxPositionPct
- **Stop Placement**: Below retest swing low + 0.05% buffer
- **Trade Management**: 50% partial at +1R, stop to breakeven, 1.5x ATR trailing on runner, 2R-3R main target
- **Time Stop**: Exit if not +0.5R within 30 minutes
- **Risk Management**: Daily -2% max loss, 3 losing trades stop, 15-min cooldown, per-trade risk caps
- **Rule Violation Tracking**: Logged per-day with details
- **Paper Trading**: Simulated $100k account with P&L tracking
- **Real-time Data**: WebSocket streaming simulated price updates
- **Dark Mode**: Default dark theme with toggle

## Database Schema
- users (with risk/strategy settings, hard filters, lunch chop, earnings, time stop, partial exit settings)
- watchlist_items
- signals (with state machine, rvol, rejectionCount, candlePattern, positionSize, dollarRisk)
- alerts
- paper_trades (with originalStopPrice, isPartiallyExited, partialExitPrice/Shares, stopMovedToBE, runnerShares, trailingStopPrice, timeStopAt, dollarRisk)
- daily_summaries (with ruleViolations, ruleViolationDetails, accountBalance)

## API Endpoints
- POST /api/register, /api/login, /api/logout
- GET /api/user
- PATCH /api/settings (validates via settingsUpdateSchema)
- GET/POST/DELETE /api/watchlist
- GET /api/signals
- GET /api/scanner (returns filtered/passing tickers with RVOL)
- GET/POST /api/alerts, POST /api/alerts/mark-read
- GET /api/trades
- GET /api/summaries
- WS /ws - Real-time price updates + market_status (isOpen, isLunchChop)

## Important Notes
- Schema changes done via SQL ALTER statements to avoid session table drops
- Strategy engine in simulator.ts handles full lifecycle from scanning to position management
- settingsUpdateSchema in shared/schema.ts validates all settings fields with min/max bounds

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace
