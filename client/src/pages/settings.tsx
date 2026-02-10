import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
          Configure risk parameters and strategy settings
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
                        Max 1% of account
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
                      <FormLabel className="text-xs">Max Position (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-max-position"
                        />
                      </FormControl>
                      <FormDescription className="text-[9px]">
                        Max 50% of account
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
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                      <FormLabel className="text-xs">Retest Buffer (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-retest-buffer"
                        />
                      </FormControl>
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="trailingAtrMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Trailing ATR Multiplier</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-trailing-atr"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
