# BreakoutIQ - Intraday Trading Alert Platform

## Overview
Full-stack trading alert application implementing a Breakout + Retest intraday strategy for US equities and ETFs. Generates "SETUP forming" and "TRIGGER hit" alerts with multi-timeframe analysis (1H trend filter, 5m entries). Paper trading mode with simulated market data.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Shadcn UI
- **Backend**: Express.js + Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Passport-local with session-based auth
- **Real-time**: WebSocket for price updates and signal notifications
- **Routing**: Wouter
- **State**: TanStack React Query

## Project Structure
```
client/src/
  App.tsx              - Main app with auth guard, sidebar layout, routing
  pages/
    auth-page.tsx      - Login/Register page
    dashboard.tsx      - Main dashboard with stats, equity curve, alerts
    watchlist.tsx       - Ticker watchlist management
    signals.tsx        - Signal feed with state machine display
    trades.tsx         - Paper trade tracking
    settings.tsx       - Risk params and strategy configuration
  components/
    app-sidebar.tsx    - Sidebar navigation
    theme-provider.tsx - Dark/light mode
    theme-toggle.tsx   - Theme toggle button
  hooks/
    use-auth.ts        - Auth hook
    use-websocket.ts   - WebSocket connection hook

server/
  index.ts             - Express server entry
  routes.ts            - API routes + WebSocket setup
  auth.ts              - Passport config
  storage.ts           - Database CRUD operations
  db.ts                - Drizzle database connection
  simulator.ts         - Simulated market data + strategy engine
  seed.ts              - Demo data seeding

shared/
  schema.ts            - Drizzle schema + Zod validation
```

## Key Features
- **Strategy Engine**: Breakout + Retest detection with state machine (IDLE -> BREAKOUT -> RETEST -> TRIGGERED -> MANAGED -> CLOSED)
- **Risk Management**: Daily loss limits, max losing trades, cooldown, per-trade risk, position size caps
- **Paper Trading**: Simulated $100k account with P&L tracking
- **Real-time Data**: WebSocket streaming simulated price updates
- **Dark Mode**: Default dark theme with toggle

## Database Schema
- users (with risk/strategy settings)
- watchlist_items
- signals (with state machine)
- alerts
- paper_trades
- daily_summaries

## API Endpoints
- POST /api/register, /api/login, /api/logout
- GET /api/user
- PATCH /api/settings
- GET/POST/DELETE /api/watchlist
- GET /api/signals
- GET/POST /api/alerts, POST /api/alerts/mark-read
- GET /api/trades
- GET /api/summaries
- WS /ws - Real-time price updates

## User Preferences
- Default dark mode
- Inter font family
- JetBrains Mono for monospace
