import {
  LayoutDashboard,
  ListChecks,
  Radio,
  FileText,
  Settings,
  LogOut,
  TrendingUp,
  Zap,
  Activity,
  ScanSearch,
} from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import type { Alert } from "@shared/schema";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Scanner", url: "/scanner", icon: ScanSearch },
  { title: "Watchlist", url: "/watchlist", icon: ListChecks },
  { title: "Signals", url: "/signals", icon: Radio },
  { title: "Trade Plans", url: "/trades", icon: FileText },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();

  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 5000,
  });

  const unreadCount = alerts?.filter((a) => !a.isRead).length ?? 0;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="link-home-logo">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">BreakoutIQ</h1>
              <p className="text-[10px] text-muted-foreground leading-none">Trading Alerts</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {item.title === "Signals" && unreadCount > 0 && (
                          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 min-h-5">
                            {unreadCount}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
            Market Status
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-3 py-2 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Activity className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Strategy</span>
                <span className="ml-auto font-medium">Breakout + Retest</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Direction</span>
                <span className="ml-auto font-medium">Long Only</span>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={() => logout.mutate()}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
