import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  History,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Brain,
  Loader2,
  Calendar,
  Zap,
  Square,
  ShieldCheck,
  Timer,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Target,
  Activity,
  Layers,
  Trash2,
  Download,
  Tag,
  Gauge,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SimulationRun } from "@shared/schema";

interface AutoRunStatus {
  active: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  durationMinutes: number;
  datesCompleted: string[];
  datesRemaining: string[];
  currentDate: string | null;
  totalTrades: number;
  totalLessons: number;
  totalPnl: number;
  skippedByLearning: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    pending: { variant: "outline", label: "Pending" },
    running: { variant: "secondary", label: "Running" },
    completed: { variant: "default", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
    cancelled: { variant: "outline", label: "Cancelled" },
  };
  const config = variants[status] ?? { variant: "outline" as const, label: status };
  return (
    <Badge variant={config.variant} className="text-[10px] px-1.5 min-h-5" data-testid={`badge-status-${status}`}>
      {status === "running" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      {status === "completed" && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === "failed" && <AlertCircle className="w-3 h-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

function ProgressBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.min((processed / total) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-accent rounded-full overflow-hidden" data-testid="progress-bar">
      <div
        className="h-full bg-primary transition-all duration-300 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BreakdownTable({ title, data }: { title: string; data: Record<string, { wins: number; losses: number; pnl: number }> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-medium mb-1">{title}</p>
      <div className="space-y-0.5">
        {entries.map(([key, val]) => (
          <div key={key} className="grid grid-cols-4 gap-2 text-[10px]">
            <span className="text-muted-foreground capitalize">{key}</span>
            <span className="text-emerald-500 text-center">{val.wins}W</span>
            <span className="text-red-500 text-center">{val.losses}L</span>
            <span className={`text-right font-medium ${val.pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {val.pnl >= 0 ? "+" : ""}{formatCurrency(val.pnl)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostSensitivityGrid({ grid }: { grid: any[] }) {
  const slippageValues = [0, 5, 10];
  const spreadValues = [1, 3, 5];

  const getCell = (slip: number, spread: number) => {
    return grid.find((g: any) => g.baseSlippageBps === slip && g.halfSpreadBps === spread);
  };

  return (
    <div className="mt-3 space-y-2" data-testid="cost-sensitivity-grid">
      <div className="flex items-center gap-1 mb-1.5">
        <BarChart3 className="w-3 h-3 text-muted-foreground" />
        <p className="text-[10px] text-muted-foreground font-medium">Cost Sensitivity Analysis</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-medium p-1.5">Slip \ Spread</th>
              {spreadValues.map((s) => (
                <th key={s} className="text-center text-muted-foreground font-medium p-1.5">
                  {s} bps
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slippageValues.map((slip) => (
              <tr key={slip}>
                <td className="text-muted-foreground font-medium p-1.5">{slip} bps</td>
                {spreadValues.map((spread) => {
                  const cell = getCell(slip, spread);
                  if (!cell) return <td key={spread} className="p-1.5 text-center">--</td>;
                  const edgeSurvives = cell.expectancyR > 0;
                  return (
                    <td
                      key={spread}
                      className={`p-1.5 text-center rounded-md ${
                        cell.isBaseline
                          ? "ring-1 ring-primary/50"
                          : ""
                      } ${
                        edgeSurvives
                          ? "bg-emerald-500/10 dark:bg-emerald-500/10"
                          : "bg-red-500/10 dark:bg-red-500/10"
                      }`}
                      data-testid={`cell-cost-${slip}-${spread}`}
                    >
                      <div className="space-y-0.5">
                        <div className={`font-semibold ${edgeSurvives ? "text-emerald-500" : "text-red-500"}`}>
                          {cell.expectancyR > 0 ? "+" : ""}{cell.expectancyR.toFixed(2)}R
                        </div>
                        <div className="text-muted-foreground">
                          {cell.trades}t | {cell.winRate.toFixed(0)}%
                        </div>
                        <div className={cell.netPnl >= 0 ? "text-emerald-500" : "text-red-500"}>
                          {cell.netPnl >= 0 ? "+" : ""}{formatCurrency(cell.netPnl)}
                        </div>
                        <div className="text-muted-foreground">
                          PF {cell.profitFactor === Infinity ? "\u221E" : cell.profitFactor.toFixed(1)}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground mt-1 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-emerald-500/20" /> Edge survives
        </span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-red-500/20" /> Edge breaks down
        </span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm ring-1 ring-primary/50" /> Baseline
        </span>
      </div>
    </div>
  );
}

function AutoRunPanel({ status, onCancel }: { status: AutoRunStatus | null; onCancel: () => void }) {
  if (!status) return null;

  const progressPct = status.durationMinutes > 0
    ? Math.min((status.elapsedSeconds / (status.durationMinutes * 60)) * 100, 100)
    : 0;

  return (
    <Card className="border-primary/30" data-testid="card-auto-run">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Auto-Run Training</span>
            {status.active ? (
              <Badge variant="secondary" className="text-[10px] px-1.5 min-h-5">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Active
              </Badge>
            ) : (
              <Badge variant="default" className="text-[10px] px-1.5 min-h-5">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Finished
              </Badge>
            )}
          </div>
          {status.active && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onCancel}
              data-testid="button-cancel-auto-run"
            >
              <Square className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="w-full h-2 bg-accent rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {status.active
              ? `${formatTime(status.remainingSeconds)} remaining`
              : `Ran for ${formatTime(status.elapsedSeconds)}`}
          </span>
          {status.currentDate && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Simulating {formatDate(status.currentDate)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          <div className="text-center" data-testid="autorun-dates-done">
            <p className="text-[10px] text-muted-foreground">Days Simulated</p>
            <p className="text-sm font-semibold">
              {status.datesCompleted.length}
              <span className="text-muted-foreground font-normal">
                /{status.datesCompleted.length + status.datesRemaining.length}
              </span>
            </p>
          </div>
          <div className="text-center" data-testid="autorun-trades">
            <p className="text-[10px] text-muted-foreground">Trades</p>
            <p className="text-sm font-semibold">{status.totalTrades}</p>
          </div>
          <div className="text-center" data-testid="autorun-lessons">
            <p className="text-[10px] text-muted-foreground">Lessons</p>
            <p className="text-sm font-semibold flex items-center justify-center gap-1">
              <Brain className="w-3 h-3" />
              {status.totalLessons}
            </p>
          </div>
          <div className="text-center" data-testid="autorun-pnl">
            <p className="text-[10px] text-muted-foreground">P&L</p>
            <p className={`text-sm font-semibold ${status.totalPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {status.totalPnl >= 0 ? "+" : ""}{formatCurrency(status.totalPnl)}
            </p>
          </div>
        </div>

        {status.skippedByLearning > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/50 rounded-md px-3 py-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>AI skipped {status.skippedByLearning} setups based on past lessons</span>
          </div>
        )}

        {!status.active && status.datesCompleted.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1">
            {status.datesCompleted.slice(-6).map((d) => (
              <Badge key={d} variant="outline" className="text-[9px] px-1 min-h-4">
                {new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </Badge>
            ))}
            {status.datesCompleted.length > 6 && (
              <span className="text-[10px] text-muted-foreground">
                +{status.datesCompleted.length - 6} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunCard({ run, onCancel }: { run: SimulationRun; onCancel: (id: string) => void }) {
  const isRunning = run.status === "running";
  const [expanded, setExpanded] = useState(false);
  const [costSensitivity, setCostSensitivity] = useState<any[] | null>(null);
  const [showCostSensitivity, setShowCostSensitivity] = useState(false);

  const costSensitivityMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/simulations/${run.id}/cost-sensitivity`);
      return res.json();
    },
    onSuccess: (data: any) => {
      setCostSensitivity(data.grid);
      setShowCostSensitivity(true);
    },
  });

  const benchmarks = run.benchmarks as any;
  const metrics = run.metrics as any;
  const breakdown = run.breakdown as any;
  const skippedSetups = run.skippedSetups as any;

  const hasBenchmarks = benchmarks && (benchmarks.buyAndHold != null || benchmarks.emaBaseline != null);
  const hasMetrics = metrics && (metrics.expectancy != null || metrics.profitFactor != null);
  const hasCosts = (run.grossPnl ?? 0) !== (run.totalPnl ?? 0);
  const hasBreakdown = breakdown && (breakdown.byRegime || breakdown.bySession || breakdown.byTier);
  const skippedCount = Array.isArray(skippedSetups) ? skippedSetups.length : 0;

  return (
    <Card data-testid={`card-simulation-${run.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid={`text-sim-date-${run.id}`}>
              {formatDate(run.simulationDate)}
            </span>
            <StatusBadge status={run.status ?? "pending"} />
          </div>
          {isRunning && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onCancel(run.id)}
              data-testid={`button-cancel-${run.id}`}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {isRunning && (
          <div className="mt-3 space-y-1">
            <ProgressBar processed={run.processedBars ?? 0} total={run.totalBars ?? 0} />
            <p className="text-[10px] text-muted-foreground">
              {run.processedBars ?? 0} / {run.totalBars ?? 0} bars processed
            </p>
          </div>
        )}

        {run.status === "completed" && (
          <>
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div className="text-center" data-testid={`stat-trades-${run.id}`}>
                <p className="text-xs text-muted-foreground">Trades</p>
                <p className="text-sm font-semibold">{run.tradesGenerated ?? 0}</p>
              </div>
              <div className="text-center" data-testid={`stat-lessons-${run.id}`}>
                <p className="text-xs text-muted-foreground">Lessons</p>
                <p className="text-sm font-semibold">{run.lessonsGenerated ?? 0}</p>
              </div>
              <div className="text-center" data-testid={`stat-pnl-${run.id}`}>
                <p className="text-xs text-muted-foreground">P&L</p>
                <p
                  className={`text-sm font-semibold ${
                    (run.totalPnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  {(run.totalPnl ?? 0) >= 0 ? "+" : ""}
                  {formatCurrency(run.totalPnl ?? 0)}
                </p>
              </div>
              <div className="text-center" data-testid={`stat-winrate-${run.id}`}>
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="text-sm font-semibold">
                  {run.winRate != null ? `${run.winRate.toFixed(0)}%` : "--"}
                </p>
              </div>
            </div>

            {hasBenchmarks && (
              <div className="mt-3" data-testid={`benchmarks-${run.id}`}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Target className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground font-medium">vs. Benchmarks</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Bot P&L</p>
                    <p className={`text-sm font-semibold ${(run.totalPnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {(run.totalPnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(run.totalPnl ?? 0)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Buy & Hold</p>
                    <p className={`text-sm font-semibold ${(benchmarks?.buyAndHold ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {(benchmarks?.buyAndHold ?? 0) >= 0 ? "+" : ""}{formatCurrency(benchmarks?.buyAndHold ?? 0)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">EMA Baseline</p>
                    <p className={`text-sm font-semibold ${(benchmarks?.emaBaseline ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {(benchmarks?.emaBaseline ?? 0) >= 0 ? "+" : ""}{formatCurrency(benchmarks?.emaBaseline ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasMetrics && (
              <div className="mt-3" data-testid={`metrics-${run.id}`}>
                <div className="flex items-center gap-1 mb-1.5">
                  <Activity className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground font-medium">Advanced Metrics</p>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Expectancy</p>
                    <p className="text-sm font-semibold">{(metrics?.expectancy ?? 0).toFixed(2)}R</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Profit Factor</p>
                    <p className="text-sm font-semibold">{(metrics?.profitFactor ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Max Drawdown</p>
                    <p className="text-sm font-semibold text-red-500">{formatCurrency(metrics?.maxDrawdown ?? 0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Sharpe</p>
                    <p className="text-sm font-semibold">{(metrics?.sharpe ?? 0).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}

            {hasCosts && (
              <div className="mt-3" data-testid={`costs-${run.id}`}>
                <div className="flex items-center gap-1 mb-1.5">
                  <DollarSign className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground font-medium">Cost Breakdown</p>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Gross P&L</p>
                    <p className={`text-sm font-semibold ${(run.grossPnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {(run.grossPnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(run.grossPnl ?? 0)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Slippage</p>
                    <p className="text-sm font-semibold text-red-500">-{formatCurrency(run.totalSlippageCost ?? 0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Commission</p>
                    <p className="text-sm font-semibold text-red-500">-{formatCurrency(run.totalCommission ?? 0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Net P&L</p>
                    <p className={`text-sm font-semibold ${(run.totalPnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {(run.totalPnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(run.totalPnl ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasBreakdown && (
              <div className="mt-3" data-testid={`breakdown-${run.id}`}>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium hover-elevate rounded-md px-1 py-0.5"
                  data-testid={`button-toggle-breakdown-${run.id}`}
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Performance Breakdown
                </button>
                {expanded && (
                  <div className="mt-2 space-y-3">
                    {breakdown.byRegime && Object.keys(breakdown.byRegime).length > 0 && (
                      <BreakdownTable title="By Regime" data={breakdown.byRegime} />
                    )}
                    {breakdown.bySession && Object.keys(breakdown.bySession).length > 0 && (
                      <BreakdownTable title="By Session" data={breakdown.bySession} />
                    )}
                    {breakdown.byTier && Object.keys(breakdown.byTier).length > 0 && (
                      <BreakdownTable title="By Tier" data={breakdown.byTier} />
                    )}
                  </div>
                )}
              </div>
            )}

            {skippedCount > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/50 rounded-md px-3 py-1.5 mt-3" data-testid={`skipped-${run.id}`}>
                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>AI skipped {skippedCount} setups</span>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (costSensitivity) {
                    setShowCostSensitivity(!showCostSensitivity);
                  } else {
                    costSensitivityMutation.mutate();
                  }
                }}
                disabled={costSensitivityMutation.isPending}
                data-testid={`button-cost-sensitivity-${run.id}`}
              >
                {costSensitivityMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                )}
                {costSensitivityMutation.isPending
                  ? "Running..."
                  : showCostSensitivity
                  ? "Hide Cost Sensitivity"
                  : "Run Cost Sensitivity"}
              </Button>
            </div>

            {showCostSensitivity && costSensitivity && (
              <CostSensitivityGrid grid={costSensitivity} />
            )}
          </>
        )}

        {run.status === "failed" && run.errorMessage && (
          <p className="text-[10px] text-red-500 mt-2" data-testid={`text-error-${run.id}`}>
            {run.errorMessage}
          </p>
        )}

        {(run.tickers ?? []).length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {(run.tickers ?? []).slice(0, 8).map((t) => (
              <Badge key={t} variant="outline" className="text-[9px] px-1 min-h-4">
                {t}
              </Badge>
            ))}
            {(run.tickers ?? []).length > 8 && (
              <span className="text-[10px] text-muted-foreground">
                +{(run.tickers ?? []).length - 8} more
              </span>
            )}
          </div>
        )}

        {run.startedAt && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Started {new Date(run.startedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface WalkForwardStatus {
  active: boolean;
  progress: {
    currentWindow: number;
    totalWindows: number;
    currentDate: string;
    phase: "train" | "test";
  };
}

type BreakdownBucketUI = { wins: number; losses: number; pnl: number };
type BreakdownBucketWithWR = BreakdownBucketUI & { winRate: number };

interface WalkForwardWindowData {
  windowIndex: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  testMetrics: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdown: number;
    netPnl: number;
    grossPnl: number;
    totalCosts: number;
    byRegime: Record<string, BreakdownBucketUI>;
    bySession: Record<string, BreakdownBucketUI>;
    byTier: Record<string, BreakdownBucketUI>;
  };
  trainSummary: {
    totalTrades: number;
    totalPnl: number;
  };
}

interface WalkForwardResultData {
  windows: WalkForwardWindowData[];
  aggregate: {
    totalTestTrades: number;
    totalTestWins: number;
    totalTestLosses: number;
    overallWinRate: number;
    overallExpectancyR: number;
    overallProfitFactor: number;
    maxDrawdown: number;
    totalNetPnl: number;
    equityCurve: Array<{ windowIndex: number; cumulativePnl: number }>;
    regimeBreakdown: Record<string, BreakdownBucketWithWR>;
    sessionBreakdown: Record<string, BreakdownBucketWithWR>;
    tierBreakdown: Record<string, BreakdownBucketWithWR>;
  };
  config: {
    trainDays: number;
    testDays: number;
    totalWindows: number;
    startDate: string;
    endDate: string;
  };
  error?: string;
}

function WalkForwardPanel() {
  const [trainDays, setTrainDays] = useState(60);
  const [testDays, setTestDays] = useState(10);
  const [totalWindows, setTotalWindows] = useState(3);
  const [showResults, setShowResults] = useState(false);
  const [expandedWindow, setExpandedWindow] = useState<number | null>(null);

  const { toast } = useToast();

  const { data: wfStatus } = useQuery<WalkForwardStatus>({
    queryKey: ["/api/walk-forward/status"],
    refetchInterval: 2000,
  });

  const { data: wfResults } = useQuery<WalkForwardResultData | null>({
    queryKey: ["/api/walk-forward/results"],
    refetchInterval: wfStatus?.active ? 5000 : false,
  });

  const startWF = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/walk-forward", { trainDays, testDays, totalWindows });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/walk-forward/status"] });
      toast({ title: "Walk-Forward Started", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start walk-forward", description: err.message, variant: "destructive" });
    },
  });

  const cancelWF = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/walk-forward/cancel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/walk-forward/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/walk-forward/results"] });
      toast({ title: "Walk-forward cancelled" });
    },
  });

  const isActive = wfStatus?.active ?? false;
  const hasResults = wfResults && !wfResults.error && wfResults.windows?.length > 0;
  const hasError = wfResults && "error" in wfResults && wfResults.error;

  const progressPct = isActive && wfStatus?.progress
    ? ((wfStatus.progress.currentWindow - 1) / wfStatus.progress.totalWindows) * 100
    : 0;

  return (
    <Card className="border-primary/20" data-testid="card-walk-forward">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Walk-Forward Evaluation</h3>
        </div>
        <div className="flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Out-of-sample testing</span>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Splits historical data into rolling train/test windows to measure strategy robustness on unseen data. Each window trains on past days, then tests on the next period.
        </p>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="wf-train-days">Train Days</label>
            <Input
              id="wf-train-days"
              type="number"
              min={5}
              max={500}
              value={trainDays}
              onChange={(e) => setTrainDays(Number(e.target.value))}
              className="w-20"
              disabled={isActive}
              data-testid="input-wf-train-days"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="wf-test-days">Test Days</label>
            <Input
              id="wf-test-days"
              type="number"
              min={3}
              max={100}
              value={testDays}
              onChange={(e) => setTestDays(Number(e.target.value))}
              className="w-20"
              disabled={isActive}
              data-testid="input-wf-test-days"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="wf-windows">Windows</label>
            <Input
              id="wf-windows"
              type="number"
              min={1}
              max={50}
              value={totalWindows}
              onChange={(e) => setTotalWindows(Number(e.target.value))}
              className="w-20"
              disabled={isActive}
              data-testid="input-wf-windows"
            />
          </div>
          {isActive ? (
            <Button
              variant="destructive"
              onClick={() => cancelWF.mutate()}
              disabled={cancelWF.isPending}
              data-testid="button-cancel-wf"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={() => startWF.mutate()}
              disabled={startWF.isPending}
              data-testid="button-start-wf"
            >
              {startWF.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Layers className="w-4 h-4 mr-2" />
              )}
              Run Evaluation
            </Button>
          )}
        </div>

        {isActive && wfStatus?.progress && (
          <div className="space-y-2">
            <div className="w-full h-2 bg-accent rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Window {wfStatus.progress.currentWindow}/{wfStatus.progress.totalWindows}
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 min-h-5">
                {wfStatus.progress.phase === "train" ? "Training" : "Testing"}
              </Badge>
              {wfStatus.progress.currentDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(wfStatus.progress.currentDate)}
                </span>
              )}
            </div>
          </div>
        )}

        {hasError && (
          <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{wfResults!.error}</span>
          </div>
        )}

        {hasResults && (
          <>
            <button
              onClick={() => setShowResults(!showResults)}
              className="flex items-center gap-1 text-xs text-muted-foreground font-medium hover-elevate rounded-md px-1 py-0.5"
              data-testid="button-toggle-wf-results"
            >
              {showResults ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showResults ? "Hide Results" : "Show Results"}
              <Badge variant="default" className="text-[10px] px-1.5 min-h-5 ml-1">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {wfResults!.windows.length} windows
              </Badge>
            </button>

            {showResults && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center" data-testid="wf-total-trades">
                    <p className="text-[10px] text-muted-foreground">Test Trades</p>
                    <p className="text-sm font-semibold">{wfResults!.aggregate.totalTestTrades}</p>
                  </div>
                  <div className="text-center" data-testid="wf-win-rate">
                    <p className="text-[10px] text-muted-foreground">Win Rate</p>
                    <p className="text-sm font-semibold">{wfResults!.aggregate.overallWinRate}%</p>
                  </div>
                  <div className="text-center" data-testid="wf-expectancy">
                    <p className="text-[10px] text-muted-foreground">Expectancy</p>
                    <p className={`text-sm font-semibold ${wfResults!.aggregate.overallExpectancyR >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {wfResults!.aggregate.overallExpectancyR > 0 ? "+" : ""}{wfResults!.aggregate.overallExpectancyR}R
                    </p>
                  </div>
                  <div className="text-center" data-testid="wf-net-pnl">
                    <p className="text-[10px] text-muted-foreground">Net P&L</p>
                    <p className={`text-sm font-semibold ${wfResults!.aggregate.totalNetPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {wfResults!.aggregate.totalNetPnl >= 0 ? "+" : ""}{formatCurrency(wfResults!.aggregate.totalNetPnl)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Profit Factor</p>
                    <p className="text-sm font-semibold">
                      {wfResults!.aggregate.overallProfitFactor === 999 ? "N/A" : wfResults!.aggregate.overallProfitFactor.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Max Drawdown</p>
                    <p className="text-sm font-semibold text-red-500">{wfResults!.aggregate.maxDrawdown.toFixed(2)}R</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Date Range</p>
                    <p className="text-[10px] font-medium">
                      {wfResults!.config.startDate} to {wfResults!.config.endDate}
                    </p>
                  </div>
                </div>

                {wfResults!.aggregate.equityCurve.length > 0 && (
                  <div data-testid="wf-equity-curve">
                    <p className="text-[10px] text-muted-foreground font-medium mb-1.5">Cumulative P&L by Window</p>
                    <div className="flex items-end gap-1 h-16">
                      {wfResults!.aggregate.equityCurve.map((point, idx) => {
                        const maxAbs = Math.max(
                          ...wfResults!.aggregate.equityCurve.map(p => Math.abs(p.cumulativePnl)),
                          1
                        );
                        const height = Math.abs(point.cumulativePnl) / maxAbs * 100;
                        const isPositive = point.cumulativePnl >= 0;
                        return (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col justify-end items-center"
                          >
                            <div
                              className={`w-full rounded-sm ${isPositive ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                              style={{ height: `${Math.max(height, 4)}%` }}
                            />
                            <span className="text-[8px] text-muted-foreground mt-0.5">W{idx + 1}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(wfResults!.aggregate.regimeBreakdown && Object.keys(wfResults!.aggregate.regimeBreakdown).length > 0) && (
                  <div data-testid="wf-aggregate-breakdowns">
                    <p className="text-[10px] text-muted-foreground font-medium mb-2">Aggregate Breakdowns</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { label: "By Regime", data: wfResults!.aggregate.regimeBreakdown },
                        { label: "By Session", data: wfResults!.aggregate.sessionBreakdown },
                        { label: "By Tier", data: wfResults!.aggregate.tierBreakdown },
                      ].filter(s => Object.keys(s.data).length > 0).map(section => (
                        <div key={section.label}>
                          <p className="text-[9px] text-muted-foreground mb-1">{section.label}</p>
                          <div className="space-y-1">
                            {Object.entries(section.data).map(([key, val]) => {
                              const total = val.wins + val.losses;
                              return (
                                <div key={key} className="flex items-center justify-between text-[10px] gap-1">
                                  <span className="font-medium capitalize">{key}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">{val.winRate}%</span>
                                    <span className={val.pnl >= 0 ? "text-emerald-500" : "text-red-500"}>
                                      {val.pnl >= 0 ? "+" : ""}{formatCurrency(val.pnl)}
                                    </span>
                                    <span className="text-muted-foreground">({total})</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[10px] text-muted-foreground font-medium mb-2">Per-Window Breakdown</p>
                  <div className="space-y-2">
                    {wfResults!.windows.map((win) => (
                      <Card key={win.windowIndex} data-testid={`card-wf-window-${win.windowIndex}`}>
                        <CardContent className="p-3">
                          <button
                            onClick={() => setExpandedWindow(expandedWindow === win.windowIndex ? null : win.windowIndex)}
                            className="w-full flex items-center justify-between gap-2"
                            data-testid={`button-toggle-window-${win.windowIndex}`}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium">Window {win.windowIndex + 1}</span>
                              <Badge variant="outline" className="text-[9px] px-1 min-h-4">
                                Test: {win.testStart} to {win.testEnd}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-semibold ${win.testMetrics.netPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                {win.testMetrics.netPnl >= 0 ? "+" : ""}{formatCurrency(win.testMetrics.netPnl)}
                              </span>
                              {expandedWindow === win.windowIndex ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </div>
                          </button>

                          {expandedWindow === win.windowIndex && (
                            <div className="mt-3 space-y-2">
                              <div className="grid grid-cols-2 gap-2 text-[10px]">
                                <div>
                                  <span className="text-muted-foreground">Train:</span>{" "}
                                  <span className="font-medium">{win.trainStart} to {win.trainEnd}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Train Trades:</span>{" "}
                                  <span className="font-medium">{win.trainSummary.totalTrades}</span>
                                  <span className={`ml-1 ${win.trainSummary.totalPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    ({win.trainSummary.totalPnl >= 0 ? "+" : ""}{formatCurrency(win.trainSummary.totalPnl)})
                                  </span>
                                </div>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Trades</p>
                                  <p className="text-xs font-semibold">{win.testMetrics.trades}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Win Rate</p>
                                  <p className="text-xs font-semibold">{win.testMetrics.winRate}%</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Expectancy</p>
                                  <p className={`text-xs font-semibold ${win.testMetrics.expectancyR >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {win.testMetrics.expectancyR > 0 ? "+" : ""}{win.testMetrics.expectancyR}R
                                  </p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">PF</p>
                                  <p className="text-xs font-semibold">
                                    {win.testMetrics.profitFactor === 999 ? "N/A" : win.testMetrics.profitFactor.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Gross P&L</p>
                                  <p className={`text-xs font-semibold ${win.testMetrics.grossPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {win.testMetrics.grossPnl >= 0 ? "+" : ""}{formatCurrency(win.testMetrics.grossPnl)}
                                  </p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Costs</p>
                                  <p className="text-xs font-semibold text-red-500">-{formatCurrency(win.testMetrics.totalCosts)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[9px] text-muted-foreground">Max DD</p>
                                  <p className="text-xs font-semibold text-red-500">{win.testMetrics.maxDrawdown.toFixed(2)}R</p>
                                </div>
                              </div>
                              {(win.testMetrics.byRegime && Object.keys(win.testMetrics.byRegime).length > 0) && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-border/50">
                                  {[
                                    { label: "Regime", data: win.testMetrics.byRegime },
                                    { label: "Session", data: win.testMetrics.bySession },
                                    { label: "Tier", data: win.testMetrics.byTier },
                                  ].filter(s => Object.keys(s.data).length > 0).map(section => (
                                    <div key={section.label}>
                                      <p className="text-[9px] text-muted-foreground mb-0.5">{section.label}</p>
                                      {Object.entries(section.data).map(([key, val]) => {
                                        const total = val.wins + val.losses;
                                        const wr = total > 0 ? ((val.wins / total) * 100).toFixed(0) : "0";
                                        return (
                                          <div key={key} className="flex items-center justify-between text-[9px] gap-1">
                                            <span className="capitalize">{key}</span>
                                            <span className="text-muted-foreground">{wr}% ({total})</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

interface CoreMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  maxDrawdownR: number;
  tradesPerDay: number;
  distinctDays: number;
}

function getConfidenceTier(tradeCount: number): { label: string; color: string; bgClass: string; textClass: string } {
  if (tradeCount >= 100) return { label: "Full", color: "emerald", bgClass: "bg-emerald-500/15 border-emerald-500/30", textClass: "text-emerald-500" };
  if (tradeCount >= 50) return { label: "Minimum", color: "emerald", bgClass: "bg-emerald-500/10 border-emerald-500/20", textClass: "text-emerald-400" };
  if (tradeCount >= 20) return { label: "Building", color: "amber", bgClass: "bg-amber-500/10 border-amber-500/20", textClass: "text-amber-500" };
  return { label: "Low", color: "red", bgClass: "bg-red-500/10 border-red-500/20", textClass: "text-red-500" };
}

function ConfidenceBadge({ tradeCount }: { tradeCount: number }) {
  const tier = getConfidenceTier(tradeCount);
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 min-h-5 ${tier.bgClass} ${tier.textClass}`} data-testid="badge-confidence">
      <ShieldCheck className="w-3 h-3 mr-1" />
      {tier.label}
    </Badge>
  );
}

function CoreMetricsPanel({ strategyVersion }: { strategyVersion: string }) {
  const { data: metrics } = useQuery<CoreMetrics>({
    queryKey: ["/api/simulations/core-metrics", strategyVersion],
    queryFn: async () => {
      const res = await fetch(`/api/simulations/core-metrics?version=${encodeURIComponent(strategyVersion)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    refetchInterval: 10000,
  });

  if (!metrics || metrics.totalTrades === 0) {
    return (
      <Card className="border-primary/20" data-testid="card-core-metrics">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium">Strategy Scorecard</h3>
            <div className="flex items-center gap-1.5 ml-auto">
              <ConfidenceBadge tradeCount={0} />
              <Badge variant="outline" className="text-[10px] px-1.5 min-h-5">
                <Tag className="w-3 h-3 mr-1" />
                {strategyVersion}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            No trades recorded for this strategy version yet. Run simulations to start tracking metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tier = getConfidenceTier(metrics.totalTrades);
  const minTarget = 50;
  const fullTarget = 100;
  const samplePct = Math.min((metrics.totalTrades / minTarget) * 100, 100);
  const fullPct = Math.min((metrics.totalTrades / fullTarget) * 100, 100);
  const expectancyOk = metrics.expectancyR >= 0.15;
  const winRateOk = metrics.winRate >= 40;

  return (
    <Card className="border-primary/20" data-testid="card-core-metrics">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Strategy Scorecard</h3>
          <div className="flex items-center gap-1.5 ml-auto">
            <ConfidenceBadge tradeCount={metrics.totalTrades} />
            <Badge variant="outline" className="text-[10px] px-1.5 min-h-5">
              <Tag className="w-3 h-3 mr-1" />
              {strategyVersion}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="text-center" data-testid="metric-win-rate">
            <p className="text-[10px] text-muted-foreground">Win Rate</p>
            <p className={`text-sm font-semibold ${winRateOk ? "text-emerald-500" : "text-red-500"}`}>
              {metrics.winRate.toFixed(1)}%
            </p>
          </div>
          <div className="text-center" data-testid="metric-avg-win">
            <p className="text-[10px] text-muted-foreground">Avg Win</p>
            <p className="text-sm font-semibold text-emerald-500">
              +{metrics.avgWinR.toFixed(2)}R
            </p>
          </div>
          <div className="text-center" data-testid="metric-avg-loss">
            <p className="text-[10px] text-muted-foreground">Avg Loss</p>
            <p className="text-sm font-semibold text-red-500">
              {metrics.avgLossR.toFixed(2)}R
            </p>
          </div>
          <div className="text-center" data-testid="metric-expectancy">
            <p className="text-[10px] text-muted-foreground">Expectancy</p>
            <p className={`text-sm font-semibold ${expectancyOk ? "text-emerald-500" : "text-red-500"}`}>
              {metrics.expectancyR > 0 ? "+" : ""}{metrics.expectancyR.toFixed(3)}R
            </p>
          </div>
          <div className="text-center" data-testid="metric-max-dd">
            <p className="text-[10px] text-muted-foreground">Max DD</p>
            <p className="text-sm font-semibold text-red-500">
              -{metrics.maxDrawdownR.toFixed(2)}R
            </p>
          </div>
          <div className="text-center" data-testid="metric-trades-per-day">
            <p className="text-[10px] text-muted-foreground">Trades/Day</p>
            <p className="text-sm font-semibold">
              {metrics.tradesPerDay.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">
              Sample: {metrics.totalTrades} trades
              {metrics.totalTrades < 20 && ` — need ${20 - metrics.totalTrades} more for "Building"`}
              {metrics.totalTrades >= 20 && metrics.totalTrades < 50 && ` — need ${50 - metrics.totalTrades} more for "Minimum"`}
              {metrics.totalTrades >= 50 && metrics.totalTrades < 100 && ` — need ${100 - metrics.totalTrades} more for "Full"`}
            </span>
            <span className={`font-medium ${tier.textClass}`}>
              {tier.label} confidence
            </span>
          </div>
          <div className="w-full h-1.5 bg-accent rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                metrics.totalTrades >= 50 ? "bg-emerald-500" : metrics.totalTrades >= 20 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${fullPct}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className={metrics.totalTrades >= 20 ? "text-amber-500" : ""}>20: Building</span>
            <span className={metrics.totalTrades >= 50 ? "text-emerald-400" : ""}>50: Minimum</span>
            <span className={metrics.totalTrades >= 100 ? "text-emerald-500 font-medium" : ""}>100: Full</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{metrics.distinctDays} days simulated</span>
          <span>|</span>
          <span>{metrics.wins}W / {metrics.losses}L</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ResetSimulationButton({ currentVersion, onVersionChange }: { currentVersion: string; onVersionChange: (v: string) => void }) {
  const [archiveLabel, setArchiveLabel] = useState(currentVersion);
  const [newVersion, setNewVersion] = useState("");
  const [step, setStep] = useState<"confirm" | "archiving" | "archived">("confirm");

  const { toast } = useToast();

  const archiveMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await apiRequest("POST", "/api/simulations/archive", { label });
      return res.json();
    },
    onSuccess: (data: any) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `breakoutiq-archive-${archiveLabel}-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStep("archived");
      toast({
        title: "Archive downloaded",
        description: `Exported ${data.counts.simulationRuns} runs, ${data.counts.paperTrades} trades, ${data.counts.tradeLessons} lessons.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Archive failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (newVersion) {
        await apiRequest("PATCH", "/api/settings", { currentStrategyVersion: newVersion });
      }
      const res = await apiRequest("POST", "/api/simulations/reset");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/summaries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lessons"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lessons/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/walk-forward/results"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulations/core-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      if (newVersion) onVersionChange(newVersion);
      const d = data.deleted;
      toast({
        title: "Reset Complete",
        description: `Cleared ${d.simulationRuns} runs, ${d.trades} trades. ${newVersion ? `Now tracking as ${newVersion}.` : ""}`,
      });
      setStep("confirm");
      setNewVersion("");
    },
    onError: (err: Error) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog onOpenChange={(open) => { if (!open) { setStep("confirm"); setNewVersion(""); } }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-reset-simulation">
          <Trash2 className="w-4 h-4 mr-2" />
          Archive & Reset
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {step === "confirm" && "Archive & Reset Simulation Data"}
            {step === "archiving" && "Downloading Archive..."}
            {step === "archived" && "Archive Complete — Ready to Reset"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {step === "confirm" && "First, download an archive of all existing data. Then reset and optionally start a new strategy version."}
            {step === "archiving" && "Your archive is being prepared for download."}
            {step === "archived" && "Your data has been archived. Set a new version label and confirm the reset."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step === "confirm" && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Archive label</label>
              <Input
                value={archiveLabel}
                onChange={(e) => setArchiveLabel(e.target.value)}
                placeholder="e.g. v1-old-rules"
                data-testid="input-archive-label"
              />
            </div>
          </div>
        )}

        {step === "archived" && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-xs text-emerald-500 bg-emerald-500/10 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Archive downloaded successfully</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">New strategy version label</label>
              <Input
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder="e.g. v2"
                data-testid="input-new-version"
              />
              <p className="text-[10px] text-muted-foreground">Leave empty to keep the current version ({currentVersion})</p>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
          {step === "confirm" && (
            <Button
              onClick={() => {
                setStep("archiving");
                archiveMutation.mutate(archiveLabel);
              }}
              disabled={archiveMutation.isPending}
              data-testid="button-download-archive"
            >
              {archiveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download Archive
            </Button>
          )}
          {step === "archived" && (
            <AlertDialogAction
              onClick={() => resetMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              disabled={resetMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Reset & Start {newVersion || currentVersion}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function Backtester() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return d.toISOString().split("T")[0];
  });

  const [autoRunMinutes, setAutoRunMinutes] = useState(5);
  const [strategyVersion, setStrategyVersion] = useState("v1");

  const { toast } = useToast();

  const { data: userData } = useQuery<any>({
    queryKey: ["/api/user"],
  });

  const currentVersion = userData?.currentStrategyVersion ?? strategyVersion;

  const { data: runs, isLoading } = useQuery<SimulationRun[]>({
    queryKey: ["/api/simulations"],
    refetchInterval: 3000,
  });

  const { data: autoRunStatus } = useQuery<AutoRunStatus | null>({
    queryKey: ["/api/simulations/auto-run/status"],
    refetchInterval: 2000,
  });

  const startSimulation = useMutation({
    mutationFn: async (date: string) => {
      const res = await apiRequest("POST", "/api/simulations", {
        simulationDate: date,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
      toast({ title: "Simulation started", description: `Replaying ${formatDate(selectedDate)}` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start simulation", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/simulations/${id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
      toast({ title: "Simulation cancelled" });
    },
  });

  const startAutoRun = useMutation({
    mutationFn: async (opts: { minutes: number; exactDays?: number }) => {
      const res = await apiRequest("POST", "/api/simulations/auto-run", {
        durationMinutes: opts.minutes,
        exactDays: opts.exactDays,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulations/auto-run/status"] });
      toast({ title: "Auto-run started", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start auto-run", description: err.message, variant: "destructive" });
    },
  });

  const cancelAutoRunMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/simulations/auto-run/cancel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulations/auto-run/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
      toast({ title: "Auto-run cancelled" });
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  const sortedRuns = [...(runs ?? [])].sort(
    (a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime()
  );

  const hasRunning = sortedRuns.some((r) => r.status === "running");
  const isAutoRunActive = autoRunStatus?.active ?? false;
  const completedRuns = sortedRuns.filter((r) => r.status === "completed");
  const totalLessons = completedRuns.reduce((s, r) => s + (r.lessonsGenerated ?? 0), 0);
  const totalTrades = completedRuns.reduce((s, r) => s + (r.tradesGenerated ?? 0), 0);
  const totalPnl = completedRuns.reduce((s, r) => s + (r.totalPnl ?? 0), 0);
  const totalCosts = completedRuns.reduce((s, r) => s + (r.totalCommission ?? 0) + (r.totalSlippageCost ?? 0), 0);
  const aggBuyAndHold = completedRuns.reduce((s, r) => {
    const b = r.benchmarks as any;
    return s + (b?.buyAndHold ?? 0);
  }, 0);
  const aggEma = completedRuns.reduce((s, r) => {
    const b = r.benchmarks as any;
    return s + (b?.emaBaseline ?? 0);
  }, 0);
  const hasBenchmarkAgg = completedRuns.some((r) => {
    const b = r.benchmarks as any;
    return b && (b.buyAndHold != null || b.emaBaseline != null);
  });

  return (
    <div
      className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full"
      data-testid="page-backtester"
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-backtester-title">
            Historical Backtester
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Replay past trading days to train the AI learning system
          </p>
        </div>
        <ResetSimulationButton
          currentVersion={currentVersion}
          onVersionChange={(v) => setStrategyVersion(v)}
        />
      </div>

      <CoreMetricsPanel strategyVersion={currentVersion} />

      <Card data-testid="card-auto-run-controls" className="border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium">Auto-Run Training</h3>
          </div>
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">AI adapts from lessons</span>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-[10px] text-muted-foreground mb-3">
            Automatically simulates multiple past trading days. The AI learns from each day and adjusts entry decisions for the next, skipping setups that match past failure patterns.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="auto-run-duration">
                Duration (minutes)
              </label>
              <Input
                id="auto-run-duration"
                type="number"
                min={1}
                max={15}
                value={autoRunMinutes}
                onChange={(e) => setAutoRunMinutes(Math.min(15, Math.max(1, Number(e.target.value) || 5)))}
                className="w-24"
                disabled={isAutoRunActive}
                data-testid="input-auto-run-duration"
              />
            </div>
            {isAutoRunActive ? (
              <Button
                variant="destructive"
                onClick={() => cancelAutoRunMutation.mutate()}
                disabled={cancelAutoRunMutation.isPending}
                data-testid="button-stop-auto-run"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Training
              </Button>
            ) : (
              <>
                <Button
                  onClick={() => startAutoRun.mutate({ minutes: autoRunMinutes })}
                  disabled={startAutoRun.isPending || hasRunning}
                  data-testid="button-start-auto-run"
                >
                  {startAutoRun.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Start {autoRunMinutes}-min Training
                </Button>
                <Button
                  variant="outline"
                  onClick={() => startAutoRun.mutate({ minutes: 15, exactDays: 5 })}
                  disabled={startAutoRun.isPending || hasRunning}
                  data-testid="button-run-last-5-days"
                >
                  {startAutoRun.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Run Last 5 Days
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {autoRunStatus && (
        <AutoRunPanel
          status={autoRunStatus}
          onCancel={() => cancelAutoRunMutation.mutate()}
        />
      )}

      <WalkForwardPanel />

      <Card data-testid="card-new-simulation">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Single Day Simulation</h3>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="sim-date">
                Trading Date
              </label>
              <Input
                id="sim-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split("T")[0]}
                data-testid="input-simulation-date"
              />
            </div>
            <Button
              onClick={() => startSimulation.mutate(selectedDate)}
              disabled={startSimulation.isPending || hasRunning || isAutoRunActive}
              data-testid="button-start-simulation"
            >
              {startSimulation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {hasRunning ? "Simulation Running..." : "Run Single Day"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {completedRuns.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card data-testid="card-total-trades">
              <CardContent className="p-4 flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Sim Trades</p>
                  <p className="text-lg font-semibold">{totalTrades}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-lessons">
              <CardContent className="p-4 flex items-center gap-3">
                <Brain className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Lessons Generated</p>
                  <p className="text-lg font-semibold">{totalLessons}</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-pnl">
              <CardContent className="p-4 flex items-center gap-3">
                {totalPnl >= 0 ? (
                  <TrendingUp className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-red-500 shrink-0" />
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Total Sim P&L</p>
                  <p
                    className={`text-lg font-semibold ${
                      totalPnl >= 0 ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {totalPnl >= 0 ? "+" : ""}
                    {formatCurrency(totalPnl)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-costs">
              <CardContent className="p-4 flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Costs</p>
                  <p className="text-lg font-semibold text-red-500">
                    -{formatCurrency(totalCosts)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {hasBenchmarkAgg && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground bg-accent/50 rounded-md px-3 py-2 flex-wrap" data-testid="aggregate-benchmarks">
              <Target className="w-3.5 h-3.5 shrink-0" />
              <span className={`font-medium ${totalPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                Bot: {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}
              </span>
              <span className="text-muted-foreground">|</span>
              <span className={`font-medium ${aggBuyAndHold >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                Buy & Hold: {aggBuyAndHold >= 0 ? "+" : ""}{formatCurrency(aggBuyAndHold)}
              </span>
              <span className="text-muted-foreground">|</span>
              <span className={`font-medium ${aggEma >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                EMA: {aggEma >= 0 ? "+" : ""}{formatCurrency(aggEma)}
              </span>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Simulation History</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {sortedRuns.length} run{sortedRuns.length !== 1 ? "s" : ""}
          </span>
        </div>

        {sortedRuns.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" data-testid="text-empty-state">
                No simulations yet. Pick a date and run your first backtest.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortedRuns.map((run) => (
              <RunCard key={run.id} run={run} onCancel={(id) => cancelMutation.mutate(id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
