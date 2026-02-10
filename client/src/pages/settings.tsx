import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { settingsUpdateSchema } from "@shared/schema";
import type { SettingsUpdate } from "@shared/schema";
import {
  Settings as SettingsIcon,
  Shield,
  Sliders,
  DollarSign,
  Save,
  AlertTriangle,
  Filter,
  Clock,
  Target,
  CalendarOff,
} from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<SettingsUpdate>({
    resolver: zodResolver(settingsUpdateSchema),
    defaultValues: {
      accountSize: user?.accountSize ?? 100000,
      paperMode: user?.paperMode ?? true,
      maxDailyLossPct: user?.maxDailyLossPct ?? 2,
      maxLosingTrades: user?.maxLosingTrades ?? 3,
      cooldownMinutes: user?.cooldownMinutes ?? 15,
      perTradeRiskPct: user?.perTradeRiskPct ?? 0.5,
      maxPositionPct: user?.maxPositionPct ?? 20,
      resistanceBars: user?.resistanceBars ?? 48,
      breakoutBuffer: user?.breakoutBuffer ?? 0.1,
      retestBuffer: user?.retestBuffer ?? 0.15,
      volumeMultiplier: user?.volumeMultiplier ?? 1.5,
      atrPeriod: user?.atrPeriod ?? 14,
      trailingAtrMultiplier: user?.trailingAtrMultiplier ?? 1.5,
      minPrice: user?.minPrice ?? 15,
      minAvgVolume: user?.minAvgVolume ?? 2000000,
      minDollarVolume: user?.minDollarVolume ?? 50000000,
      avoidEarnings: user?.avoidEarnings ?? true,
      lunchChopFilter: user?.lunchChopFilter ?? true,
      lunchChopStart: user?.lunchChopStart ?? "11:30",
      lunchChopEnd: user?.lunchChopEnd ?? "13:30",
      timeStopEnabled: user?.timeStopEnabled ?? true,
      timeStopMinutes: user?.timeStopMinutes ?? 30,
      timeStopR: user?.timeStopR ?? 0.5,
      partialExitPct: user?.partialExitPct ?? 50,
      partialExitR: user?.partialExitR ?? 1,
      mainTargetRMin: user?.mainTargetRMin ?? 2,
      mainTargetRMax: user?.mainTargetRMax ?? 3,
      earningsGapPct: user?.earningsGapPct ?? 10,
      earningsRvolMin: user?.earningsRvolMin ?? 5,
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsUpdate) => {
      await apiRequest("PATCH", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => {
      toast({
        title: "Error saving settings",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-settings-title">
          Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure risk parameters, universe filters, and strategy settings
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Account</p>
                <p className="text-xs text-muted-foreground">Paper trading settings</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <FormField
                control={form.control}
                name="paperMode"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2">
                    <div>
                      <FormLabel className="text-sm">Paper Mode</FormLabel>
                      <FormDescription className="text-[10px]">
                        Simulate trades without real money
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-paper-mode"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Account Size ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-account-size"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Universe Filters</p>
                <p className="text-xs text-muted-foreground">Hard filters for scanner eligibility</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="minPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Min Price ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-min-price"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Default $15</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minAvgVolume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Min Avg Volume</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="100000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-min-avg-volume"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Default 2M</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minDollarVolume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Min $ Volume</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1000000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-min-dollar-volume"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Default $50M</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="avoidEarnings"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2">
                    <div>
                      <FormLabel className="text-sm">Avoid Earnings Day</FormLabel>
                      <FormDescription className="text-[10px]">
                        Skip tickers reporting earnings today
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-avoid-earnings"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="earningsGapPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Earnings Gap Exception (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-earnings-gap"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Min gap for exception (10-15%)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="earningsRvolMin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Earnings RVOL Min</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-earnings-rvol"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Min RVOL for exception (5x)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Risk Management</p>
                <p className="text-xs text-muted-foreground">Daily limits and position controls</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="maxDailyLossPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Max Daily Loss (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-max-daily-loss"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Stop trading at -2% realized</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxLosingTrades"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Max Losing Trades</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-max-losing-trades"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Stop after 3 consecutive losses</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="perTradeRiskPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Per-Trade Risk (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-per-trade-risk"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">
                        Default 0.5%, max 1%
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxPositionPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Max Position Value (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-max-position"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">
                        Cap at 20% of account
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="cooldownMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Cooldown After Loss (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-cooldown"
                      />
                    </FormControl>
                    <FormDescription className="text-[9px]">15-min cooldown after any loss</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lunchChopFilter"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2">
                    <div>
                      <FormLabel className="text-sm">Lunch Chop Filter</FormLabel>
                      <FormDescription className="text-[10px]">
                        No new setups/entries 11:30 AM - 1:30 PM ET (manage open only)
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-lunch-chop"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <Target className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Stops & Trade Management</p>
                <p className="text-xs text-muted-foreground">Partial exits, trailing stops, time stop</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="partialExitPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Partial Exit (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="5"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-partial-exit-pct"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Sell 50% at T1</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="partialExitR"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Partial Exit at (R)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-partial-exit-r"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Take partial at +1R</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="mainTargetRMin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Main Target Min (R)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-main-target-min"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mainTargetRMax"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Main Target Max (R)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-main-target-max"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="trailingAtrMultiplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Runner ATR Trailing Stop Multiplier</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-trailing-atr"
                      />
                    </FormControl>
                    <FormDescription className="text-[9px]">1.5x ATR(14) trailing stop on runner</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timeStopEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2">
                    <div>
                      <FormLabel className="text-sm">Time Stop</FormLabel>
                      <FormDescription className="text-[10px]">
                        Exit if not reaching target R within time limit
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-time-stop"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="timeStopMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Time Stop (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-time-stop-minutes"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Default 30 min</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timeStopR"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Time Stop Min R</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-time-stop-r"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Exit if not +0.5R by time</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <Sliders className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Strategy Parameters</p>
                <p className="text-xs text-muted-foreground">Breakout + Retest detection settings</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="resistanceBars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Resistance Lookback (bars)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-resistance-bars"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">N=48 5m bars with 2+ rejections</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="breakoutBuffer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Breakout Buffer (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-breakout-buffer"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Close above resistance by 0.10%</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="retestBuffer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Retest Tolerance (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-retest-buffer"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Within 0.15% of breakout level</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="volumeMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Volume Multiplier</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-volume-multiplier"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">Breakout vol &gt; 1.5x 20-bar avg</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="atrPeriod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">ATR Period</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-atr-period"
                      />
                    </FormControl>
                    <FormDescription className="text-[9px]">ATR(14) &gt; 20-bar ATR avg = expansion</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <AlertTriangle className="w-3 h-3" />
              Stop-losses are enforced by the system and cannot be moved manually
            </div>
            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
              <Save className="w-4 h-4 mr-1.5" />
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
