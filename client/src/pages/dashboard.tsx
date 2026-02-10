import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { useEffect, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Radio,
  Clock,
  Activity,
  BarChart3,
  Target,
  Shield,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Signal, Alert, PaperTrade, DailySummary } from "@shared/schema";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function formatPct(val: number) {
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
}

function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: any;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tracking-tight">{value}</p>
            {subValue && (
              <p
                className={`text-xs font-medium ${
                  trend === "up"
                    ? "text-emerald-500"
                    : trend === "down"
                    ? "text-red-500"
                    : "text-muted-foreground"
                }`}
              >
                {subValue}
              </p>
            )}
          </div>
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { isConnected, subscribe } = useWebSocket();
  const [marketOpen, setMarketOpen] = useState(false);
  const [isLunchChop, setIsLunchChop] = useState(false);

  const { data: signals, isLoading: signalsLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 5000,
  });

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 5000,
  });

  const { data: trades } = useQuery<PaperTrade[]>({
    queryKey: ["/api/trades"],
    refetchInterval: 10000,
  });

  const { data: summaries } = useQuery<DailySummary[]>({
    queryKey: ["/api/summaries"],
  });

  useEffect(() => {
    const now = new Date();
    const est = new Date(
      now.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const hours = est.getHours();
    const minutes = est.getMinutes();
    const totalMin = hours * 60 + minutes;
    setMarketOpen(totalMin >= 570 && totalMin < 960 && est.getDay() >= 1 && est.getDay() <= 5);
  }, []);

  useEffect(() => {
    const unsub = subscribe("market_status", (data: any) => {
      setMarketOpen(data.isOpen);
      setIsLunchChop(data.isLunchChop ?? false);
    });
    return unsub;
  }, [subscribe]);

  const accountSize = user?.accountSize ?? 100000;
  const activeSignals = signals?.filter((s) => s.state !== "CLOSED" && s.state !== "IDLE") ?? [];
  const openTrades = trades?.filter((t) => t.status === "open") ?? [];
  const closedTrades = trades?.filter((t) => t.status === "closed") ?? [];
  const todayPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const winCount = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;
  const recentAlerts = (alerts ?? []).slice(0, 6);

  const equityCurve = (summaries ?? []).map((s, i) => ({
    date: s.date,
    balance: s.accountBalance ?? accountSize,
  }));

  if (equityCurve.length === 0 && closedTrades.length > 0) {
    let runningBalance = accountSize;
    const sorted = [...closedTrades].sort((a, b) => {
      const da = a.exitedAt ? new Date(a.exitedAt).getTime() : 0;
      const db = b.exitedAt ? new Date(b.exitedAt).getTime() : 0;
      return da - db;
    });
    equityCurve.push({ date: "Start", balance: accountSize });
    sorted.forEach((t, i) => {
      runningBalance += t.pnl ?? 0;
      equityCurve.push({
        date: `Trade ${i + 1}`,
        balance: Number(runningBalance.toFixed(2)),
      });
    });
  } else if (equityCurve.length === 0) {
    equityCurve.push(
      { date: "Start", balance: accountSize },
      { date: "Now", balance: accountSize + todayPnl },
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-dashboard-title">
            Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Breakout + Retest Strategy Overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={marketOpen ? "default" : "secondary"}
            className="gap-1"
            data-testid="badge-market-status"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                marketOpen ? "bg-emerald-400" : "bg-muted-foreground"
              }`}
            />
            {marketOpen ? "Market Open" : "Market Closed"}
          </Badge>
          <Badge variant={isConnected ? "default" : "destructive"} className="gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            {isConnected ? "Live" : "Offline"}
          </Badge>
          {isLunchChop && (
            <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/30" data-testid="badge-lunch-chop">
              <Clock className="w-3 h-3" />
              Lunch Chop
            </Badge>
          )}
          {user?.paperMode && (
            <Badge variant="outline" className="gap-1">
              Paper Mode
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {signalsLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-6 w-24" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <StatCard
              label="Account Balance"
              value={formatCurrency(accountSize + todayPnl)}
              subValue={formatPct((todayPnl / accountSize) * 100)}
              icon={DollarSign}
              trend={todayPnl >= 0 ? "up" : "down"}
            />
            <StatCard
              label="Today's P&L"
              value={formatCurrency(todayPnl)}
              subValue={`${closedTrades.length} trades`}
              icon={todayPnl >= 0 ? TrendingUp : TrendingDown}
              trend={todayPnl >= 0 ? "up" : "down"}
            />
            <StatCard
              label="Active Signals"
              value={`${activeSignals.length}`}
              subValue={`${openTrades.length} open positions`}
              icon={Radio}
              trend="neutral"
            />
            <StatCard
              label="Win Rate"
              value={`${winRate.toFixed(0)}%`}
              subValue={`${winCount}W / ${closedTrades.length - winCount}L`}
              icon={Target}
              trend={winRate >= 50 ? "up" : "down"}
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Equity Curve</p>
              <p className="text-xs text-muted-foreground">Paper account performance</p>
            </div>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    className="text-[10px] fill-muted-foreground"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    className="text-[10px] fill-muted-foreground"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(val: number) => [formatCurrency(val), "Balance"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--chart-1))"
                    fill="url(#colorBalance)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Recent Alerts</p>
              <p className="text-xs text-muted-foreground">Latest strategy signals</p>
            </div>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {recentAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Radio className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No alerts yet</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Signals will appear during market hours
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-start gap-2 p-2 rounded-md bg-accent/50"
                    data-testid={`alert-item-${alert.id}`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                        alert.priority === "high"
                          ? "bg-red-500"
                          : alert.priority === "medium"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{alert.ticker}</span>
                        <Badge variant="outline" className="text-[9px] px-1 min-h-4">
                          {alert.type}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {alert.message}
                      </p>
                    </div>
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {alert.createdAt
                        ? new Date(alert.createdAt).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Active Signals</p>
              <p className="text-xs text-muted-foreground">Current breakout setups</p>
            </div>
            <Radio className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {activeSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Target className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No active signals</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Monitoring watchlist for breakouts
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeSignals.slice(0, 5).map((signal) => (
                  <div
                    key={signal.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-accent/50"
                    data-testid={`signal-card-${signal.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">{signal.ticker}</div>
                      <Badge
                        variant={
                          signal.state === "TRIGGERED"
                            ? "default"
                            : signal.state === "BREAKOUT"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-[9px] px-1.5 min-h-5"
                      >
                        {signal.state}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium">
                        ${signal.currentPrice?.toFixed(2) ?? "—"}
                      </p>
                      <div className="flex items-center gap-1.5 justify-end">
                        {signal.rvol && (
                          <span className={`text-[10px] font-medium ${signal.rvol >= 1.5 ? "text-emerald-500" : "text-muted-foreground"}`}>
                            {signal.rvol.toFixed(1)}x
                          </span>
                        )}
                        {signal.resistanceLevel && (
                          <span className="text-[10px] text-muted-foreground">
                            R: ${signal.resistanceLevel.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Risk Status</p>
              <p className="text-xs text-muted-foreground">Daily limits and controls</p>
            </div>
            <Shield className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Daily Loss Limit</span>
                  <span className="font-medium">
                    {formatCurrency(Math.abs(todayPnl))} / {formatCurrency(accountSize * (user?.maxDailyLossPct ?? 2) / 100)}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-accent overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      Math.abs(todayPnl) > accountSize * (user?.maxDailyLossPct ?? 2) / 100 * 0.8
                        ? "bg-red-500"
                        : "bg-emerald-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        (Math.abs(todayPnl) /
                          (accountSize * (user?.maxDailyLossPct ?? 2) / 100)) *
                          100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-md bg-accent/50">
                  <p className="text-[10px] text-muted-foreground">Losing Trades</p>
                  <p className="text-sm font-medium mt-0.5">
                    {closedTrades.filter((t) => (t.pnl ?? 0) < 0).length} /{" "}
                    {user?.maxLosingTrades ?? 3}
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-accent/50">
                  <p className="text-[10px] text-muted-foreground">Per-Trade Risk</p>
                  <p className="text-sm font-medium mt-0.5">
                    {user?.perTradeRiskPct ?? 0.5}% (
                    {formatCurrency(accountSize * (user?.perTradeRiskPct ?? 0.5) / 100)})
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-accent/50">
                  <p className="text-[10px] text-muted-foreground">Max Position</p>
                  <p className="text-sm font-medium mt-0.5">
                    {user?.maxPositionPct ?? 20}% (
                    {formatCurrency(accountSize * (user?.maxPositionPct ?? 20) / 100)})
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-accent/50">
                  <p className="text-[10px] text-muted-foreground">Cooldown</p>
                  <p className="text-sm font-medium mt-0.5">
                    {user?.cooldownMinutes ?? 15} min
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {summaries && summaries.length > 0 && summaries.some((s) => (s.ruleViolations ?? 0) > 0) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Rule Violations</p>
              <p className="text-xs text-muted-foreground">Strategy discipline tracker</p>
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-1.5">
              {summaries
                .filter((s) => (s.ruleViolations ?? 0) > 0)
                .slice(0, 5)
                .map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start gap-2 p-2 rounded-md bg-accent/50"
                    data-testid={`violation-${s.id}`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{s.date}</span>
                        <Badge variant="outline" className="text-[9px] px-1 min-h-4">
                          {s.ruleViolations} violation{(s.ruleViolations ?? 0) > 1 ? "s" : ""}
                        </Badge>
                      </div>
                      {Array.isArray(s.ruleViolationDetails) && (s.ruleViolationDetails as string[]).map((detail: string, i: number) => (
                        <p key={i} className="text-[10px] text-muted-foreground mt-0.5">
                          {detail}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-center py-2">
        <p className="text-[9px] text-muted-foreground/50">
          Disclaimer: This is a paper trading simulator for educational purposes only. Not financial advice. Past simulated performance does not guarantee future results. Always consult a financial advisor before trading.
        </p>
      </div>
    </div>
  );
}
