import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  suffix?: string;
  className?: string;
}

const TREND_ICONS = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

const TREND_COLORS = {
  up: "text-green-600",
  down: "text-red-500",
  neutral: "text-muted-foreground",
};

export function StatCard({ label, value, icon: Icon, trend, suffix, className }: StatCardProps) {
  const TrendIcon = trend ? TREND_ICONS[trend] : null;

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">
              {value}
              {suffix && <span className="ml-0.5 text-lg font-normal text-muted-foreground">{suffix}</span>}
            </p>
          </div>
          <div className="rounded-full bg-muted p-2.5">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
        {TrendIcon && (
          <div className={cn("mt-3 flex items-center gap-1 text-xs", TREND_COLORS[trend!])}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span className="capitalize">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
