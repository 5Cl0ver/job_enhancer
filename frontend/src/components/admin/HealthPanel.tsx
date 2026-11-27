import { CheckCircle, AlertTriangle, XCircle, MinusCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useServiceHealth } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle, color: "text-green-600", badge: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300" },
  degraded: { icon: AlertTriangle, color: "text-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  down: { icon: XCircle, color: "text-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  // No key set: not set up, not broken.
  off: { icon: MinusCircle, color: "text-muted-foreground", badge: "bg-muted text-muted-foreground" },
} as const;

export function HealthPanel() {
  const { data: statuses = [], isLoading, refetch, isFetching } = useServiceHealth();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Service Health</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 gap-1 text-xs"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Checking services…</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {statuses.map((s) => {
            const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.down;
            const Icon = cfg.icon;
            return (
              <div
                key={s.name}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.detail && (
                      <div className="text-xs break-words text-muted-foreground">{s.detail}</div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {s.latency_ms != null && (
                    <span className="text-muted-foreground">{s.latency_ms}ms</span>
                  )}
                  <Badge className={cn("text-xs capitalize", cfg.badge)} variant="outline">
                    {s.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
