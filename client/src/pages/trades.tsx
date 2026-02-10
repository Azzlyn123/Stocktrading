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
  DollarSign,
  Clock,
} from "lucide-react";
import type { PaperTrade } from "@shared/schema";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);
}

function TradeCard({ trade }: { trade: PaperTrade }) {
  const isWin = (trade.pnl ?? 0) > 0;
  const isOpen = trade.status === "open";

  return (
    <Card data-testid={`trade-card-${trade.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{trade.ticker}</span>
            <Badge
              variant={isOpen ? "default" : isWin ? "default" : "destructive"}
              className="text-[9px] px-1.5 min-h-5 gap-1"
            >
              {isOpen ? (
                <>
                  <Clock className="w-2.5 h-2.5" /> Open
                </>
              ) : isWin ? (
                <>
                  <TrendingUp className="w-2.5 h-2.5" /> Win
                </>
              ) : (
                <>
                  <TrendingDown className="w-2.5 h-2.5" /> Loss
                </>
              )}
            </Badge>
          </div>
          {trade.pnl != null && (
            <div className="text-right">
              <p
                className={`text-sm font-semibold ${
                  trade.pnl >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {trade.pnl >= 0 ? "+" : ""}
                {formatCurrency(trade.pnl)}
              </p>
              {trade.rMultiple != null && (
                <p className="text-[10px] text-muted-foreground">
                  {trade.rMultiple >= 0 ? "+" : ""}
                  {trade.rMultiple.toFixed(2)}R
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-md bg-accent/50">
            <p className="text-[9px] text-muted-foreground uppercase">Entry</p>
            <p className="text-xs font-medium mt-0.5">
              ${trade.entryPrice.toFixed(2)}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50">
            <p className="text-[9px] text-muted-foreground uppercase">
              {isOpen ? "Stop" : "Exit"}
            </p>
            <p className="text-xs font-medium mt-0.5">
              ${(isOpen ? trade.stopPrice : trade.exitPrice)?.toFixed(2) ?? "—"}
            </p>
          </div>
        </div>

        {(trade.target1 || trade.target2) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-md bg-accent/50">
              <p className="text-[9px] text-muted-foreground uppercase">T1 (1R)</p>
              <p className="text-xs font-medium mt-0.5 text-emerald-500">
                ${trade.target1?.toFixed(2) ?? "—"}
              </p>
            </div>
            <div className="p-2 rounded-md bg-accent/50">
              <p className="text-[9px] text-muted-foreground uppercase">T2 (2-3R)</p>
              <p className="text-xs font-medium mt-0.5 text-emerald-500">
                ${trade.target2?.toFixed(2) ?? "—"}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border flex-wrap gap-1">
          <span>{trade.shares} shares</span>
          <span>
            {trade.enteredAt
              ? new Date(trade.enteredAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : ""}
          </span>
          {trade.exitReason && <span className="capitalize">{trade.exitReason}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Trades() {
  const { data: trades, isLoading } = useQuery<PaperTrade[]>({
    queryKey: ["/api/trades"],
    refetchInterval: 5000,
  });

  const openTrades = trades?.filter((t) => t.status === "open") ?? [];
  const closedTrades = trades?.filter((t) => t.status === "closed") ?? [];

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const winCount = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const avgR =
    closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / closedTrades.length
      : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-trades-title">
          Trade Plans
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Paper trading positions and history
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Open</p>
            <p className="text-lg font-semibold mt-0.5">{openTrades.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Total P&L</p>
            <p
              className={`text-lg font-semibold mt-0.5 ${
                totalPnl >= 0 ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {totalPnl >= 0 ? "+" : ""}
              {formatCurrency(totalPnl)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Win Rate</p>
            <p className="text-lg font-semibold mt-0.5">
              {closedTrades.length > 0
                ? `${((winCount / closedTrades.length) * 100).toFixed(0)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Avg R</p>
            <p className="text-lg font-semibold mt-0.5">
              {closedTrades.length > 0 ? `${avgR.toFixed(2)}R` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open" data-testid="tab-open-trades">
            Open ({openTrades.length})
          </TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed-trades">
            History ({closedTrades.length})
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
                <p className="text-sm text-muted-foreground font-medium">No open positions</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Paper trades will appear here when signals are triggered
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
                <p className="text-sm text-muted-foreground font-medium">No trade history</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Completed paper trades will show here
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
