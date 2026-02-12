import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  TrendingDown,
  TrendingUp,
  Target,
  Clock,
  AlertTriangle,
  Lightbulb,
  BarChart3,
} from "lucide-react";
import type { TradeLesson } from "@shared/schema";

interface LossPattern {
  tag: string;
  count: number;
  avgLoss: number;
  suggestion: string;
}

interface WinPattern {
  tag: string;
  count: number;
  avgWin: number;
}

interface TierStat {
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
}

interface SessionStat {
  wins: number;
  losses: number;
  winRate: number;
}

interface InsightsData {
  lessons: TradeLesson[];
  insights: {
    topLossPatterns: LossPattern[];
    topWinPatterns: WinPattern[];
    tierStats: Record<string, TierStat>;
    sessionStats: Record<string, SessionStat>;
    recommendations: string[];
  };
}

function formatTag(tag: string): string {
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="grid lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
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

function EmptyState() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Brain className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold mb-1" data-testid="text-empty-title">
          No Learning Data Yet
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          As you complete trades, the system will analyze patterns and generate
          insights to help improve your trading performance.
        </p>
      </div>
    </div>
  );
}

export default function Learning() {
  const { data, isLoading } = useQuery<InsightsData>({
    queryKey: ["/api/lessons/insights"],
  });

  if (isLoading) return <LoadingSkeleton />;

  const lessons = data?.lessons ?? [];
  const insights = data?.insights;

  if (lessons.length === 0) return <EmptyState />;

  const recentLessons = lessons.slice(0, 20);

  return (
    <div
      className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto overflow-y-auto h-full"
      data-testid="page-learning"
    >
      <div>
        <h1
          className="text-xl font-semibold tracking-tight"
          data-testid="text-learning-title"
        >
          Learning Insights
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI-powered analysis of your trade patterns and performance
        </p>
      </div>

      <Card data-testid="card-recommendations">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-medium">Recommendations</h3>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="space-y-2">
            {(insights?.recommendations ?? []).map((rec, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs"
                data-testid={`text-recommendation-${i}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card data-testid="card-loss-patterns">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-medium">Top Loss Patterns</h3>
            </div>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {(insights?.topLossPatterns ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No loss patterns detected yet.</p>
            ) : (
              <div className="space-y-3">
                {insights!.topLossPatterns.map((pattern, i) => (
                  <div
                    key={pattern.tag}
                    className="p-3 rounded-md bg-accent/50"
                    data-testid={`loss-pattern-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium">
                        {formatTag(pattern.tag)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] px-1.5 min-h-5">
                          {pattern.count}x
                        </Badge>
                        <span className="text-xs font-medium text-red-500">
                          {formatCurrency(pattern.avgLoss)}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {pattern.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-win-patterns">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-medium">Top Win Patterns</h3>
            </div>
            <Target className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {(insights?.topWinPatterns ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No win patterns detected yet.</p>
            ) : (
              <div className="space-y-3">
                {insights!.topWinPatterns.map((pattern, i) => (
                  <div
                    key={pattern.tag}
                    className="flex items-center justify-between gap-2 p-3 rounded-md bg-accent/50"
                    data-testid={`win-pattern-${i}`}
                  >
                    <span className="text-xs font-medium">
                      {formatTag(pattern.tag)}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] px-1.5 min-h-5">
                        {pattern.count}x
                      </Badge>
                      <span className="text-xs font-medium text-emerald-500">
                        +{formatCurrency(pattern.avgWin)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-tier-performance">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Tier Performance</h3>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-3 gap-3">
              {(["A", "B", "C"] as const).map((tier) => {
                const stats = insights?.tierStats?.[tier];
                const colors = {
                  A: "border-emerald-500/30",
                  B: "border-amber-500/30",
                  C: "border-blue-400/30",
                };
                return (
                  <div
                    key={tier}
                    className={`p-3 rounded-md bg-accent/50 border ${colors[tier]}`}
                    data-testid={`tier-stat-${tier}`}
                  >
                    <p className="text-xs font-bold mb-1">Tier {tier}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {stats?.wins ?? 0}W / {stats?.losses ?? 0}L
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Win: {(stats?.winRate ?? 0).toFixed(0)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Avg R: {(stats?.avgR ?? 0).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-session-performance">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Session Performance</h3>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-3 gap-3">
              {(["open", "mid", "power"] as const).map((sess) => {
                const stats = insights?.sessionStats?.[sess];
                return (
                  <div
                    key={sess}
                    className="p-3 rounded-md bg-accent/50"
                    data-testid={`session-stat-${sess}`}
                  >
                    <p className="text-xs font-bold mb-1 capitalize">{sess}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {stats?.wins ?? 0}W / {stats?.losses ?? 0}L
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Win: {(stats?.winRate ?? 0).toFixed(0)}%
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-recent-lessons">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Recent Lessons</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {recentLessons.length} of {lessons.length}
          </span>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {recentLessons.map((lesson) => (
              <div
                key={lesson.id}
                className="p-3 rounded-md bg-accent/50"
                data-testid={`lesson-item-${lesson.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">{lesson.ticker}</span>
                  {lesson.tier && (
                    <Badge
                      variant={
                        lesson.tier === "A"
                          ? "default"
                          : lesson.tier === "B"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-[9px] px-1.5 min-h-4"
                    >
                      Tier {lesson.tier}
                    </Badge>
                  )}
                  <Badge
                    variant={
                      lesson.outcomeCategory === "win"
                        ? "default"
                        : lesson.outcomeCategory === "loss"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-[9px] px-1.5 min-h-4"
                  >
                    {lesson.outcomeCategory === "win"
                      ? "Win"
                      : lesson.outcomeCategory === "loss"
                      ? "Loss"
                      : lesson.outcomeCategory === "breakeven"
                      ? "BE"
                      : formatTag(lesson.outcomeCategory)}
                  </Badge>
                  {lesson.exitReason && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatTag(lesson.exitReason)}
                    </span>
                  )}
                </div>
                {(lesson.lessonTags ?? []).length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {(lesson.lessonTags ?? []).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[9px] px-1 min-h-4"
                      >
                        {formatTag(tag)}
                      </Badge>
                    ))}
                  </div>
                )}
                {lesson.lessonDetail && (
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {lesson.lessonDetail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
