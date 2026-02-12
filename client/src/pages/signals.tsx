import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Radio,
  Activity,
  Target,
  CheckCircle,
  Clock,
  Eye,
  Zap,
  Search,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import type { Signal, Alert } from "@shared/schema";

const STATE_COLORS: Record<string, string> = {
  IDLE: "secondary",
  BREAKOUT: "default",
  RETEST: "outline",
  TRIGGERED: "default",
  MANAGED: "default",
  CLOSED: "secondary",
};

const STATE_LABELS: Record<string, string> = {
  IDLE: "Scanning",
  BREAKOUT: "SETUP forming",
  RETEST: "Retest in Progress",
  TRIGGERED: "TRIGGER hit",
  MANAGED: "Position Managed",
  CLOSED: "Closed",
};

function TierBadge({ tier, score }: { tier?: string | null; score?: number | null }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    A: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
    B: "text-amber-500 bg-amber-500/10 border-amber-500/30",
    C: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  };
  const color = colors[tier] ?? "text-muted-foreground bg-accent";
  return (
    <span data-testid={`tier-badge-${tier}`} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${color}`}>
      Tier {tier}{score != null ? ` (${score})` : ""}
    </span>
  );
}

interface ScannerItem {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  volume: number;
  avgDailyVolume: number;
  dollarVolume: number;
  rvol: number;
  atr14: number;
  signalState: string;
  resistanceLevel: number | null;
  passesFilters: boolean;
  trend1H: boolean;
  spreadPct: number;
  dailyATRpct: number;
  vwap: number;
  score: number;
  scoreTier: string;
  tier: string | null;
  volRatio: number;
  atrRatio: number;
  distanceToResistancePct: number | null;
  selectedTier: string | null;
  blockedReasons: string[];
  relStrengthVsSpy: number;
  spyAligned: boolean;
  inSession: boolean;
}

function LiveScannerCard({ item }: { item: ScannerItem }) {
  const isActive = item.signalState !== "IDLE";
  const readyCount = item.blockedReasons.length;
  const isPositive = item.changePct >= 0;

  return (
    <Card data-testid={`scanner-card-${item.ticker}`} className={isActive ? "border-emerald-500/40" : ""}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{item.ticker}</span>
            <Badge
              variant={isActive ? "default" : "secondary"}
              className="text-[9px] px-1.5 min-h-5"
            >
              {isActive ? STATE_LABELS[item.signalState] ?? item.signalState : "Scanning"}
            </Badge>
            {item.tier && <TierBadge tier={item.tier} />}
            {item.selectedTier && (
              <Badge variant="default" className="text-[8px] px-1 min-h-4">
                Active: Tier {item.selectedTier}
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">${item.price.toFixed(2)}</p>
            <p className={`text-[10px] font-medium ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
              {isPositive ? "+" : ""}{item.changePct.toFixed(2)}%
            </p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <div className="p-1.5 rounded-md bg-accent/50 text-center">
            <p className="text-[8px] text-muted-foreground uppercase">RVOL</p>
            <p className={`text-[11px] font-medium ${item.rvol >= 1.5 ? "text-emerald-500" : "text-muted-foreground"}`}>
              {item.rvol.toFixed(1)}x
            </p>
          </div>
          <div className="p-1.5 rounded-md bg-accent/50 text-center">
            <p className="text-[8px] text-muted-foreground uppercase">Vol Ratio</p>
            <p className={`text-[11px] font-medium ${item.volRatio >= 1.2 ? "text-emerald-500" : "text-muted-foreground"}`}>
              {item.volRatio.toFixed(1)}x
            </p>
          </div>
          <div className="p-1.5 rounded-md bg-accent/50 text-center">
            <p className="text-[8px] text-muted-foreground uppercase">ATR Ratio</p>
            <p className={`text-[11px] font-medium ${item.atrRatio >= 1.0 ? "text-emerald-500" : "text-muted-foreground"}`}>
              {item.atrRatio.toFixed(1)}x
            </p>
          </div>
          <div className="p-1.5 rounded-md bg-accent/50 text-center">
            <p className="text-[8px] text-muted-foreground uppercase">Resistance</p>
            <p className="text-[11px] font-medium">
              {item.resistanceLevel ? `$${item.resistanceLevel.toFixed(2)}` : "—"}
            </p>
          </div>
        </div>

        {item.resistanceLevel && item.distanceToResistancePct != null && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  item.distanceToResistancePct <= 0 ? "bg-emerald-500" :
                  item.distanceToResistancePct <= 0.5 ? "bg-amber-500" :
                  "bg-muted-foreground/30"
                }`}
                style={{ width: `${Math.max(5, Math.min(100, 100 - item.distanceToResistancePct * 20))}%` }}
              />
            </div>
            <span className={`text-[9px] font-medium ${
              item.distanceToResistancePct <= 0 ? "text-emerald-500" :
              item.distanceToResistancePct <= 0.5 ? "text-amber-500" :
              "text-muted-foreground"
            }`}>
              {item.distanceToResistancePct <= 0
                ? "Above resistance"
                : `${item.distanceToResistancePct.toFixed(2)}% below`
              }
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 flex-wrap">
          {[
            { label: "15m Bias", met: item.trend1H },
            { label: "SPY", met: item.spyAligned },
            { label: "Session", met: item.inSession },
            { label: "Universe", met: item.passesFilters },
            { label: `RS ${item.relStrengthVsSpy > 0 ? "+" : ""}${(item.relStrengthVsSpy * 100).toFixed(1)}%`, met: item.relStrengthVsSpy > 0 },
          ].map((c) => (
            <div
              key={c.label}
              className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full ${
                c.met
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-accent text-muted-foreground"
              }`}
            >
              {c.met ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
              {c.label}
            </div>
          ))}
        </div>

        {readyCount > 0 && (
          <div className="space-y-0.5">
            {item.blockedReasons.map((reason, i) => (
              <p key={i} className="text-[9px] text-muted-foreground/70 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                {reason}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  const riskReward = signal.riskReward ?? 0;
  const confirmations = [
    { label: "15m Bias", met: signal.trendConfirmed },
    { label: `RVOL ${signal.rvol?.toFixed(1) ?? "—"}x`, met: signal.volumeConfirmed },
    { label: "ATR Exp.", met: signal.atrExpansion },
    { label: "SPY", met: signal.spyAligned },
    { label: "Vol Gate", met: signal.volatilityGatePassed },
  ];

  return (
    <Card data-testid={`signal-detail-${signal.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold">{signal.ticker}</span>
            <Badge
              variant={STATE_COLORS[signal.state ?? "IDLE"] as any}
              className="text-[9px] px-1.5 min-h-5"
            >
              {STATE_LABELS[signal.state ?? "IDLE"]}
            </Badge>
            <TierBadge tier={signal.tier ?? signal.scoreTier} score={signal.score} />
            {signal.direction && (
              <Badge variant="outline" className="text-[9px] px-1.5 min-h-5">
                {signal.direction}
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">${signal.currentPrice?.toFixed(2) ?? "—"}</p>
            {signal.pnlPercent != null && (
              <p
                className={`text-[10px] font-medium ${
                  signal.pnlPercent >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {signal.pnlPercent >= 0 ? "+" : ""}
                {signal.pnlPercent.toFixed(2)}%
              </p>
            )}
          </div>
        </div>

        {(signal.marketRegime || signal.entryMode) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {signal.marketRegime && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded ${
                  signal.marketRegime === "aligned"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : signal.marketRegime === "choppy"
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-red-500/10 text-red-500"
                }`}
              >
                SPY: {signal.marketRegime}
              </span>
            )}
            {signal.entryMode && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
                {signal.entryMode} entry
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Resistance</p>
            <p className="text-xs font-medium mt-0.5">
              ${signal.resistanceLevel?.toFixed(2) ?? "—"}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Entry</p>
            <p className="text-xs font-medium mt-0.5">
              ${signal.entryPrice?.toFixed(2) ?? "—"}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">Stop</p>
            <p className="text-xs font-medium mt-0.5 text-red-500">
              ${signal.stopPrice?.toFixed(2) ?? "—"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {confirmations.map((c) => (
            <div
              key={c.label}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full ${
                c.met
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-accent text-muted-foreground"
              }`}
            >
              {c.met ? (
                <CheckCircle className="w-2.5 h-2.5" />
              ) : (
                <Clock className="w-2.5 h-2.5" />
              )}
              {c.label}
            </div>
          ))}
        </div>

        {signal.notes && (
          <p className="text-[10px] text-muted-foreground/70 italic">
            {signal.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Signals() {
  const { data: signals, isLoading: signalsLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 5000,
  });

  const { data: scannerData, isLoading: scannerLoading } = useQuery<ScannerItem[]>({
    queryKey: ["/api/scanner"],
    refetchInterval: 5000,
  });

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 5000,
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/alerts/mark-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const activeSignals = signals?.filter((s) => s.state !== "CLOSED" && s.state !== "IDLE") ?? [];
  const closedSignals = signals?.filter((s) => s.state === "CLOSED") ?? [];
  const unreadAlerts = alerts?.filter((a) => !a.isRead) ?? [];

  const scannerItems = scannerData ?? [];
  const nearBreakout = scannerItems.filter(s => s.distanceToResistancePct != null && s.distanceToResistancePct <= 1.0 && s.distanceToResistancePct > 0);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-signals-title">
            Signal Feed
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live scanning with tier-based breakout + retest strategy
          </p>
        </div>
        {unreadAlerts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markReadMutation.mutate()}
            data-testid="button-mark-all-read"
          >
            <Eye className="w-3.5 h-3.5 mr-1.5" />
            Mark All Read ({unreadAlerts.length})
          </Button>
        )}
      </div>

      <Tabs defaultValue="scanning">
        <TabsList>
          <TabsTrigger value="scanning" className="gap-1" data-testid="tab-live-scanner">
            <Search className="w-3.5 h-3.5" />
            Live Scanner ({scannerItems.length})
          </TabsTrigger>
          <TabsTrigger value="triggered" className="gap-1" data-testid="tab-triggered-signals">
            <Zap className="w-3.5 h-3.5" />
            Triggered ({activeSignals.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1" data-testid="tab-signal-history">
            <CheckCircle className="w-3.5 h-3.5" />
            History ({closedSignals.length})
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1" data-testid="tab-alerts">
            <Activity className="w-3.5 h-3.5" />
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scanning" className="mt-4 space-y-4">
          {nearBreakout.length > 0 && (
            <Card className="border-amber-500/30">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-1 p-3">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <p className="text-xs font-medium text-amber-500">
                  {nearBreakout.length} stock{nearBreakout.length !== 1 ? "s" : ""} approaching resistance
                </p>
              </CardHeader>
            </Card>
          )}

          {scannerLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-32 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : scannerItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Search className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Scanner initializing...</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Loading market data and calculating levels
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {scannerItems.map((item) => (
                <LiveScannerCard key={item.ticker} item={item} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="triggered" className="mt-4">
          {signalsLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-40 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : activeSignals.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Radio className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No triggered signals</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm">
                  When a stock breaks above resistance with qualifying volume, it will appear here
                  as a BREAKOUT or RETEST signal before potentially triggering a trade.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {activeSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {closedSignals.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Target className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No signal history yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Completed signals will show here with P&L data
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {closedSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          {!alerts || alerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Activity className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No alerts yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Alert history will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {alerts.map((alert) => (
                <Card
                  key={alert.id}
                  data-testid={`alert-log-${alert.id}`}
                >
                  <CardContent className="p-3 flex items-start gap-3">
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        alert.priority === "high"
                          ? "bg-red-500"
                          : alert.priority === "medium"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{alert.ticker}</span>
                        <Badge variant="outline" className="text-[9px] px-1.5 min-h-5">
                          {alert.type}
                        </Badge>
                        {!alert.isRead && (
                          <Badge variant="default" className="text-[8px] px-1 min-h-4">
                            NEW
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {alert.createdAt
                            ? new Date(alert.createdAt).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </div>
                      <p className="text-xs font-medium mt-0.5">{alert.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {alert.message}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
