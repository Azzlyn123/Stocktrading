import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  CheckCircle,
  Clock,
  ArrowRightLeft,
} from "lucide-react";
import type { PaperTrade } from "@shared/schema";

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    A: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
    B: "text-amber-500 bg-amber-500/10 border-amber-500/30",
    C: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  };
  return (
    <span data-testid={`tier-badge-${tier}`} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${colors[tier] ?? "text-muted-foreground bg-accent"}`}>
      Tier {tier}
    </span>
  );
}

function TradeCard({ trade }: { trade: PaperTrade }) {
  const isOpen = trade.status === "open";
  const isProfitable = (trade.pnl ?? 0) >= 0;

  return (
    <Card data-testid={`trade-card-${trade.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold">{trade.ticker}</span>
            <Badge
              variant={isOpen ? "default" : "secondary"}
              className="text-[9px] px-1.5 min-h-5"
            >
              {isOpen ? "Open" : "Closed"}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1.5 min-h-5 uppercase">
              {trade.side}
            </Badge>
            {(trade.tier ?? trade.scoreTier) && (
              <TierBadge tier={trade.tier ?? trade.scoreTier} />
            )}
            {trade.direction && (
              <Badge variant="outline" className="text-[9px] px-1.5 min-h-5">
                {trade.direction}
              </Badge>
            )}
          </div>
          {trade.pnl != null && (
            <div className="text-right">
              <p
                className={`text-sm font-medium ${
                  isProfitable ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {isProfitable ? "+" : ""}${trade.pnl.toFixed(2)}
              </p>
              {trade.rMultiple != null && (
                <p className="text-[10px] text-muted-foreground">
                  {trade.rMultiple >= 0 ? "+" : ""}{trade.rMultiple.toFixed(2)}R
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Entry</p>
            <p className="text-xs font-medium mt-0.5">
              ${trade.entryPrice?.toFixed(2) ?? "—"}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Stop</p>
            <p className="text-xs font-medium mt-0.5 text-red-500">
              ${trade.stopPrice?.toFixed(2) ?? "—"}
            </p>
            {trade.stopMovedToBE && (
              <p className="text-[8px] text-emerald-500">at BE</p>
            )}
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">T1 (+1R)</p>
            <p className="text-xs font-medium mt-0.5 text-emerald-500">
              ${trade.target1?.toFixed(2) ?? "—"}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">T2 (runner)</p>
            <p className="text-xs font-medium mt-0.5 text-emerald-500">
              ${trade.target2?.toFixed(2) ?? "—"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span>{trade.shares} shares</span>
          {trade.dollarRisk && (
            <>
              <span className="text-muted-foreground/30">|</span>
              <span>Risk: ${trade.dollarRisk.toFixed(0)}</span>
            </>
          )}
          {trade.exitPrice != null && (
            <>
              <span className="text-muted-foreground/30">|</span>
              <span>Exit: ${trade.exitPrice.toFixed(2)}</span>
            </>
          )}
        </div>

        {(trade.isPartiallyExited || trade.stopMovedToBE || trade.runnerShares) && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
            {trade.isPartiallyExited && (
              <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500">
                <ArrowRightLeft className="w-2.5 h-2.5" />
                Partial: {trade.partialExitShares} @ ${trade.partialExitPrice?.toFixed(2)}
              </div>
            )}
            {trade.stopMovedToBE && (
              <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500">
                <Shield className="w-2.5 h-2.5" />
                Stop at BE
              </div>
            )}
            {trade.runnerShares && (
              <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-accent text-muted-foreground">
                <TrendingUp className="w-2.5 h-2.5" />
                Runner: {trade.runnerShares} shares
              </div>
            )}
          </div>
        )}

        {trade.timeStopAt && isOpen && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-500">
            <Clock className="w-3 h-3" />
            Time stop: {new Date(trade.timeStopAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })} (exit if not +0.5R)
          </div>
        )}

        {trade.entryMode && (
          <span className="text-[9px] text-muted-foreground">
            Entry: {trade.entryMode}
          </span>
        )}

        {trade.exitReason && (
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className={`px-1.5 py-0.5 rounded ${
                trade.exitReason === "target" || trade.exitReason === "trailing_stop"
                  ? "bg-emerald-500/10 text-emerald-500"
                  : trade.exitReason === "stop_loss" || trade.exitReason === "hard_exit" || trade.exitReason === "two_red_candles"
                  ? "bg-red-500/10 text-red-500"
                  : "bg-amber-500/10 text-amber-500"
              }`}
            >
              {trade.exitReason === "hard_exit" || trade.exitReason === "two_red_candles"
                ? "2 Red Candles Exit"
                : trade.exitReason === "trailing_stop"
                ? "Trailing Stop Hit"
                : trade.exitReason === "time_stop"
                ? "Time Stop"
                : trade.exitReason === "stop_loss"
                ? "Stop Loss Hit"
                : trade.exitReason === "target"
                ? "Target Reached"
                : trade.exitReason}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Trades() {
  const { data: trades, isLoading } = useQuery<PaperTrade[]>({
    queryKey: ["/api/trades"],
    refetchInterval: 3000,
  });

  const openTrades = trades?.filter((t) => t.status === "open") ?? [];
  const closedTrades = trades?.filter((t) => t.status === "closed") ?? [];

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const winRate = closedTrades.length > 0 ? ((wins.length / closedTrades.length) * 100).toFixed(0) : "—";
  const avgR = closedTrades.length > 0
    ? (closedTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / closedTrades.length).toFixed(2)
    : "—";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-trades-title">
          Trade Plans
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Paper trading with managed exits and trailing stops
        </p>
      </div>

      {closedTrades.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Total P&L</p>
              <p
                className={`text-sm font-semibold ${
                  totalPnl >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Win Rate</p>
              <p className="text-sm font-semibold">{winRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Avg R</p>
              <p className="text-sm font-semibold">{avgR}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Trades</p>
              <p className="text-sm font-semibold">{closedTrades.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open" className="gap-1" data-testid="tab-open-trades">
            <TrendingUp className="w-3.5 h-3.5" />
            Open ({openTrades.length})
          </TabsTrigger>
          <TabsTrigger value="closed" className="gap-1" data-testid="tab-closed-trades">
            <CheckCircle className="w-3.5 h-3.5" />
            Closed ({closedTrades.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
          {isLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-32 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : openTrades.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No open trades</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm">
                  Trades are created automatically when signals trigger.
                  50% partial at T1, then runner with ATR trailing stop.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {openTrades.map((trade) => (
                <TradeCard key={trade.id} trade={trade} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          {closedTrades.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Target className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No closed trades</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Trade history will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {closedTrades.map((trade) => (
                <TradeCard key={trade.id} trade={trade} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
