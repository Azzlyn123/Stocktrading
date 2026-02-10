import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  X,
  Search,
  ListChecks,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import type { WatchlistItem } from "@shared/schema";

const POPULAR_TICKERS = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { ticker: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
  { ticker: "NVDA", name: "NVIDIA Corp.", sector: "Technology" },
  { ticker: "AMZN", name: "Amazon.com Inc.", sector: "Consumer" },
  { ticker: "GOOGL", name: "Alphabet Inc.", sector: "Technology" },
  { ticker: "META", name: "Meta Platforms", sector: "Technology" },
  { ticker: "TSLA", name: "Tesla Inc.", sector: "Consumer" },
  { ticker: "SPY", name: "S&P 500 ETF", sector: "ETF" },
  { ticker: "QQQ", name: "Nasdaq-100 ETF", sector: "ETF" },
  { ticker: "AMD", name: "AMD Inc.", sector: "Technology" },
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Finance" },
  { ticker: "V", name: "Visa Inc.", sector: "Finance" },
];

export default function Watchlist() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [customTicker, setCustomTicker] = useState("");

  const { data: watchlist, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const addMutation = useMutation({
    mutationFn: async (item: { ticker: string; name?: string; sector?: string }) => {
      await apiRequest("POST", "/api/watchlist", item);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Added to watchlist" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  const watchedTickers = new Set(watchlist?.map((w) => w.ticker) ?? []);

  const filtered = POPULAR_TICKERS.filter(
    (t) =>
      !watchedTickers.has(t.ticker) &&
      (t.ticker.toLowerCase().includes(search.toLowerCase()) ||
        t.name.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAddCustom = () => {
    const ticker = customTicker.trim().toUpperCase();
    if (ticker && !watchedTickers.has(ticker)) {
      addMutation.mutate({ ticker, name: ticker });
      setCustomTicker("");
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-watchlist-title">
          Watchlist
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage the tickers being scanned for breakout setups
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <div>
              <p className="text-sm font-medium">Active Watchlist</p>
              <p className="text-xs text-muted-foreground">
                {watchlist?.length ?? 0} tickers being monitored
              </p>
            </div>
            <ListChecks className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !watchlist || watchlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ListChecks className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No tickers in watchlist</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Add tickers from the suggestions panel
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {watchlist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-accent/50 group"
                    data-testid={`watchlist-item-${item.ticker}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
                        <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{item.ticker}</p>
                        <p className="text-[10px] text-muted-foreground">{item.name || item.ticker}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.sector && (
                        <Badge variant="outline" className="text-[9px] px-1.5 min-h-5">
                          {item.sector}
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ visibility: "visible" }}
                        onClick={() => removeMutation.mutate(item.id)}
                        data-testid={`button-remove-${item.ticker}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
              <div>
                <p className="text-sm font-medium">Add Custom Ticker</p>
                <p className="text-xs text-muted-foreground">Enter any ticker symbol</p>
              </div>
              <Plus className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. AAPL"
                  value={customTicker}
                  onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCustom()}
                  className="uppercase"
                  data-testid="input-custom-ticker"
                />
                <Button
                  onClick={handleAddCustom}
                  disabled={!customTicker.trim() || addMutation.isPending}
                  data-testid="button-add-custom"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
              <div>
                <p className="text-sm font-medium">Popular Tickers</p>
                <p className="text-xs text-muted-foreground">Quick add from top equities & ETFs</p>
              </div>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search tickers..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-tickers"
                />
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {search ? "No matches found" : "All popular tickers added"}
                  </p>
                ) : (
                  filtered.map((t) => (
                    <div
                      key={t.ticker}
                      className="flex items-center justify-between gap-2 p-2 rounded-md hover-elevate cursor-pointer"
                      onClick={() =>
                        addMutation.mutate({
                          ticker: t.ticker,
                          name: t.name,
                          sector: t.sector,
                        })
                      }
                      data-testid={`button-add-${t.ticker}`}
                    >
                      <div>
                        <p className="text-sm font-medium">{t.ticker}</p>
                        <p className="text-[10px] text-muted-foreground">{t.name}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] px-1.5 min-h-5">
                          {t.sector}
                        </Badge>
                        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
