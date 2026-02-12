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
} from "lucide-react";
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

  const { toast } = useToast();

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
    mutationFn: async (minutes: number) => {
      const res = await apiRequest("POST", "/api/simulations/auto-run", {
        durationMinutes: minutes,
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

  return (
    <div
      className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full"
      data-testid="page-backtester"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-backtester-title">
          Historical Backtester
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Replay past trading days to train the AI learning system
        </p>
      </div>

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
              <Button
                onClick={() => startAutoRun.mutate(autoRunMinutes)}
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
        <div className="grid grid-cols-3 gap-3">
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
