import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebSocket } from "@/hooks/use-websocket";
import { useEffect, useState } from "react";
import {
  ScanSearch,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  Filter,
  Zap,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
}

function formatVolume(vol: number): string {
  if (vol >= 1000000) return `${(vol / 1000000).toFixed(1)}M`;
  if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`;
  return vol.toString();
}

function formatDollar(val: number): string {
  if (val >= 1000000000) return `$${(val / 1000000000).toFixed(1)}B`;
  if (val >= 1000000) return `$${(val / 1000000).toFixed(0)}M`;
  return `$${val.toFixed(0)}`;
}

function ScoreBadge({ score, tier }: { score: number; tier: string }) {
  const color =
    tier === "full"
      ? "text-emerald-500"
      : tier === "half"
      ? "text-amber-500"
      : "text-muted-foreground";
  return (
    <span className={`text-xs font-semibold ${color}`} data-testid="text-score">
      {score}
    </span>
  );
}

export default function Scanner() {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();
  const [liveState, setLiveState] = useState<{
    isOpen: boolean;
    isLunchChop: boolean;
    spyAligned?: boolean;
    spyChopping?: boolean;
  }>({
    isOpen: false,
    isLunchChop: false,
  });

  const { data: scannerData, isLoading } = useQuery<ScannerItem[]>({
    queryKey: ["/api/scanner"],
    refetchInterval: 3000,
  });

  useEffect(() => {
    const unsub = subscribe("market_status", (data: any) => {
      setLiveState({
        isOpen: data.isOpen,
        isLunchChop: data.isLunchChop,
        spyAligned: data.spyAligned,
        spyChopping: data.spyChopping,
      });
    });
    return unsub;
  }, [subscribe]);

  const passing = scannerData?.filter((s) => s.passesFilters) ?? [];
  const filtered = scannerData?.filter((s) => !s.passesFilters) ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-scanner-title">
            Scanner
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Momentum breakout candidates with scoring
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {liveState.isLunchChop && (
            <Badge variant="outline" className="text-[9px] gap-1" data-testid="badge-lunch-chop">
              Lunch Chop
            </Badge>
          )}
          {liveState.spyChopping && (
            <Badge variant="outline" className="text-[9px] gap-1 text-amber-500" data-testid="badge-spy-chop">
              <Zap className="w-2.5 h-2.5" />
              SPY Choppy (50% size)
            </Badge>
          )}
          {liveState.spyAligned !== undefined && (
            <Badge
              variant="outline"
              className={`text-[9px] gap-1 ${liveState.spyAligned ? "text-emerald-500" : "text-red-500"}`}
              data-testid="badge-spy-regime"
            >
              SPY {liveState.spyAligned ? "Aligned" : "Misaligned"}
            </Badge>
          )}
          <Badge variant="outline" className="text-[9px] gap-1" data-testid="badge-filter-summary">
            <Filter className="w-2.5 h-2.5" />
            &ge;${user?.minPrice ?? 10} | $Vol &ge;{formatDollar(user?.minDollarVolume ?? 100000000)} | ATR &ge;{user?.minDailyATRpct ?? 1.2}%
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
          <div>
            <p className="text-sm font-medium">Passing Filters ({passing.length})</p>
            <p className="text-xs text-muted-foreground">
              Tickers meeting universe filter + volatility gate
            </p>
          </div>
          <ScanSearch className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : passing.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ScanSearch className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No tickers passing filters</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-10 gap-2 px-2 py-1.5 text-[9px] text-muted-foreground uppercase font-medium">
                <span>Ticker</span>
                <span className="text-right">Price</span>
                <span className="text-right">Chg%</span>
                <span className="text-right">RVOL</span>
                <span className="text-right">ATR%</span>
                <span className="text-right">Spread</span>
                <span className="text-right">$Volume</span>
                <span className="text-center">15m Bias</span>
                <span className="text-center">Score</span>
                <span className="text-center">Status</span>
              </div>
              {passing.map((item) => (
                <div
                  key={item.ticker}
                  className="grid grid-cols-10 gap-2 px-2 py-2 rounded-md bg-accent/30 items-center"
                  data-testid={`scanner-row-${item.ticker}`}
                >
                  <div>
                    <p className="text-sm font-medium">{item.ticker}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{item.name}</p>
                  </div>
                  <p className="text-xs font-medium text-right">${item.price.toFixed(2)}</p>
                  <p
                    className={`text-xs font-medium text-right ${
                      item.changePct >= 0 ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {item.changePct >= 0 ? "+" : ""}{item.changePct.toFixed(2)}%
                  </p>
                  <p
                    className={`text-xs font-medium text-right ${
                      item.rvol >= 1.5 ? "text-emerald-500" : "text-muted-foreground"
                    }`}
                  >
                    {item.rvol.toFixed(1)}x
                  </p>
                  <p
                    className={`text-xs text-right ${
                      item.dailyATRpct >= 1.2 ? "text-emerald-500" : "text-muted-foreground"
                    }`}
                  >
                    {item.dailyATRpct.toFixed(1)}%
                  </p>
                  <p
                    className={`text-xs text-right ${
                      item.spreadPct <= 0.05 ? "text-emerald-500" : "text-amber-500"
                    }`}
                  >
                    {item.spreadPct.toFixed(3)}%
                  </p>
                  <p className="text-xs text-right text-muted-foreground">
                    {formatDollar(item.dollarVolume)}
                  </p>
                  <div className="flex justify-center">
                    {item.trend1H ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex justify-center">
                    <ScoreBadge score={item.score} tier={item.scoreTier} />
                  </div>
                  <div className="flex justify-center">
                    {item.signalState !== "IDLE" ? (
                      <Badge
                        variant={item.signalState === "TRIGGERED" ? "default" : "secondary"}
                        className="text-[8px] px-1 min-h-4"
                      >
                        {item.signalState}
                      </Badge>
                    ) : item.resistanceLevel ? (
                      <Badge variant="outline" className="text-[8px] px-1 min-h-4">
                        R: ${item.resistanceLevel}
                      </Badge>
                    ) : (
                      <span className="text-[9px] text-muted-foreground">Scanning</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Filtered Out ({filtered.length})</p>
              <p className="text-xs text-muted-foreground">
                Tickers not meeting universe filter criteria
              </p>
            </div>
            <XCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-wrap gap-2">
              {filtered.map((item) => (
                <div
                  key={item.ticker}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/30"
                  data-testid={`scanner-filtered-${item.ticker}`}
                >
                  <span className="text-xs font-medium text-muted-foreground">{item.ticker}</span>
                  <span className="text-[9px] text-muted-foreground">
                    ${item.price.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
