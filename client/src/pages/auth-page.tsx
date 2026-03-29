import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Zap, TrendingUp, Shield, Bell } from "lucide-react";

export default function AuthPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login.mutateAsync(loginData);
    } catch (err: any) {
      toast({
        title: "Login failed",
        description: err.message || "Invalid credentials",
        variant: "destructive",
      });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerData.password.length < 4) {
      toast({
        title: "Weak password",
        description: "Password must be at least 4 characters",
        variant: "destructive",
      });
      return;
    }
    try {
      await register.mutateAsync(registerData);
    } catch (err: any) {
      toast({
        title: "Registration failed",
        description: err.message || "Could not create account",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                BreakoutIQ
              </h1>
              <p className="text-xs text-muted-foreground">
                Intraday Trading Alerts
              </p>
            </div>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="login" data-testid="tab-login">
                Sign In
              </TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card>
                <CardHeader className="pb-3">
                  <h2 className="text-base font-medium">Welcome back</h2>
                  <p className="text-xs text-muted-foreground">
                    Sign in to your trading dashboard
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    className="w-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
                    variant="outline"
                    disabled={login.isPending}
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/quick-access", {
                          method: "POST",
                          credentials: "include",
                        });
                        if (res.ok) window.location.href = "/";
                        else
                          login.mutate({
                            username: "admin",
                            password: "breakoutiq",
                          });
                      } catch {
                        login.mutate({
                          username: "admin",
                          password: "breakoutiq",
                        });
                      }
                    }}
                    data-testid="button-quick-access"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Quick Access (My Account)
                  </Button>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        or sign in manually
                      </span>
                    </div>
                  </div>
                  <form onSubmit={handleLogin} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-username" className="text-xs">
                        Username
                      </Label>
                      <Input
                        id="login-username"
                        value={loginData.username}
                        onChange={(e) =>
                          setLoginData({
                            ...loginData,
                            username: e.target.value,
                          })
                        }
                        placeholder="Enter username"
                        data-testid="input-login-username"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="login-password" className="text-xs">
                        Password
                      </Label>
                      <Input
                        id="login-password"
                        type="password"
                        value={loginData.password}
                        onChange={(e) =>
                          setLoginData({
                            ...loginData,
                            password: e.target.value,
                          })
                        }
                        placeholder="Enter password"
                        data-testid="input-login-password"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={login.isPending}
                      data-testid="button-login"
                    >
                      {login.isPending ? "Signing in..." : "Sign In"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card>
                <CardHeader className="pb-3">
                  <h2 className="text-base font-medium">Create account</h2>
                  <p className="text-xs text-muted-foreground">
                    Start paper trading with $100,000
                  </p>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-username" className="text-xs">
                        Username
                      </Label>
                      <Input
                        id="reg-username"
                        value={registerData.username}
                        onChange={(e) =>
                          setRegisterData({
                            ...registerData,
                            username: e.target.value,
                          })
                        }
                        placeholder="Choose a username"
                        data-testid="input-register-username"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password" className="text-xs">
                        Password
                      </Label>
                      <Input
                        id="reg-password"
                        type="password"
                        value={registerData.password}
                        onChange={(e) =>
                          setRegisterData({
                            ...registerData,
                            password: e.target.value,
                          })
                        }
                        placeholder="Choose a password"
                        data-testid="input-register-password"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={register.isPending}
                      data-testid="button-register"
                    >
                      {register.isPending ? "Creating..." : "Create Account"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <p className="text-[10px] text-muted-foreground text-center mt-6 leading-relaxed">
            For educational purposes only. Not financial advice. Past
            performance does not guarantee future results.
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-card items-center justify-center p-12">
        <div className="max-w-md space-y-8">
          <h2 className="text-2xl font-semibold tracking-tight">
            Breakout + Retest
            <br />
            <span className="text-muted-foreground">Intraday Alerts</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Multi-timeframe strategy scanning the top US equities and ETFs. Get
            "SETUP forming" and "TRIGGER hit" alerts with precise entry, stop,
            and target levels.
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium">1H Trend + 5m Entries</p>
                <p className="text-xs text-muted-foreground">
                  Multi-timeframe confirmation with EMA slope analysis
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Built-in Risk Management</p>
                <p className="text-xs text-muted-foreground">
                  Daily loss limits, cooldowns, and position sizing
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Real-time Alerts</p>
                <p className="text-xs text-muted-foreground">
                  Setup forming and trigger hit notifications
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
