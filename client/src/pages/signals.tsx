import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Radio,
  TrendingUp,
  Volume2,
  Activity,
  Target,
  Shield,
  CheckCircle,
  Clock,
  ArrowUpRight,
  Eye,
  BarChart3,
  Zap,
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

function ScoreBreakdown({ breakdown }: { breakdown: any }) {
  if (!breakdown) return null;
  const items = [
    { label: "Vol Ratio", value: breakdown.volRatio?.toFixed(1) ?? "—" },
    { label: "ATR Ratio", value: breakdown.atrRatio?.toFixed(1) ?? "—" },
    { label: "Tier", value: breakdown.tier ?? "—" },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {items.map((item) => (
        <span key={item.label} className="text-[8px] px-1 py-0.5 rounded bg-accent text-muted-foreground">
          {item.label}: {item.value}
        </span>
      ))}
    </div>
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
            {signal.stopBasis && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
                stop: {signal.stopBasis}
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
            {signal.rejectionCount && (
              <p className="text-[8px] text-muted-foreground">{signal.rejectionCount} rej</p>
            )}
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

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">T1 (+1R partial 50%)</p>
            <p className="text-xs font-medium mt-0.5 text-emerald-500">
              ${signal.target1?.toFixed(2) ?? "—"}
            </p>
          </div>
          <div className="p-2 rounded-md bg-accent/50 text-center">
            <p className="text-[9px] text-muted-foreground uppercase">T2 (2.5R trail)</p>
            <p className="text-xs font-medium mt-0.5 text-emerald-500">
              ${signal.target2?.toFixed(2) ?? "—"}
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

        <ScoreBreakdown breakdown={signal.scoreBreakdown} />

        {signal.positionSize && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border flex-wrap gap-1">
            <span>
              Size: {signal.positionSize} shares (${((signal.positionSize ?? 0) * (signal.entryPrice ?? 0)).toFixed(0)})
            </span>
            {signal.dollarRisk && (
              <span>Risk: ${signal.dollarRisk.toFixed(0)}</span>
            )}
            <span>R:R {riskReward.toFixed(1)}</span>
          </div>
        )}

        {signal.candlePattern && (
          <p className="text-[10px] text-muted-foreground">
            Pattern: {signal.candlePattern}
          </p>
        )}

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
  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 3000,
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

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-signals-title">
            Signal Feed
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Momentum breakout + retest signals with scoring
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

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" className="gap-1" data-testid="tab-active-signals">
            <Radio className="w-3.5 h-3.5" />
            Active ({activeSignals.length})
          </TabsTrigger>
          <TabsTrigger value="closed" className="gap-1" data-testid="tab-closed-signals">
            <CheckCircle className="w-3.5 h-3.5" />
            Closed ({closedSignals.length})
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1" data-testid="tab-alerts">
            <Activity className="w-3.5 h-3.5" />
            Alert Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {isLoading ? (
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
                <p className="text-sm text-muted-foreground font-medium">No active signals</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm">
                  The scanner is monitoring for momentum breakout + retest setups.
                  Signals appear during US market hours (9:30 AM - 4:00 PM ET).
                  No new setups during lunch chop (11:30 AM - 1:30 PM ET).
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

        <TabsContent value="closed" className="mt-4">
          {closedSignals.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Target className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No closed signals yet</p>
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
