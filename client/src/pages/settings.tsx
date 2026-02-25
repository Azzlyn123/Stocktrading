import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Zap,
  Lock,
} from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const currentVersion = user?.currentStrategyVersion ?? "v1";

  const { data: coreMetrics } = useQuery<{ totalTrades: number }>({
    queryKey: ["/api/simulations/core-metrics", currentVersion],
    queryFn: async () => {
      const res = await fetch(`/api/simulations/core-metrics?version=${encodeURIComponent(currentVersion)}`, {
        credentials: "include",
      });
      if (!res.ok) return { totalTrades: 0 };
      return res.json();
    },
  });

  const isFrozen = (coreMetrics?.totalTrades ?? 0) > 0;

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
      volumeMultiplier: user?.volumeMultiplier ?? 1.8,
      atrPeriod: user?.atrPeriod ?? 14,
      trailingAtrMultiplier: user?.trailingAtrMultiplier ?? 1.5,
      minPrice: user?.minPrice ?? 10,
      minAvgVolume: user?.minAvgVolume ?? 2000000,
      minDollarVolume: user?.minDollarVolume ?? 100000000,
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
      maxSpreadPct: user?.maxSpreadPct ?? 0.05,
      minDailyATRpct: user?.minDailyATRpct ?? 1.2,
      minRVOL: user?.minRVOL ?? 1.5,
      rvolCutoffMinutes: user?.rvolCutoffMinutes ?? 15,
      htfConfirmations: user?.htfConfirmations ?? 2,
      breakoutMinBodyPct: user?.breakoutMinBodyPct ?? 0.60,
      breakoutMinRangeMultiplier: user?.breakoutMinRangeMultiplier ?? 1.2,
      retestMaxPullbackPct: user?.retestMaxPullbackPct ?? 50,
      entryMode: (user?.entryMode as "conservative" | "aggressive") ?? "conservative",
      maxVwapCrosses: user?.maxVwapCrosses ?? 3,
      chopSizeReduction: user?.chopSizeReduction ?? 0.50,
      volGateFirstRangePct: user?.volGateFirstRangePct ?? 70,
      volGateAtrMultiplier: user?.volGateAtrMultiplier ?? 1.3,
      scoreFullSizeMin: user?.scoreFullSizeMin ?? 80,
      scoreHalfSizeMin: user?.scoreHalfSizeMin ?? 65,
      riskMode: (user?.riskMode as any) ?? "balanced",
      powerSetupEnabled: user?.powerSetupEnabled ?? true,
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsUpdate) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (res.status === 409) {
        const body = await res.json();
        throw { frozen: true, message: body.message, tradeCount: body.tradeCount, version: body.version };
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => {
      if (err.frozen) {
        toast({
          title: "Strategy rules are frozen",
          description: err.message || `This version has recorded trades. Use Archive & Reset on the Backtester page to start a new version before changing parameters.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error saving settings",
          description: err.message || "Unknown error",
          variant: "destructive",
        });
      }
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <Badge variant="outline" className="text-[10px] px-1.5 min-h-5" data-testid="badge-strategy-version">
            {currentVersion}
          </Badge>
          {isFrozen && (
            <Badge variant="secondary" className="text-[10px] px-1.5 min-h-5 bg-amber-500/10 text-amber-500 border-amber-500/20" data-testid="badge-rules-frozen">
              <Lock className="w-3 h-3 mr-1" />
              Frozen
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Configure strategy settings</p>
      </div>

      {isFrozen && (
        <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-rules-frozen-warning">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-amber-500">Strategy rules are frozen for {currentVersion}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                This version has {coreMetrics?.totalTrades} trade{(coreMetrics?.totalTrades ?? 0) !== 1 ? "s" : ""} recorded.
                Use Archive & Reset on the Backtester page to start a new version before changing parameters.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2 p-4">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Risk & Aggression</p>
                <p className="text-xs text-muted-foreground">Dial aggression and set guardrails</p>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="riskMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Risk Mode</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select mode" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="conservative">Conservative</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="aggressive">Aggressive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="powerSetupEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between p-2 rounded-md bg-accent/30">
                      <div>
                        <FormLabel className="text-xs">Power Setup</FormLabel>
                        <FormDescription className="text-[9px]">1.25x risk once/day</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="maxDailyLossPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Max Daily Loss (%)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
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
                        <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
                        <Input type="number" step="1" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minAvgVolume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Min Volume</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
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
                        <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={saveMutation.isPending || isFrozen} data-testid="button-save-settings">
            {isFrozen ? (
              <>
                <Lock className="w-4 h-4 mr-2" />
                Rules Frozen — Archive & Reset First
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save Settings"}
              </>
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
